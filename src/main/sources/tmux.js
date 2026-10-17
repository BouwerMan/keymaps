// Imports tmux key bindings by starting a private, throwaway tmux server with your
// config (plugins included) and asking it for its key tables. Your real tmux
// sessions are never touched.
//
//   [source]
//   type = "tmux"
//   config = "~/.config/tmux/tmux.conf"   # optional
//   copy_mode = true                       # optional: include copy-mode keys

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { lookup, step, unknownStep } = require('../keys');

const MOD_LETTERS = { C: 'Ctrl', M: 'Alt', S: 'Shift' };
const TMUX_NAMES = {
  bspace: ['Backspace'], ppage: ['PgUp'], pageup: ['PgUp'], npage: ['PgDn'], pagedown: ['PgDn'],
  ic: ['Ins'], dc: ['Del'], btab: ['Tab', 'Shift'],
};
const SKIP_KEY = /Mouse|Wheel|Click|Drag|Scrollbar/;

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// "C-Space", "M-H", "\\%", "BSpace" -> a step
function tmuxStep(token) {
  let tok = token.length > 1 && token.startsWith('\\') ? token.slice(1) : token;
  const mods = [];
  let m;
  while ((m = /^([CMS])-(.+)$/.exec(tok))) {
    mods.push(MOD_LETTERS[m[1]]);
    tok = m[2];
  }
  const named = TMUX_NAMES[tok.toLowerCase()];
  if (named) return step(mods.concat(named.slice(1)), named[0]);
  const hit = lookup(tok, true);
  if (!hit || hit.mod) return unknownStep(token);
  return step(mods.concat(hit.mods), hit.key);
}

const humanize = (s) => {
  const t = s.replace(/[-_]/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const DIR = { L: 'left', R: 'right', U: 'up', D: 'down' };

// Turn a tmux command into a short description.
function describeCommand(cmd) {
  let m;
  if ((m = /select-pane -([LRUD])\b/.exec(cmd))) {
    return `Pane ${DIR[m[1]]}${/is_vim|vim/.test(cmd) ? ' (vim-aware)' : ''}`;
  }
  if (/select-pane -l\b/.test(cmd)) return 'Last pane';
  if ((m = /^split-window\b(.*)$/.exec(cmd))) return /-h\b/.test(m[1]) ? 'Split pane side by side' : 'Split pane top/bottom';
  if (/resize-pane -Z\b/.test(cmd)) return 'Zoom pane';
  if ((m = /^resize-pane -([LRUD])\b/.exec(cmd))) return `Resize pane ${DIR[m[1]]}`;
  if ((m = /^send-keys -X (\S+)/.exec(cmd))) return humanize(m[1]);
  if ((m = /^source-file\s+(\S+)/.exec(cmd))) return `Reload config (${m[1]})`;
  if ((m = /plugins\/([^/\s'"]+)\//.exec(cmd))) return `Open ${m[1]}`;
  if ((m = /^select-window -t :=?(\d+)/.exec(cmd))) return `Window ${m[1]}`;
  const simple = {
    'previous-window': 'Previous window', 'next-window': 'Next window', 'last-window': 'Last window',
    'new-window': 'New window', 'kill-pane': 'Kill pane', 'kill-window': 'Kill window',
    'send-prefix': 'Send prefix to the app', 'break-pane': 'Break pane out to its own window',
    'join-pane': 'Join pane into this window', 'copy-mode': 'Enter copy mode', 'paste-buffer': 'Paste',
    'detach-client': 'Detach', 'choose-tree': 'Choose session/window', 'command-prompt': 'Command prompt',
    'rotate-window': 'Rotate panes', 'display-panes': 'Show pane numbers', 'suspend-client': 'Suspend',
  };
  const word = cmd.split(/\s+/)[0];
  if (simple[word]) return simple[word];
  return humanize(cmd.length > 40 ? word : cmd);
}

function groupFor(desc, cmd, table) {
  if (table.startsWith('copy-mode')) return 'Copy mode';
  if (/plugins\//.test(cmd)) return 'Plugins';
  const text = `${desc} ${cmd}`.toLowerCase();
  if (/pane|split|layout/.test(text)) return 'Panes';
  if (/window/.test(text)) return 'Windows';
  if (/session|client|detach|suspend/.test(text)) return 'Sessions';
  if (/copy|paste|buffer/.test(text)) return 'Copy & paste';
  return 'Other';
}

function runTmux(args) {
  return new Promise((resolve, reject) => {
    execFile('tmux', args, { timeout: 15000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) reject(err); else resolve(stdout);
    });
  });
}

const SEP = '@@KEYMAPS-SEP@@';

async function importTmux(source) {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = source.config
    ? [expandHome(source.config)]
    : [path.join(base, 'tmux', 'tmux.conf'), path.join(os.homedir(), '.tmux.conf')];
  const config = candidates.find((f) => fs.existsSync(f));
  if (!config) {
    return { bindings: [], watchFiles: candidates, notices: [`No tmux config found at ${candidates.join(' or ')}.`] };
  }

  const socket = `keymaps-probe-${process.pid}-${Date.now()}`;
  const out = await runTmux([
    '-L', socket, '-f', config, 'start-server',
    ';', 'show', '-gv', 'prefix',
    ';', 'display', '-p', SEP,
    ';', 'list-keys', '-N', '-T', 'prefix',
    ';', 'display', '-p', SEP,
    ';', 'list-keys',
    ';', 'kill-server',
  ]).finally(() => runTmux(['-L', socket, 'kill-server']).catch(() => {}));

  const [prefixOut, notesOut, keysOut] = out.split(SEP + '\n');
  const prefix = prefixOut.trim().split('\n').pop().trim();
  const prefixStep = tmuxStep(prefix);

  // Built-in descriptions: "C-Space Tab     Switch to a window"
  const notes = new Map();
  for (const line of (notesOut || '').split('\n')) {
    if (!line.startsWith(prefix + ' ')) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line.slice(prefix.length + 1));
    if (m) notes.set(m[1], m[2].trim());
  }

  const tables = { prefix: 'normal', root: 'normal' };
  if (source.copy_mode !== false) tables['copy-mode-vi'] = 'copy';

  const bindings = [];
  for (const line of (keysOut || '').split('\n')) {
    const m = /^bind-key\s+((?:-\w\s+)*)-T\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, flags, table, key, cmd] = m;
    if (!(table in tables) || SKIP_KEY.test(key)) continue;
    const keyStep = tmuxStep(key);
    const unescaped = key.length > 1 && key.startsWith('\\') ? key.slice(1) : key;
    const desc = (table === 'prefix' && (notes.get(key) || notes.get(unescaped))) || describeCommand(cmd);
    const steps = table === 'prefix' ? [prefixStep, keyStep] : [keyStep];
    bindings.push({
      keys: table === 'prefix' ? `prefix ${unescaped}` : unescaped,
      desc,
      group: groupFor(desc, cmd, table),
      modes: [tables[table]],
      note: flags.includes('-r') ? 'repeatable: press again without the prefix' : '',
      steps,
    });
  }

  let watchFiles = [config];
  try { watchFiles = [fs.realpathSync(config)]; } catch { /* keep */ }
  // Lets hand-written binds in the app's .toml say "prefix x".
  const prefixAlias = prefixStep.key ? [...prefixStep.mods, prefixStep.key].join('+') : prefix;
  return { bindings, watchFiles, notices: [], aliases: { prefix: prefixAlias } };
}

module.exports = { importTmux, tmuxStep, describeCommand };
