// Key identifiers, labels, and parsing of keybind strings into key steps.
//
// A binding's `keys` string is a whitespace-separated sequence of steps.
// Each step is one of:
//   - a chord joined with "+":       Super+Shift+Q, Ctrl+w
//   - a single named key or char:    Space, F5, G (uppercase = Shift+g), ?
//   - vim notation:                  <leader>ff, <C-w>v, gg, <S-Tab>
// Aliases (per app) substitute whole tokens: leader = "Space", "$mainMod" = "Super".

const MOD_ORDER = ['Super', 'Ctrl', 'Alt', 'Shift'];

const MOD_NAMES = {
  shift: 'Shift',
  ctrl: 'Ctrl', control: 'Ctrl', ctl: 'Ctrl',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  super: 'Super', win: 'Super', windows: 'Super', mod: 'Super', mod4: 'Super',
  mainmod: 'Super', $mainmod: 'Super', cmd: 'Super', command: 'Super', logo: 'Super', meta: 'Super',
};

// Physical keys that act as each modifier.
const MOD_KEYS = {
  Shift: ['LShift', 'RShift'],
  Ctrl: ['LCtrl', 'RCtrl'],
  Alt: ['LAlt', 'RAlt'],
  Super: ['LSuper', 'RSuper'],
};

const KEY_LABELS = {
  Esc: 'Esc', Grave: '`', Minus: '-', Equal: '=', Backspace: 'Bksp', Tab: 'Tab',
  LBracket: '[', RBracket: ']', Backslash: '\\', Caps: 'Caps', Semicolon: ';', Quote: "'",
  Enter: 'Enter', Comma: ',', Period: '.', Slash: '/', Space: 'Space',
  LShift: 'Shift', RShift: 'Shift', LCtrl: 'Ctrl', RCtrl: 'Ctrl', LAlt: 'Alt', RAlt: 'Alt',
  LSuper: 'Super', RSuper: 'Super', Fn: 'Fn', Menu: 'Menu',
  Left: '←', Right: '→', Up: '↑', Down: '↓',
  Ins: 'Ins', Del: 'Del', Home: 'Home', End: 'End', PgUp: 'PgUp', PgDn: 'PgDn',
  PrtSc: 'PrtSc', ScrLk: 'ScrLk', Pause: 'Pause', Knob: 'Knob',
  NumLock: 'Num', KPSlash: '/', KPStar: '*', KPMinus: '-', KPPlus: '+', KPEnter: 'Enter', KPDot: '.',
};
for (let i = 1; i <= 24; i++) KEY_LABELS['F' + i] = 'F' + i;
for (let i = 0; i <= 9; i++) { KEY_LABELS[String(i)] = String(i); KEY_LABELS['KP' + i] = String(i); }
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEY_LABELS[c] = c;

// Shifted labels shown on keycaps (top legend).
const SHIFT_LEGENDS = {
  Grave: '~', 1: '!', 2: '@', 3: '#', 4: '$', 5: '%', 6: '^', 7: '&', 8: '*', 9: '(', 0: ')',
  Minus: '_', Equal: '+', LBracket: '{', RBracket: '}', Backslash: '|', Semicolon: ':',
  Quote: '"', Comma: '<', Period: '>', Slash: '?',
};

const UNSHIFTED_CHARS = {
  '`': 'Grave', '-': 'Minus', '=': 'Equal', '[': 'LBracket', ']': 'RBracket', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
};
const SHIFTED_CHARS = {};
for (const [key, ch] of Object.entries(SHIFT_LEGENDS)) SHIFTED_CHARS[ch] = key;

// Named keys (lowercase). Values are a key id, or [keyId, 'Shift'] for shifted names.
const KEY_NAMES = {
  esc: 'Esc', escape: 'Esc',
  grave: 'Grave', backtick: 'Grave', tilde: ['Grave', 'Shift'],
  minus: 'Minus', equal: 'Equal', equals: 'Equal', plus: ['Equal', 'Shift'],
  backspace: 'Backspace', bs: 'Backspace', bksp: 'Backspace',
  tab: 'Tab',
  lbracket: 'LBracket', bracketleft: 'LBracket', rbracket: 'RBracket', bracketright: 'RBracket',
  backslash: 'Backslash', bslash: 'Backslash', bar: ['Backslash', 'Shift'],
  caps: 'Caps', capslock: 'Caps',
  semicolon: 'Semicolon', colon: ['Semicolon', 'Shift'],
  quote: 'Quote', apostrophe: 'Quote',
  enter: 'Enter', return: 'Enter', cr: 'Enter',
  comma: 'Comma', lt: ['Comma', 'Shift'], period: 'Period', dot: 'Period', slash: 'Slash',
  space: 'Space', spc: 'Space',
  left: 'Left', right: 'Right', up: 'Up', down: 'Down',
  ins: 'Ins', insert: 'Ins', del: 'Del', delete: 'Del',
  home: 'Home', end: 'End',
  pgup: 'PgUp', pageup: 'PgUp', prior: 'PgUp', pgdn: 'PgDn', pagedown: 'PgDn', next: 'PgDn',
  print: 'PrtSc', prtsc: 'PrtSc', printscreen: 'PrtSc', sysrq: 'PrtSc',
  scrolllock: 'ScrLk', scrlk: 'ScrLk', pause: 'Pause', menu: 'Menu', fn: 'Fn',
  knob: 'Knob',
  xf86audioraisevolume: 'Knob', xf86audiolowervolume: 'Knob', xf86audiomute: 'Knob',
  numlock: 'NumLock', kpenter: 'KPEnter', kpplus: 'KPPlus', kpminus: 'KPMinus',
  kpmultiply: 'KPStar', kpstar: 'KPStar', kpdivide: 'KPSlash', kpslash: 'KPSlash',
  kpdot: 'KPDot', kpdecimal: 'KPDot', kpperiod: 'KPDot',
};
for (let i = 0; i <= 9; i++) KEY_NAMES['kp' + i] = 'KP' + i;
for (const id of ['LShift', 'RShift', 'LCtrl', 'RCtrl', 'LAlt', 'RAlt', 'LSuper', 'RSuper']) {
  KEY_NAMES[id.toLowerCase()] = id;
}

const VIM_MOD_LETTERS = { c: 'Ctrl', s: 'Shift', a: 'Alt', m: 'Alt', d: 'Super', t: 'Super' };

/**
 * Look up one token. Returns {key, mods:[]} for a key, {mod} for a modifier, or null.
 * `caseShift`: a single uppercase letter means Shift+letter (vim style).
 */
function lookup(tok, caseShift) {
  if (tok.length === 1) {
    if (/[a-z]/i.test(tok)) {
      const shifted = caseShift && tok !== tok.toLowerCase();
      return { key: tok.toUpperCase(), mods: shifted ? ['Shift'] : [] };
    }
    if (/[0-9]/.test(tok)) return { key: tok, mods: [] };
    if (UNSHIFTED_CHARS[tok]) return { key: UNSHIFTED_CHARS[tok], mods: [] };
    if (SHIFTED_CHARS[tok]) return { key: SHIFTED_CHARS[tok], mods: ['Shift'] };
    return null;
  }
  const low = tok.toLowerCase();
  if (MOD_NAMES[low]) return { mod: MOD_NAMES[low] };
  const named = KEY_NAMES[low];
  if (named) return Array.isArray(named) ? { key: named[0], mods: [named[1]] } : { key: named, mods: [] };
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(low);
  if (f) return { key: 'F' + f[1], mods: [] };
  return null;
}

function step(mods, key, raw) {
  const set = [...new Set(mods)].sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  const s = { mods: set, key };
  if (raw !== undefined) s.raw = raw;
  return s;
}

function unknownStep(raw) {
  return { mods: [], key: null, raw };
}

class Parser {
  constructor(aliases = {}) {
    this.aliases = {};
    for (const [k, v] of Object.entries(aliases)) this.aliases[k.toLowerCase()] = String(v);
    if (!this.aliases.leader) this.aliases.leader = '\\';
    if (!this.aliases.localleader) this.aliases.localleader = this.aliases.leader;
    this.depth = 0;
  }

  alias(name) {
    const v = this.aliases[name.toLowerCase()];
    if (v === undefined) return null;
    if (this.depth > 8) throw new Error(`alias "${name}" is recursive`);
    this.depth++;
    try { return this.parse(v); } finally { this.depth--; }
  }

  parse(str) {
    const steps = [];
    for (const part of String(str).trim().split(/\s+/)) {
      if (part) steps.push(...this.parseStep(part));
    }
    return steps;
  }

  parseStep(s) {
    const aliased = this.alias(s);
    if (aliased) return aliased;
    if (s.length > 1 && s.includes('+')) return [this.parseChord(s)];
    const hit = lookup(s, true);
    if (hit) return hit.mod ? [step([], 'L' + hit.mod)] : [step(hit.mods, hit.key)];
    return this.parseVim(s);
  }

  parseChord(s) {
    let parts = s.split('+');
    if (s.endsWith('++')) parts = s.slice(0, -2).split('+').concat(['+']);
    const mods = [];
    let key = null;
    let raw;
    for (const p of parts) {
      if (!p) continue;
      let hit = null;
      const aliased = this.alias(p);
      if (aliased && aliased.length === 1) {
        const a = aliased[0];
        // An alias to a bare modifier parses as that modifier's left key.
        const asMod = a.mods.length === 0 && /^L(Super|Ctrl|Alt|Shift)$/.exec(a.key || '');
        hit = asMod ? { mod: asMod[1] } : { key: a.key, mods: a.mods, raw: a.raw };
      } else {
        hit = lookup(p, false);
      }
      if (!hit) { raw = p; key = null; continue; }
      if (hit.mod) { mods.push(hit.mod); continue; }
      mods.push(...hit.mods);
      if (key) raw = s; // two non-modifier keys in one chord: can't place it
      key = hit.key;
      if (hit.raw) raw = hit.raw;
    }
    if (raw !== undefined) return step(mods, null, raw);
    if (!key) {
      // Modifier-only binding (e.g. tap Super): show it on the left modifier key.
      const last = mods.pop();
      if (!last) return unknownStep(s);
      return step(mods.filter((m) => m !== last), 'L' + last);
    }
    return step(mods, key);
  }

  parseVim(s) {
    const steps = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '<') {
        const j = s.indexOf('>', i + 2);
        if (j !== -1) {
          steps.push(...this.parseVimGroup(s.slice(i + 1, j)));
          i = j;
          continue;
        }
      }
      const hit = lookup(ch, true);
      steps.push(hit ? step(hit.mods, hit.key) : unknownStep(ch));
    }
    return steps;
  }

  parseVimGroup(inner) {
    const aliased = this.alias(inner);
    if (aliased) return aliased;
    const m = /^((?:[csamdt]-)+)(.+)$/i.exec(inner);
    if (m) {
      const mods = m[1].split('-').filter(Boolean).map((l) => VIM_MOD_LETTERS[l.toLowerCase()]);
      const hit = lookup(m[2], false);
      if (hit && !hit.mod) return [step(mods.concat(hit.mods), hit.key)];
      return [unknownStep(`<${inner}>`)];
    }
    const hit = lookup(inner, false);
    if (hit && !hit.mod) return [step(hit.mods, hit.key)];
    return [unknownStep(`<${inner}>`)];
  }
}

function parseKeys(str, aliases) {
  return new Parser(aliases).parse(str);
}

// Pure vim notation, as Neovim reports it (no "+" chords, spaces are literal keys).
function parseVimKeys(str, aliases) {
  return new Parser(aliases).parseVim(String(str).replace(/ /g, '<Space>'));
}

module.exports = { parseKeys, parseVimKeys, lookup, step, unknownStep, MOD_ORDER, MOD_KEYS, KEY_LABELS, SHIFT_LEGENDS };
