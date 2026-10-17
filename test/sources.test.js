const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { importHyprland } = require('../src/main/sources/hyprland');
const { toBindings } = require('../src/main/sources/neovim');

const s = (mods, key) => ({ mods, key });

test('hyprland: parses binds, vars, includes, descriptions, submaps', async () => {
  const conf = path.join(__dirname, 'fixtures', 'hypr', 'hyprland.conf');
  const { bindings, watchFiles, notices } = await importHyprland({ path: conf });
  assert.deepEqual(notices, []);
  assert.equal(watchFiles.length, 2);
  const by = (keys) => bindings.find((b) => b.keys === keys);

  assert.equal(by('Super+q').desc, 'Open terminal (kitty)');
  assert.deepEqual(by('Super+q').steps, [s(['Super'], 'Q')]);
  assert.equal(by('Super+q').group, 'Apps');
  assert.equal(by('Super+c').desc, 'Close window');
  assert.equal(by('Super+Shift+3').desc, 'Move window to workspace 3');
  assert.equal(by('Super+mouse_down').desc, 'Next workspace');
  assert.equal(by('Super+mouse:272').group, 'Mouse');
  assert.equal(by('XF86AudioRaiseVolume').group, 'Media');
  assert.equal(by('XF86AudioRaiseVolume').desc, 'Volume up');
  assert.deepEqual(by('XF86AudioRaiseVolume').steps, [s([], 'Knob')]);
  assert.match(by('XF86AudioRaiseVolume').note, /repeats/);
  assert.equal(by('Super+v').desc, 'Float it');
  assert.deepEqual(by('Super+Shift+a').steps, [s(['Super', 'Shift'], 'A')]);
  assert.equal(by('Super+r').desc, 'App launcher');
  assert.equal(by('Super+x'), undefined, 'unbind removes it');
  assert.equal(by('Alt+r').desc, 'Enter "resize" mode');
  assert.deepEqual(by('Alt+r right').steps, [s(['Alt'], 'R'), s([], 'Right')], 'submap binds follow the key that enters them');
  assert.deepEqual(by('Alt+r right').modes, []);
  assert.match(by('Alt+r right').note, /in resize mode/);
  assert.deepEqual(by('Super+q').modes, []);
});

test('hyprland: missing config is a notice, not an error', async () => {
  const { bindings, notices, watchFiles } = await importHyprland({ path: '/nonexistent/hyprland.conf' });
  assert.equal(bindings.length, 0);
  assert.equal(notices.length, 1);
  assert.deepEqual(watchFiles, ['/nonexistent/hyprland.conf']);
});

test('neovim: converts a keymap dump', () => {
  const dump = {
    leader: ' ',
    localleader: '\\',
    maps: [
      { mode: 'n', lhs: ' ff', desc: 'Find Files' },
      { mode: 'x', lhs: ' ff', desc: 'Find Files' },
      { mode: 'n', lhs: '<C-W>v', desc: 'Split' },
      { mode: 'i', lhs: 'jk', rhs: '<Esc>' },
      { mode: 'n', lhs: '<Plug>(Foo)', rhs: 'x' },
      { mode: 'n', lhs: 'gx', rhs: '<Plug>(Open)' },
      { mode: 'n', lhs: 'f' },
      { mode: 'n', lhs: ' uw', desc: 'Wrap' },
    ],
    groups: [{ lhs: '<leader>f', group: 'file/find', mode: ['n', 'x'] }, { lhs: '<leader>u', group: 'ui', mode: 'n' }],
  };
  const { bindings, undescribed } = toBindings(dump, { exclude: ['<leader>u'] });
  const by = (keys) => bindings.find((b) => b.keys === keys);
  assert.deepEqual(by('<leader>ff').steps, [s([], 'Space'), s([], 'F'), s([], 'F')]);
  assert.deepEqual(by('<leader>ff').modes, ['normal', 'visual']);
  assert.equal(by('<leader>ff').group, 'File/find');
  assert.deepEqual(by('<C-W>v').steps, [s(['Ctrl'], 'W'), s([], 'V')]);
  assert.equal(by('jk').desc, '→ <Esc>');
  assert.equal(by('gx').desc, 'Open');
  assert.equal(by('<leader>uw'), undefined, 'excluded');
  assert.equal(bindings.length, 4);
  assert.deepEqual(undescribed.map((u) => u.keys), ['f']);
});

test('hyprland lua: runs the config against a stand-in API', async () => {
  const fs = require('fs');
  const conf = path.join(__dirname, 'fixtures', 'hypr-lua', 'hyprland.lua');
  const { bindings, notices, watchDirs } = await importHyprland({ path: ['/nonexistent/hyprland.lua', conf] });
  const by = (keys) => bindings.find((b) => b.keys === keys);
  assert.equal(bindings.length, 6);
  assert.equal(by('Super+Return').desc, 'Terminal');
  assert.equal(by('Super+Return').group, 'Apps');
  assert.equal(by('Super+b').desc, 'Run firefox', 'falls back to the action');
  assert.deepEqual(by('Super+Shift+h').steps, [s(['Super', 'Shift'], 'H')]);
  assert.equal(by('Super+Shift+l').group, 'Windows');
  assert.deepEqual(by('h').modes, ['resize']);
  assert.match(by('h').note, /repeats/);
  assert.equal(by('XF86AudioRaiseVolume').group, 'Media keys');
  assert.equal(notices.length, 1, 'the broken file is reported, the rest still loads');
  assert.match(notices[0], /oops/);
  assert.equal(watchDirs.length, 1);
  assert.ok(!fs.existsSync('/tmp/keymaps-should-not-exist'), 'os.execute is neutralised');
});

test('tmux: key notation and command descriptions', () => {
  const { tmuxStep, describeCommand } = require('../src/main/sources/tmux');
  assert.deepEqual(tmuxStep('C-Space'), s(['Ctrl'], 'Space'));
  assert.deepEqual(tmuxStep('M-H'), s(['Alt', 'Shift'], 'H'));
  assert.deepEqual(tmuxStep('\\%'), s(['Shift'], '5'));
  assert.deepEqual(tmuxStep('BTab'), s(['Shift'], 'Tab'));
  assert.deepEqual(tmuxStep('NPage'), s([], 'PgDn'));
  assert.equal(describeCommand('split-window -h -c "#{pane_current_path}"'), 'Split pane side by side');
  assert.equal(describeCommand('resize-pane -D 5'), 'Resize pane down');
  assert.equal(describeCommand('send-keys -X begin-selection'), 'Begin selection');
  assert.equal(describeCommand('if-shell "$is_vim" "send-keys C-h" "select-pane -L"'), 'Pane left (vim-aware)');
  assert.equal(describeCommand('run-shell -b /home/x/.config/tmux/plugins/tmux-fzf/main.sh'), 'Open tmux-fzf');
});
