// Keyboard layouts, described with a compact row syntax:
//
//   Each row is a string of space-separated tokens:
//     Id            a 1u key (Id is a key id like Q, LShift, F5, Knob)
//     Id:1.5        a key 1.5u wide
//     Id:1x2        a key 1u wide and 2u tall
//     Id@0.25       a key shifted down by 0.25u (e.g. arrow clusters)
//     Id=Opt        custom keycap legend (the key still acts as Id)
//     _0.25         horizontal gap of 0.25u
//   A row that is just "~0.25" adds vertical space instead of a row of keys.
//
// User layouts live in <config>/layouts/*.toml with `name` and `rows`.

const { KEY_LABELS } = require('./keys');

const BUILTIN = {
  'keychron-q1-max': {
    name: 'Keychron Q1 Max (75% ANSI)',
    rows: [
      'Esc _0.25 F1 F2 F3 F4 _0.25 F5 F6 F7 F8 _0.25 F9 F10 F11 F12 _0.25 Del _0.25 Knob',
      '~0.25',
      'Grave 1 2 3 4 5 6 7 8 9 0 Minus Equal Backspace:2 _0.25 PgUp',
      'Tab:1.5 Q W E R T Y U I O P LBracket RBracket Backslash:1.5 _0.25 PgDn',
      'Caps:1.75 A S D F G H J K L Semicolon Quote Enter:2.25 _0.25 Home',
      'LShift:2.25 Z X C V B N M Comma Period Slash RShift:1.75 _0.25 Up@0.25',
      'LCtrl:1.25 LSuper:1.25=Opt LAlt:1.25 Space:6.25 RAlt Fn RCtrl _0.25 Left@0.25 Down@0.25 Right@0.25',
    ],
  },
  'ansi-60': {
    name: 'ANSI 60%',
    rows: [
      'Esc 1 2 3 4 5 6 7 8 9 0 Minus Equal Backspace:2',
      'Tab:1.5 Q W E R T Y U I O P LBracket RBracket Backslash:1.5',
      'Caps:1.75 A S D F G H J K L Semicolon Quote Enter:2.25',
      'LShift:2.25 Z X C V B N M Comma Period Slash RShift:2.75',
      'LCtrl:1.25 LSuper:1.25 LAlt:1.25 Space:6.25 RAlt:1.25 Fn:1.25 Menu:1.25 RCtrl:1.25',
    ],
  },
  'ansi-tkl': {
    name: 'ANSI TKL (87)',
    rows: [
      'Esc _1 F1 F2 F3 F4 _0.5 F5 F6 F7 F8 _0.5 F9 F10 F11 F12 _0.25 PrtSc ScrLk Pause',
      '~0.25',
      'Grave 1 2 3 4 5 6 7 8 9 0 Minus Equal Backspace:2 _0.25 Ins Home PgUp',
      'Tab:1.5 Q W E R T Y U I O P LBracket RBracket Backslash:1.5 _0.25 Del End PgDn',
      'Caps:1.75 A S D F G H J K L Semicolon Quote Enter:2.25',
      'LShift:2.25 Z X C V B N M Comma Period Slash RShift:2.75 _1.25 Up',
      'LCtrl:1.25 LSuper:1.25 LAlt:1.25 Space:6.25 RAlt:1.25 RSuper:1.25 Menu:1.25 RCtrl:1.25 _0.25 Left Down Right',
    ],
  },
  'ansi-full': {
    name: 'ANSI Full Size (104)',
    rows: [
      'Esc _1 F1 F2 F3 F4 _0.5 F5 F6 F7 F8 _0.5 F9 F10 F11 F12 _0.25 PrtSc ScrLk Pause',
      '~0.25',
      'Grave 1 2 3 4 5 6 7 8 9 0 Minus Equal Backspace:2 _0.25 Ins Home PgUp _0.25 NumLock KPSlash KPStar KPMinus',
      'Tab:1.5 Q W E R T Y U I O P LBracket RBracket Backslash:1.5 _0.25 Del End PgDn _0.25 KP7 KP8 KP9 KPPlus:1x2',
      'Caps:1.75 A S D F G H J K L Semicolon Quote Enter:2.25 _3.5 KP4 KP5 KP6',
      'LShift:2.25 Z X C V B N M Comma Period Slash RShift:2.75 _1.25 Up _1.25 KP1 KP2 KP3 KPEnter:1x2',
      'LCtrl:1.25 LSuper:1.25 LAlt:1.25 Space:6.25 RAlt:1.25 RSuper:1.25 Menu:1.25 RCtrl:1.25 _0.25 Left Down Right _0.25 KP0:2 KPDot',
    ],
  },
};

function num(s, token) {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad number in "${token}"`);
  return n;
}

function buildLayout(id, def) {
  if (!def || typeof def.name !== 'string' || !Array.isArray(def.rows)) {
    throw new Error('layout needs a `name` string and a `rows` array');
  }
  const keys = [];
  let y = 0;
  let width = 0;
  let height = 0;
  for (const row of def.rows) {
    const text = String(row).trim();
    if (text.startsWith('~')) { y += num(text.slice(1), text); continue; }
    let x = 0;
    for (const token of text.split(/\s+/).filter(Boolean)) {
      if (token.startsWith('_')) { x += num(token.slice(1), token); continue; }
      const m = /^([^:@=]+)(?::([\d.]+)(?:x([\d.]+))?)?(?:@([\d.]+))?(?:=(.+))?$/.exec(token);
      if (!m) throw new Error(`can't read key token "${token}"`);
      const w = m[2] ? num(m[2], token) : 1;
      const h = m[3] ? num(m[3], token) : 1;
      const dy = m[4] ? num(m[4], token) : 0;
      const key = { id: m[1], label: KEY_LABELS[m[1]] || m[1], x, y: y + dy, w, h };
      if (m[5] && m[5] !== key.label) {
        key.sub = key.label.toLowerCase(); // what it does, shown small under the custom legend
        key.label = m[5];
      }
      keys.push(key);
      x += w;
      width = Math.max(width, x);
      height = Math.max(height, y + dy + h);
    }
    y += 1;
  }
  return { id, name: def.name, keys, width, height };
}

function builtinLayouts() {
  return Object.entries(BUILTIN).map(([id, def]) => buildLayout(id, def));
}

module.exports = { buildLayout, builtinLayouts };
