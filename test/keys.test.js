const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { parseKeys } = require('../src/main/keys');
const { builtinLayouts } = require('../src/main/layouts');
const config = require('../src/main/config');

const s = (mods, key) => ({ mods, key });

test('chords', () => {
  assert.deepEqual(parseKeys('Super+Shift+Q'), [s(['Super', 'Shift'], 'Q')]);
  assert.deepEqual(parseKeys('ctrl+alt+del'), [s(['Ctrl', 'Alt'], 'Del')]);
  assert.deepEqual(parseKeys('$mainMod+1'), [s(['Super'], '1')]);
  assert.deepEqual(parseKeys('Ctrl++'), [s(['Ctrl', 'Shift'], 'Equal')]);
  assert.deepEqual(parseKeys('Ctrl+?'), [s(['Ctrl', 'Shift'], 'Slash')]);
});

test('sequences of chords', () => {
  assert.deepEqual(parseKeys('Ctrl+b c'), [s(['Ctrl'], 'B'), s([], 'C')]);
});

test('vim notation', () => {
  const al = { leader: 'Space' };
  assert.deepEqual(parseKeys('<leader>ff', al), [s([], 'Space'), s([], 'F'), s([], 'F')]);
  assert.deepEqual(parseKeys('<C-w>v'), [s(['Ctrl'], 'W'), s([], 'V')]);
  assert.deepEqual(parseKeys('gg'), [s([], 'G'), s([], 'G')]);
  assert.deepEqual(parseKeys('G'), [s(['Shift'], 'G')]);
  assert.deepEqual(parseKeys('gT'), [s([], 'G'), s(['Shift'], 'T')]);
  assert.deepEqual(parseKeys('<S-Tab>'), [s(['Shift'], 'Tab')]);
  assert.deepEqual(parseKeys('<lt>'), [s(['Shift'], 'Comma')]);
  assert.deepEqual(parseKeys('$'), [s(['Shift'], '4')]);
  assert.deepEqual(parseKeys(']d'), [s([], 'RBracket'), s([], 'D')]);
  assert.deepEqual(parseKeys('<Esc>'), [s([], 'Esc')]);
});

test('named keys and modifier-only binds', () => {
  assert.deepEqual(parseKeys('Escape'), [s([], 'Esc')]);
  assert.deepEqual(parseKeys('XF86AudioMute'), [s([], 'Knob')]);
  assert.deepEqual(parseKeys('Super'), [s([], 'LSuper')]);
});

test('unknown tokens are kept as raw text', () => {
  const [st] = parseKeys('Super+mouse:272');
  assert.equal(st.key, null);
  assert.equal(st.raw, 'mouse:272');
});

test('built-in layouts have no overlapping keys', () => {
  for (const layout of builtinLayouts()) {
    const ks = layout.keys;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i], b = ks[j];
        const overlap = a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 &&
          a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
        assert.ok(!overlap, `${layout.id}: ${a.id} overlaps ${b.id}`);
      }
    }
  }
  const q1 = builtinLayouts().find((l) => l.id === 'keychron-q1-max');
  assert.equal(q1.width, 16.25);
  assert.equal(q1.keys.length, 82); // 81 keys + knob
});

test('example configs load cleanly', async () => {
  const data = await config.load(path.join(__dirname, '..', 'examples'));
  assert.deepEqual(data.errors, []);
  assert.deepEqual(data.apps.map((a) => a.id), ['hyprland', 'neovim', 'tmux']);
});

test('Q1 Max shows Opt on the Super key', () => {
  const q1 = builtinLayouts().find((l) => l.id === 'keychron-q1-max');
  const k = q1.keys.find((x) => x.id === 'LSuper');
  assert.equal(k.label, 'Opt');
  assert.equal(k.sub, 'super');
});
