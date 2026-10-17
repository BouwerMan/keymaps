// Imports keymaps from a live Neovim config by running nvim headless.
//
//   [source]
//   type = "neovim"
//   modes = ["n", "x", "i"]        # optional
//   exclude = ["<leader>u"]        # optional: hide maps starting with these keys
//   command = "nvim"               # optional
//   config = "~/.config/nvim"      # optional: dir to watch for changes

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseVimKeys } = require('../keys');

const DUMP_SCRIPT = path.join(__dirname, 'nvim-dump.lua');

const MODE_NAMES = {
  n: 'normal', x: 'visual', v: 'visual', s: 'select', o: 'operator',
  i: 'insert', t: 'terminal', c: 'command',
};

// lhs patterns that aren't worth showing
const SKIP_LHS = /^<Plug>|^<SNR>|Mouse>|ScrollWheel|Drag>|Release>/;

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // lazy-lock.json is rewritten by plugin updates, not by keymap edits
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'lazy-lock.json') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch { /* gone */ }
      }
    }
  };
  walk(dir);
  return newest;
}

function runNvim(command, modes) {
  return new Promise((resolve, reject) => {
    execFile(command, ['--headless', '-n', '-i', 'NONE', '-c', `luafile ${DUMP_SCRIPT}`], {
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, KEYMAPS_MODES: modes.join(',') },
    }, (err, stdout) => {
      const m = /@@KEYMAPS@@([\s\S]*)@@END@@/.exec(stdout || '');
      if (m) {
        try { return resolve(JSON.parse(m[1])); } catch (e) { return reject(e); }
      }
      reject(err || new Error('nvim produced no keymap output'));
    });
  });
}

const capitalize = (s) => (s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1));
const startsWith = (steps, pre) => pre.length <= steps.length && pre.every((p, i) =>
  p.key === steps[i].key && p.mods.join('+') === steps[i].mods.join('+'));
// pre is a group prefix of steps: steps start with it and keep going
const isPrefix = (pre, steps) => pre.length < steps.length && startsWith(steps, pre);

function toBindings(dump, source) {
  const leader = dump.leader === ' ' ? 'Space' : dump.leader;
  const localleader = dump.localleader === ' ' ? 'Space' : dump.localleader;
  const aliases = { leader, localleader };

  // Show "<leader>ff" rather than " ff".
  const display = (lhs) => {
    let s = lhs;
    if (dump.leader && s.startsWith(dump.leader)) s = '<leader>' + s.slice(dump.leader.length);
    return s.replace(/ /g, '<Space>');
  };

  const groups = (dump.groups || []).map((g) => ({
    steps: parseVimKeys(g.lhs, aliases),
    name: capitalize(g.group),
    modes: [].concat(g.mode || 'n').map((m) => MODE_NAMES[m] || m),
  })).sort((a, b) => b.steps.length - a.steps.length);

  const exclude = [].concat(source.exclude || []).map((e) => parseVimKeys(e, aliases));
  const leaderStep = parseVimKeys(leader === 'Space' ? '<Space>' : leader)[0];

  const byKey = new Map();
  const undescribed = new Map();
  for (const m of dump.maps) {
    if (!m.lhs || SKIP_LHS.test(m.lhs)) continue;
    let desc = m.desc;
    if (!desc && typeof m.rhs === 'string' && m.rhs) {
      const plug = /^<Plug>\((.+)\)$/.exec(m.rhs);
      desc = plug ? plug[1] : `→ ${m.rhs}`;
    }
    const steps = parseVimKeys(m.lhs);
    if (!desc) {
      undescribed.set(m.lhs, { keys: display(m.lhs), steps });
      continue;
    }

    if (exclude.some((e) => startsWith(steps, e))) continue;
    const mode = MODE_NAMES[m.mode] || m.mode;

    // The same map often exists in several modes; merge those.
    const id = JSON.stringify(steps) + '\u0000' + desc;
    if (byKey.has(id)) {
      const b = byKey.get(id);
      if (!b.modes.includes(mode)) b.modes.push(mode);
      continue;
    }
    byKey.set(id, { keys: display(m.lhs), desc, steps, modes: [mode], note: '' });
  }

  const bindings = [...byKey.values()];
  for (const b of bindings) {
    const g = groups.find((gr) => isPrefix(gr.steps, b.steps) && gr.modes.some((m) => b.modes.includes(m)));
    if (g) b.group = g.name;
    else if (leaderStep && isPrefix([leaderStep], b.steps)) b.group = 'Leader';
    else if (b.modes.length === 1 && b.modes[0] === 'insert') b.group = 'Insert mode';
    else if (b.steps[0].mods.includes('Ctrl')) b.group = 'Ctrl keys';
    else b.group = 'Other';
  }
  bindings.sort((a, b) => a.group.localeCompare(b.group) || a.keys.localeCompare(b.keys));

  // Maps with no description at all are hidden; config.js reports the ones the
  // app's .toml doesn't describe either.
  return { bindings, notices: [], undescribed: [...undescribed.values()] };
}

const cache = new Map();

async function importNeovim(source) {
  const command = source.command || 'nvim';
  const modes = [].concat(source.modes || ['n', 'x', 'i']);
  const configBase = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  let configDir = expandHome(source.config || path.join(configBase, process.env.NVIM_APPNAME || 'nvim'));
  try { configDir = fs.realpathSync(configDir); } catch { /* may not exist */ }
  const watchDirs = fs.existsSync(configDir) ? [configDir] : [];

  // Re-running nvim takes a second or two, so only do it when its config changed.
  const sig = JSON.stringify([source, newestMtime(configDir)]);
  if (cache.has(sig)) return { ...cache.get(sig), watchDirs };

  const dump = await runNvim(command, modes);
  const result = toBindings(dump, source);
  cache.clear();
  cache.set(sig, result);
  return { ...result, watchDirs };
}

module.exports = { importNeovim, toBindings, MODE_NAMES };
