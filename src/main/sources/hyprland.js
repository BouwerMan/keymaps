// Imports Hyprland binds, from either config format:
//
//   [source]
//   type = "hyprland"
//   path = "~/.config/hypr/hyprland.lua"   # optional; a list = first one that exists
//
// hyprland.lua (0.55+): the config is run with `lua` against a stand-in `hl` API that
//   records every hl.bind() (see hypr-lua-dump.lua). Groups come from section header
//   comments like "-- Windows -------".
// hyprland.conf: parsed as text. Understands $variables, `source = ...` includes (with *
//   globs), bindd descriptions, submaps, unbind, and a trailing "# comment" as description.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { parseKeys } = require('../keys');

const LUA_DUMP = path.join(__dirname, 'hypr-lua-dump.lua');

const DIRS = { l: 'left', r: 'right', u: 'up', d: 'down', t: 'up', b: 'down' };
const dir = (p) => DIRS[p.trim().toLowerCase()] || p.trim();

const short = (s, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function workspaceDesc(p, verb) {
  const v = p.trim();
  if (/^[em]?\+1$/.test(v) || v === 'r+1') return verb ? `${verb} next workspace` : 'Next workspace';
  if (/^[em]?-1$/.test(v) || v === 'r-1') return verb ? `${verb} previous workspace` : 'Previous workspace';
  if (v === 'previous') return verb ? `${verb} previous workspace` : 'Last workspace';
  if (v.startsWith('special')) return verb ? `${verb} scratchpad` : 'Scratchpad';
  return verb ? `${verb} workspace ${v}` : `Go to workspace ${v}`;
}

// Friendlier names for the media commands in Hyprland's default config.
const MEDIA_COMMANDS = [
  [/set-volume.*%\+|volume.*\b(up|raise|inc)/i, 'Volume up'],
  [/set-volume.*%-|volume.*\b(down|lower|dec)/i, 'Volume down'],
  [/SOURCE@.*toggle|mic.*mute/i, 'Toggle mic mute'],
  [/set-mute.*toggle|mute/i, 'Toggle mute'],
  [/brightness.*%\+|brightness.*\bup/i, 'Brightness up'],
  [/brightness.*%-|brightness.*\bdown/i, 'Brightness down'],
  [/playerctl.*play-pause/i, 'Play / pause'],
  [/playerctl.*\bplay\b/i, 'Play'],
  [/playerctl.*\bpause\b/i, 'Pause'],
  [/playerctl.*\bnext\b/i, 'Next track'],
  [/playerctl.*\bprevious\b/i, 'Previous track'],
];

function runDesc(cmd) {
  const media = MEDIA_COMMANDS.find(([re]) => re.test(cmd));
  return media ? media[1] : `Run ${short(cmd)}`;
}

const DISPATCHERS = {
  exec: runDesc,
  execr: runDesc,
  killactive: () => 'Close window',
  forcekillactive: () => 'Force kill window',
  togglefloating: () => 'Toggle floating',
  setfloating: () => 'Make floating',
  settiled: () => 'Make tiled',
  fullscreen: (p) => (p.trim() === '1' ? 'Maximize' : 'Fullscreen'),
  pseudo: () => 'Pseudo-tile',
  togglesplit: () => 'Toggle split',
  layoutmsg: (p) => `Layout: ${p}`,
  movefocus: (p) => `Focus ${dir(p)}`,
  movewindow: (p) => (p.trim() ? `Move window ${dir(p)}` : 'Move window (drag)'),
  swapwindow: (p) => `Swap window ${dir(p)}`,
  resizewindow: () => 'Resize window (drag)',
  resizeactive: (p) => `Resize window ${p.trim()}`,
  workspace: (p) => workspaceDesc(p),
  movetoworkspace: (p) => workspaceDesc(p, 'Move window to'),
  movetoworkspacesilent: (p) => workspaceDesc(p, 'Send window to'),
  togglespecialworkspace: (p) => (p.trim() ? `Toggle special workspace "${p.trim()}"` : 'Toggle scratchpad'),
  exit: () => 'Exit Hyprland',
  togglegroup: () => 'Toggle window group',
  changegroupactive: (p) => (p.trim() === 'b' ? 'Previous window in group' : 'Next window in group'),
  cyclenext: (p) => (p.includes('prev') ? 'Cycle to previous window' : 'Cycle to next window'),
  focuscurrentorlast: () => 'Focus last window',
  focusmonitor: (p) => `Focus monitor ${p.trim()}`,
  pin: () => 'Pin window',
  centerwindow: () => 'Center window',
  pass: (p) => `Pass key to ${p.trim()}`,
  sendshortcut: (p) => `Send shortcut ${p.trim()}`,
  submap: (p) => (p.trim() === 'reset' ? 'Leave submap' : `Enter "${p.trim()}" mode`),
  dpms: (p) => `Screen ${p.trim() || 'power toggle'}`,
};

function groupFor(dispatcher, params, keyName, flags) {
  if (flags.includes('m')) return 'Mouse';
  if (/^XF86/i.test(keyName) || /volume|brightness|playerctl|wpctl|pactl|pamixer/.test(params)) return 'Media';
  if (dispatcher === 'exec' || dispatcher === 'execr') return 'Apps';
  if (/workspace/.test(dispatcher)) return 'Workspaces';
  if (dispatcher === 'exit' || dispatcher === 'dpms') return 'Session';
  if (dispatcher === 'submap') return 'Submaps';
  if (/focus|window|active|float|tiled|fullscreen|pseudo|split|pin|group|cycle|layoutmsg/.test(dispatcher)) return 'Windows';
  return 'Other';
}

const FLAG_NOTES = {
  l: 'works on the lock screen',
  e: 'repeats while held',
  r: 'fires on release',
  m: 'hold and drag with the mouse',
  n: 'non-consuming',
  o: 'long press',
};

const MOD_TOKENS = { mod1: 'Alt', mod4: 'Super', control: 'Ctrl', ctrl: 'Ctrl', super: 'Super', shift: 'Shift', alt: 'Alt', win: 'Super' };

// "SUPER_L" -> "LSuper", "mouse:272" stays raw
function keyToken(key) {
  const m = /^(super|shift|control|ctrl|alt)_([lr])$/i.exec(key);
  if (m) {
    const name = { super: 'Super', shift: 'Shift', control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt' }[m[1].toLowerCase()];
    return m[2].toUpperCase() + name;
  }
  // Single letters are case-insensitive in Hyprland (not Shift+letter like in vim).
  return /^[A-Za-z]$/.test(key) ? key.toLowerCase() : key;
}

function expandPath(p, base) {
  let s = p.trim();
  if (s.startsWith('~')) s = path.join(os.homedir(), s.slice(1));
  return path.isAbsolute(s) ? s : path.join(base, s);
}

function globFiles(pattern) {
  if (!pattern.includes('*')) return [pattern];
  const d = path.dirname(pattern);
  const re = new RegExp('^' + path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try { return fs.readdirSync(d).filter((f) => re.test(f)).sort().map((f) => path.join(d, f)); } catch { return []; }
}

// Split "foo # bar" into ["foo", "bar"]; "##" is an escaped "#".
function splitComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== '#') continue;
    if (line[i + 1] === '#') { i++; continue; }
    return [line.slice(0, i).replace(/##/g, '#'), line.slice(i + 1).trim()];
  }
  return [line.replace(/##/g, '#'), ''];
}

function parseConfig(mainFile) {
  const vars = {};
  const files = [];
  const binds = [];
  const notices = [];
  let submap = null;

  const subst = (s) => s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => (name in vars ? vars[name] : m));

  const readFile = (file, depth) => {
    if (depth > 10 || files.includes(file)) return;
    files.push(file);
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      notices.push(`Couldn't read ${file}: ${e.code || e.message}`);
      return;
    }
    for (const rawLine of text.split('\n')) {
      const [line, comment] = splitComment(rawLine);
      const m = /^\s*([$\w:.-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const [, keyword, value] = m;
      if (keyword.startsWith('$')) { vars[keyword.slice(1)] = subst(value); continue; }
      if (keyword === 'source') {
        for (const f of globFiles(expandPath(subst(value), path.dirname(file)))) readFile(f, depth + 1);
        continue;
      }
      if (keyword === 'submap') { submap = value === 'reset' ? null : value; continue; }
      if (keyword === 'unbind') {
        const [mods, key] = value.split(',').map((s) => subst(s).trim());
        const target = comboString(mods, key);
        for (let i = binds.length - 1; i >= 0; i--) if (binds[i].combo === target) binds.splice(i, 1);
        continue;
      }
      const b = /^bind([a-z]*)$/.exec(keyword);
      if (!b) continue;
      const flags = b[1];
      const parts = value.split(',');
      const mods = subst(parts[0] || '').trim();
      const key = subst(parts[1] || '').trim();
      let rest = parts.slice(2);
      let desc = '';
      if (flags.includes('d')) { desc = (rest[0] || '').trim(); rest = rest.slice(1); }
      const dispatcher = (rest[0] || '').trim().toLowerCase();
      const rawParams = rest.slice(1).join(',').trim();
      const params = subst(rawParams);
      binds.push({ flags, mods, key, desc, comment, dispatcher, rawParams, params, submap, combo: comboString(mods, key) });
    }
  };

  readFile(mainFile, 0);
  return { binds, files, notices, vars };
}

function comboString(mods, key) {
  const modList = mods.split(/[\s_+]+/).filter(Boolean).map((m) => MOD_TOKENS[m.toLowerCase()] || m);
  return [...modList, keyToken(key)].filter(Boolean).join('+');
}

function describe(b) {
  if (b.desc) return b.desc;
  if (b.comment) return b.comment;
  // "exec, $terminal" reads better as "Open terminal (kitty)"
  const varOnly = /^\$([A-Za-z_]\w*)$/.exec(b.rawParams);
  if ((b.dispatcher === 'exec' || b.dispatcher === 'execr') && varOnly) {
    return `Open ${varOnly[1]}${b.params !== b.rawParams ? ` (${short(b.params, 28)})` : ''}`;
  }
  const fn = DISPATCHERS[b.dispatcher];
  if (fn) return fn(b.params);
  return [b.dispatcher, b.params].filter(Boolean).join(' ') || '(no action)';
}

function runLua(interpreters, file) {
  return new Promise((resolve, reject) => {
    const attempt = (i) => {
      if (i >= interpreters.length) return reject(new Error(`no Lua interpreter found (tried ${interpreters.join(', ')})`));
      execFile(interpreters[i], [LUA_DUMP, file], { cwd: path.dirname(file), timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          if (err && err.code === 'ENOENT') return attempt(i + 1);
          const m = /@@KEYMAPS@@([\s\S]*)@@END@@/.exec(stdout || '');
          if (!m) return reject(err || new Error('the Lua config produced no output'));
          try { resolve(JSON.parse(m[1])); } catch (e) { reject(e); }
        });
    };
    attempt(0);
  });
}

// "-- Windows ------" above a bind names its group.
function sectionFinder() {
  const cache = new Map();
  return (file, line) => {
    if (!file || !line) return null;
    if (!cache.has(file)) {
      try { cache.set(file, fs.readFileSync(file, 'utf8').split('\n')); } catch { cache.set(file, []); }
    }
    const lines = cache.get(file);
    for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
      const m = /^\s*--+\s*([A-Za-z][^-]*?)\s*(?:\(.*\))?\s*-{3,}\s*$/.exec(lines[i]);
      if (m) return m[1].trim();
    }
    return null;
  };
}

// "SUPER + SHIFT + h" -> "Super+Shift+h"
function luaCombo(keys) {
  const parts = String(keys).split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  return comboString(parts.join(' '), key);
}

const LUA_FLAG_NOTES = {
  repeating: 'repeats while held',
  locked: 'works on the lock screen',
  mouse: 'hold and drag with the mouse',
  release: 'fires on release',
  long_press: 'long press',
};

async function importLuaConfig(file, source) {
  const dump = await runLua([].concat(source.lua || ['lua', 'luajit', 'lua5.4']), file);
  const section = sectionFinder();
  const bindings = dump.binds.map((b) => {
    const combo = luaCombo(b.keys);
    const action = b.action || '';
    const args = Array.isArray(b.args) ? b.args : [];
    const isExec = /exec/.test(action);
    // Fallback description from the action, e.g. dsp.window.close -> "window close"
    const fallback = isExec && typeof args[0] === 'string'
      ? runDesc(args[0])
      : action.replace(/^dsp\./, '').replace(/[._]/g, ' ') || '(no action)';
    const opts = b.opts || {};
    return {
      keys: combo,
      desc: typeof opts.description === 'string' && opts.description ? opts.description : fallback,
      group: section(b.file, b.line) || groupFor(isExec ? 'exec' : action, String(args[0] || ''), combo, opts.mouse ? 'm' : ''),
      modes: b.submap ? [b.submap] : [],
      note: Object.keys(LUA_FLAG_NOTES).filter((f) => opts[f]).map((f) => LUA_FLAG_NOTES[f]).join(', '),
      steps: parseKeys(combo),
      enters: /submap/.test(action) && typeof args[0] === 'string' && args[0] !== 'reset' ? args[0] : null,
    };
  });
  const notices = (dump.errors || []).map((e) => `Hyprland config error while reading binds: ${e}`);
  return { bindings, notices };
}

// A submap works like a sequence: Super+R then h. Put the entering keys in front of
// each submap bind so the keyboard can step into it, like a vim leader.
function foldSubmaps(bindings) {
  const enters = new Map();
  for (const b of bindings) if (b.enters && !enters.has(b.enters)) enters.set(b.enters, b);
  for (const b of bindings) {
    const name = b.modes.length === 1 ? b.modes[0] : null;
    const enter = name && enters.get(name);
    if (enter) {
      b.steps = [...enter.steps, ...b.steps];
      b.keys = `${enter.keys} ${b.keys}`;
      b.modes = [];
      b.note = [`in ${name} mode`, b.note].filter(Boolean).join(', ');
    }
  }
  for (const b of bindings) delete b.enters;
  return bindings;
}

function candidatePaths(source) {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  if (source.path) return [].concat(source.path).map((p) => expandPath(String(p), base));
  return ['hyprland.lua', 'hyprland.conf'].map((f) => path.join(base, 'hypr', f));
}

async function importHyprland(source) {
  const candidates = candidatePaths(source);
  const mainFile = candidates.find((f) => fs.existsSync(f));
  if (!mainFile) {
    return {
      bindings: [],
      watchFiles: candidates,
      notices: [`No Hyprland config at ${candidates.join(' or ')} yet. Its binds will show up here as soon as it exists.`],
    };
  }
  // Keep polling the earlier candidates, so e.g. stowing ~/.config/hypr switches over.
  const earlier = candidates.slice(0, candidates.indexOf(mainFile));

  if (mainFile.endsWith('.lua')) {
    let dir = path.dirname(mainFile);
    try { dir = fs.realpathSync(dir); } catch { /* keep */ }
    const res = await importLuaConfig(mainFile, source);
    return { ...res, bindings: foldSubmaps(res.bindings), watchDirs: [dir], watchFiles: earlier };
  }

  const parsed = parseConfig(mainFile);
  const bindings = parsed.binds.map((b) => ({
    keys: b.combo,
    desc: describe(b),
    group: groupFor(b.dispatcher, b.params, b.key, b.flags),
    modes: b.submap ? [b.submap] : [],
    note: [...b.flags].map((f) => FLAG_NOTES[f]).filter(Boolean).join(', '),
    steps: parseKeys(b.combo),
    enters: b.dispatcher === 'submap' && b.params.trim() !== 'reset' ? b.params.trim() : null,
  }));
  return { bindings: foldSubmaps(bindings), watchFiles: [...earlier, ...parsed.files], notices: parsed.notices };
}

module.exports = { importHyprland, parseConfig, describe, luaCombo };
