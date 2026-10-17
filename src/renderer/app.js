'use strict';

const api = window.keymaps;
const $ = (id) => document.getElementById(id);

const DEFAULT_COLOR = '#3a7bd5';
const MOD_ORDER = ['Super', 'Ctrl', 'Alt', 'Shift'];

// Browser KeyboardEvent.code -> our key ids.
const CODE_TO_KEY = {
  Escape: 'Esc', Backquote: 'Grave', Minus: 'Minus', Equal: 'Equal', Backspace: 'Backspace',
  Tab: 'Tab', BracketLeft: 'LBracket', BracketRight: 'RBracket', Backslash: 'Backslash',
  CapsLock: 'Caps', Semicolon: 'Semicolon', Quote: 'Quote', Enter: 'Enter',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Space: 'Space',
  ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
  AltLeft: 'LAlt', AltRight: 'RAlt', MetaLeft: 'LSuper', MetaRight: 'RSuper', OSLeft: 'LSuper', OSRight: 'RSuper',
  ContextMenu: 'Menu', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  PrintScreen: 'PrtSc', ScrollLock: 'ScrLk', Pause: 'Pause', NumLock: 'NumLock',
  NumpadDivide: 'KPSlash', NumpadMultiply: 'KPStar', NumpadSubtract: 'KPMinus', NumpadAdd: 'KPPlus',
  NumpadEnter: 'KPEnter', NumpadDecimal: 'KPDot',
  AudioVolumeUp: 'Knob', AudioVolumeDown: 'Knob', AudioVolumeMute: 'Knob',
};
function codeToKey(code) {
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'KP' + m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  return null;
}

let data = null;
const state = {
  appId: null,
  layoutId: null,
  mode: null,
  query: '',
  held: new Set(),     // modifiers currently held (clicked or physically pressed)
  physHeld: new Set(), // the subset that is physically held down
  prefix: [],          // completed steps of a sequence in progress
  pop: null,           // { key, mods, prefix } snapshot for the popover
  trace: null,         // binding id hovered in a list
  pinned: null,        // binding id clicked in the list
};

// ---------- tiny DOM helper ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- derived data ----------

const currentApp = () => data.apps.find((a) => a.id === state.appId) || null;
const currentLayout = () => data.layouts.find((l) => l.id === state.layoutId) || data.layouts[0];

function modOfKey(id) {
  for (const [mod, keys] of Object.entries(data.modKeys)) if (keys.includes(id)) return mod;
  return null;
}

const modsEq = (list, set) => list.length === set.size && list.every((m) => set.has(m));
const stepEq = (a, b) => a.key === b.key && a.mods.length === b.mods.length && a.mods.every((m) => b.mods.includes(m));
const prefixMatches = (b, prefix) => b.steps.length > prefix.length && prefix.every((p, i) => stepEq(p, b.steps[i]));

function filteredBindings() {
  const app = currentApp();
  if (!app) return [];
  const q = state.query.trim().toLowerCase();
  return app.bindings.filter((b) => {
    if (state.mode && b.modes.length && !b.modes.includes(state.mode)) return false;
    if (!q) return true;
    return [b.desc, b.group, b.keys, b.note, ...b.modes].some((s) => s && s.toLowerCase().includes(q));
  });
}

// For the given prefix + held modifiers: which keys finish or continue a binding,
// and how many binds each not-yet-held modifier would unlock.
function analyze(bindings, prefix, held) {
  const keys = new Map();
  const modHints = {};
  for (const b of bindings) {
    if (!prefixMatches(b, prefix)) continue;
    const next = b.steps[prefix.length];
    if (!next.key) continue;
    if (modsEq(next.mods, held)) {
      if (!keys.has(next.key)) keys.set(next.key, { finals: [], conts: [] });
      const entry = keys.get(next.key);
      (b.steps.length === prefix.length + 1 ? entry.finals : entry.conts).push(b);
    } else if ([...held].every((m) => next.mods.includes(m))) {
      for (const m of next.mods) if (!held.has(m)) modHints[m] = (modHints[m] || 0) + 1;
    }
  }
  return { keys, modHints };
}

// ---------- key labels ----------

function keyText(step) {
  if (!step.key) return [...step.mods, step.raw || '?'].join('+');
  const label = data.keyLabels[step.key] || step.key;
  if (step.mods.length === 1 && step.mods[0] === 'Shift') {
    if (data.shiftLegends[step.key]) return data.shiftLegends[step.key];
    if (/^[A-Z]$/.test(step.key)) return step.key;
  }
  const keyPart = /^[A-Z]$/.test(step.key) && !step.mods.length ? step.key.toLowerCase() : label;
  return [...step.mods, keyPart].join('+');
}

let boardKeys = { id: null, set: new Set() };
function onBoard(key) {
  const layout = currentLayout();
  if (boardKeys.id !== layout.id) boardKeys = { id: layout.id, set: new Set(layout.keys.map((k) => k.id)) };
  return boardKeys.set.has(key);
}

function chips(steps, doneCount = 0) {
  return h('span', { class: 'chips' },
    steps.map((s, i) => {
      const missing = !s.key || !onBoard(s.key);
      return h('kbd', {
        class: [missing ? 'unknown' : '', i < doneCount ? 'done' : ''].join(' ').trim() || null,
        title: missing ? 'Not on this keyboard layout' : null,
      }, keyText(s));
    }));
}

// ---------- rendering ----------

function render() {
  if (!data) return;
  const app = currentApp();
  document.documentElement.style.setProperty('--app', (app && app.color) || DEFAULT_COLOR);
  renderApps();
  renderLayoutPicker();
  renderErrors();
  renderModes();
  renderNotices();
  renderStatus();
  renderBoard();
  renderPop();
  renderList();
}

function renderApps() {
  $('apps').replaceChildren(...data.apps.map((a) =>
    h('button', {
      class: 'app-tab' + (a.id === state.appId ? ' active' : ''),
      style: { '--tab-color': a.color || DEFAULT_COLOR },
      title: a.description || a.file,
      onclick: () => selectApp(a.id),
    }, h('span', { class: 'dot' }), a.name, h('span', { class: 'count' }, a.bindings.length))));
}

function renderLayoutPicker() {
  const sel = $('layout');
  sel.replaceChildren(...data.layouts.map((l) => h('option', { value: l.id, selected: l.id === currentLayout().id }, l.name)));
}

function renderErrors() {
  const box = $('errors');
  box.hidden = !data.errors.length;
  box.replaceChildren(...data.errors.map((e) =>
    h('div', { class: 'err' },
      h('b', null, e.file.replace(data.configDir + '/', '')),
      h('span', null, e.message),
      h('button', { onclick: () => api.openFile(e.file) }, 'open'))));
}

function renderNotices() {
  const app = currentApp();
  $('notices').replaceChildren(...(app ? app.notices : []).map((n) => h('div', null, n)));
}

function renderModes() {
  const app = currentApp();
  const modes = app ? [...new Set(app.bindings.flatMap((b) => b.modes))] : [];
  if (state.mode && !modes.includes(state.mode)) state.mode = null;
  const box = $('modes');
  if (!modes.length) { box.replaceChildren(); return; }
  const btn = (label, mode) => h('button', {
    class: 'chip-btn' + (state.mode === mode ? ' active' : ''),
    onclick: () => {
      state.mode = mode;
      store.set('mode:' + state.appId, mode || '');
      closePop();
      render();
    },
  }, label);
  box.replaceChildren(btn('All modes', null), ...modes.map((m) => btn(`mode: ${m}`, m)));
}

function renderStatus() {
  const box = $('status');
  const parts = [];
  if (state.prefix.length) {
    parts.push(h('span', { class: 'crumb' }, 'Sequence:',
      state.prefix.map((s) => [h('kbd', null, keyText(s)), h('span', { class: 'sep' }, '▸')])));
  }
  if (state.held.size) {
    const mods = MOD_ORDER.filter((m) => state.held.has(m));
    parts.push(h('span', { class: 'crumb' }, 'Holding:', mods.map((m) => h('kbd', null, m))));
  }
  if (parts.length) {
    parts.push(h('button', { class: 'btn', onclick: reset }, 'Reset (Esc)'));
  } else if (currentApp()) {
    parts.push(h('span', null, 'Click a key to see what it does. Click or hold a modifier to see its combos. Your real keyboard works too.'));
  }
  box.replaceChildren(...parts);
}

function traceSteps() {
  const id = state.trace || state.pinned;
  if (!id) return null;
  const app = currentApp();
  const b = app && app.bindings.find((x) => x.id === id);
  if (!b) return null;
  // key id -> list of step numbers it takes part in
  const marks = new Map();
  const mark = (k, n) => { if (!marks.has(k)) marks.set(k, []); if (!marks.get(k).includes(n)) marks.get(k).push(n); };
  b.steps.forEach((s, i) => {
    if (s.key) mark(s.key, i + 1);
    for (const m of s.mods) for (const k of data.modKeys[m]) mark(k, i + 1);
  });
  return marks;
}

let unit = 56;

function renderBoard() {
  const board = $('board');
  const app = currentApp();
  if (!app) {
    board.hidden = true;
    let empty = document.querySelector('.empty');
    if (!empty) {
      empty = h('div', { class: 'empty' });
      $('board-wrap').append(empty);
    }
    empty.replaceChildren(
      h('h3', null, 'No apps yet'),
      h('p', null, `Add a .toml file to ${data.configDir}/apps and it will show up here.`),
      h('button', { class: 'btn', onclick: () => api.openConfig() }, 'Open config folder'));
    return;
  }
  document.querySelector('.empty')?.remove();
  board.hidden = false;

  const layout = currentLayout();
  // Fit the board to the space left in the window, both ways, so nothing scrolls.
  const area = $('board-area');
  const cs = getComputedStyle(area);
  const availW = $('board-wrap').clientWidth - 28;
  const availH = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
    - $('status').offsetHeight - parseFloat(cs.rowGap || 0) - 28;
  unit = Math.max(30, Math.min(84, Math.floor(Math.min(availW / layout.width, availH / layout.height))));
  const gap = Math.max(3, Math.round(unit * 0.07));
  board.style.setProperty('--u', unit + 'px');
  board.style.width = layout.width * unit - gap + 'px';
  board.style.height = layout.height * unit - gap + 'px';

  const { keys, modHints } = analyze(filteredBindings(), state.prefix, state.held);
  const marks = traceSteps();

  board.replaceChildren(...layout.keys.map((k) => {
    const mod = modOfKey(k.id);
    const entry = keys.get(k.id);
    const classes = ['key'];
    let act = null;
    let badge = null;

    if (k.id === 'Knob') classes.push('knob');
    if (entry) {
      if (entry.finals.length) classes.push('has-final');
      if (entry.conts.length) classes.push('has-cont');
      const total = entry.finals.length + entry.conts.length;
      if (entry.finals.length) act = entry.finals[0].desc;
      else if (entry.conts.length === 1) act = entry.conts[0].desc;
      else act = `${entry.conts.length} binds`;
      if (total > 1 && entry.finals.length) badge = total;
    }
    if (mod && state.held.has(mod)) {
      classes.push('held');
    } else if (mod && modHints[mod]) {
      classes.push('hint');
      if (!entry) { act = `${modHints[mod]} combos`; }
    } else if (!entry) {
      classes.push('idle');
    }
    if (state.pop && state.pop.key === k.id) classes.push('popped');
    if (marks && marks.has(k.id)) {
      classes.push('trace');
      badge = marks.get(k.id).join(',');
    }

    const shift = data.shiftLegends[k.id];
    return h('button', {
      class: classes.join(' '),
      'data-key': k.id,
      title: entry ? [...entry.finals, ...entry.conts].map((b) => `${b.keys}  —  ${b.desc}`).join('\n') : null,
      style: {
        left: 14 + k.x * unit + 'px',
        top: 14 + k.y * unit + 'px',
        width: k.w * unit - gap + 'px',
        height: k.h * unit - gap + 'px',
      },
      onclick: (e) => { e.stopPropagation(); pressKey(k.id); },
    },
    h('span', { class: 'legend' },
      shift ? h('span', { class: 'shift' }, shift) : null,
      k.id === 'Knob' ? '◎' : k.label,
      k.sub ? h('span', { class: 'sub' }, k.sub) : null),
    act ? h('span', { class: 'act' }, act) : null,
    badge ? h('span', { class: 'badge' }, badge) : null);
  }));
}

// Mode tags are noise when the list is already filtered to that one mode.
const modeTags = (b) => (state.mode && b.modes.length === 1 && b.modes[0] === state.mode ? [] : b.modes);

function bindRow(b, { doneCount = 0, showGroup = false } = {}) {
  return h('div', {
    class: 'bind' + (state.pinned === b.id ? ' pinned' : ''),
    onmouseenter: () => { state.trace = b.id; renderBoard(); },
    onmouseleave: () => { state.trace = null; renderBoard(); },
    onclick: (e) => {
      e.stopPropagation();
      state.pinned = state.pinned === b.id ? null : b.id;
      renderBoard();
      renderList();
    },
  },
  h('span', { class: 'desc' }, b.desc),
  chips(b.steps, doneCount),
  (showGroup || modeTags(b).length) ? h('span', { class: 'meta' },
    showGroup ? h('span', null, b.group) : null,
    modeTags(b).map((m) => h('span', { class: 'tag' }, m))) : null,
  b.note ? h('span', { class: 'note' }, b.note) : null);
}

function renderList() {
  const list = $('list');
  const binds = filteredBindings();
  if (!currentApp()) { list.replaceChildren(); return; }
  if (!binds.length) {
    list.replaceChildren(h('div', { class: 'none' }, state.query ? 'No binds match your search.' : 'No binds in this app yet.'));
    return;
  }
  const groups = new Map();
  for (const b of binds) {
    if (!groups.has(b.group)) groups.set(b.group, []);
    groups.get(b.group).push(b);
  }
  list.replaceChildren(...[...groups].map(([name, items]) =>
    h('section', null, h('h3', { class: 'group-title' }, name), items.map((b) => bindRow(b)))));
}

function renderPop() {
  const pop = $('pop');
  if (!state.pop || !currentApp()) { pop.hidden = true; return; }
  const ctx = state.pop;
  const held = new Set(ctx.mods);
  const binds = filteredBindings();
  const { keys } = analyze(binds, ctx.prefix, held);
  const entry = keys.get(ctx.key) || { finals: [], conts: [] };
  const thisStep = { mods: MOD_ORDER.filter((m) => held.has(m)), key: ctx.key };
  const shown = new Set([...entry.finals, ...entry.conts].map((b) => b.id));
  const others = binds.filter((b) => !shown.has(b.id) && b.steps.some((s) => s.key === ctx.key ||
    (modOfKey(ctx.key) && s.mods.includes(modOfKey(ctx.key)))));

  const sections = [];
  if (entry.finals.length) {
    sections.push(h('div', { class: 'pop-section' },
      h('h4', null, 'Does'),
      entry.finals.map((b) => bindRow(b, { showGroup: true }))));
  }
  if (entry.conts.length) {
    sections.push(h('div', { class: 'pop-section' },
      h('h4', null, 'Starts a sequence'),
      entry.conts.map((b) => bindRow(b, { doneCount: ctx.prefix.length + 1, showGroup: true })),
      h('button', {
        class: 'follow',
        onclick: (e) => { e.stopPropagation(); followSequence(ctx); },
      }, `Press it and show the next keys ▸`)));
  }
  if (!entry.finals.length && !entry.conts.length) {
    sections.push(h('div', { class: 'pop-section' }, h('p', { class: 'nothing' }, 'Nothing is bound to this exact combo.')));
  }
  if (others.length) {
    sections.push(h('div', { class: 'pop-section' },
      h('h4', null, 'Other binds using this key'),
      others.slice(0, 15).map((b) => bindRow(b)),
      others.length > 15 ? h('p', { class: 'nothing' }, `…and ${others.length - 15} more`) : null));
  }

  const combo = [...ctx.prefix, thisStep];
  pop.replaceChildren(
    h('div', { class: 'pop-head' },
      chips(combo),
      h('button', { class: 'close', title: 'Close (Esc, or press the key again)', onclick: (e) => { e.stopPropagation(); closePop(); } }, '×')),
    h('div', { class: 'pop-body' }, sections));
  pop.hidden = false;
  placePop();
}

// The popover floats above everything (position: fixed), so opening it never changes
// the page's size or scrollbars. It goes below the key, or above if there's more room.
function placePop() {
  const pop = $('pop');
  if (!state.pop || pop.hidden) return;
  const keyEl = document.querySelector(`.key[data-key="${CSS.escape(state.pop.key)}"]`);
  if (!keyEl) { pop.hidden = true; return; }
  const k = keyEl.getBoundingClientRect();
  const margin = 12;
  pop.style.maxHeight = '';
  const pw = pop.offsetWidth;
  const natural = pop.offsetHeight;

  const spaceBelow = window.innerHeight - k.bottom - margin * 2;
  const spaceAbove = k.top - margin * 2;
  const below = natural <= spaceBelow || spaceBelow >= spaceAbove;
  const room = Math.max(120, below ? spaceBelow : spaceAbove);
  const height = Math.min(natural, room);
  pop.style.maxHeight = room + 'px';

  const left = Math.max(margin, Math.min(k.left + k.width / 2 - pw / 2, window.innerWidth - pw - margin));
  pop.classList.toggle('below', below);
  pop.classList.toggle('above', !below);
  pop.style.left = left + 'px';
  pop.style.top = (below ? k.bottom + margin : k.top - margin - height) + 'px';
  pop.style.setProperty('--tail-x', Math.max(20, Math.min(pw - 20, k.left + k.width / 2 - left)) + 'px');
}

// ---------- interactions ----------

// Last mode picked for this app, else "normal" if the app has modes like vim.
function defaultMode() {
  const app = currentApp();
  if (!app) return null;
  const modes = new Set(app.bindings.flatMap((b) => b.modes));
  const saved = store.get('mode:' + app.id);
  if (saved !== null) return saved && modes.has(saved) ? saved : null;
  return modes.has('normal') ? 'normal' : null;
}

function selectApp(id) {
  if (!data.apps.some((a) => a.id === id)) return;
  state.appId = id;
  store.set('app', id);
  state.mode = defaultMode();
  reset();
}

function selectLayout(id) {
  if (!data.layouts.some((l) => l.id === id)) return;
  state.layoutId = id;
  store.set('layout', id);
  closePop();
  render();
}

function reset() {
  state.held.clear();
  state.physHeld.clear();
  state.prefix = [];
  state.pop = null;
  state.pinned = null;
  render();
}

function closePop() {
  state.pop = null;
  renderPop();
  renderBoard();
}

function followSequence(ctx) {
  state.prefix = [...ctx.prefix, { mods: [...ctx.mods], key: ctx.key }];
  state.held.clear();
  state.physHeld.clear();
  state.pop = null;
  render();
}

function pressKey(id) {
  const mod = modOfKey(id);
  if (mod) {
    if (state.held.has(mod)) state.held.delete(mod); else state.held.add(mod);
    state.physHeld.delete(mod);
    state.pop = null;
    render();
    return;
  }
  const ctx = { key: id, mods: MOD_ORDER.filter((m) => state.held.has(m)), prefix: [...state.prefix] };
  const open = state.pop;
  if (open && open.key === id && open.mods.join() === ctx.mods.join() && open.prefix.length === ctx.prefix.length) {
    closePop(); // pressing the same key again closes it
    return;
  }
  const { keys } = analyze(filteredBindings(), state.prefix, state.held);
  const entry = keys.get(id);
  if (entry && !entry.finals.length && entry.conts.length) {
    // Only leads somewhere: step into the sequence directly.
    followSequence(ctx);
    return;
  }
  state.pop = ctx;
  render();
}

function flash(id) {
  const el = document.querySelector(`.key[data-key="${CSS.escape(id)}"]`);
  if (!el) return;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 120);
}

function onKeyDown(e) {
  if (e.target === $('search')) {
    if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); }
    return;
  }
  if (e.target instanceof HTMLSelectElement) return;
  const id = codeToKey(e.code);
  if (!id || !currentApp()) return;
  e.preventDefault();
  if (e.repeat) return;
  const mod = modOfKey(id);
  if (mod) {
    if (!state.held.has(mod)) {
      state.held.add(mod);
      state.physHeld.add(mod);
      render();
    }
    flash(id);
    return;
  }
  if (id === 'Esc' && (state.pop || state.prefix.length || state.held.size || state.pinned)) {
    reset();
    return;
  }
  pressKey(id);
  flash(id);
}

function onKeyUp(e) {
  const id = codeToKey(e.code);
  const mod = id && modOfKey(id);
  if (mod && state.physHeld.has(mod)) {
    state.physHeld.delete(mod);
    state.held.delete(mod);
    renderStatus();
    renderBoard();
  }
}

function releasePhysical() {
  if (!state.physHeld.size) return;
  for (const m of state.physHeld) state.held.delete(m);
  state.physHeld.clear();
  render();
}

// Keep the current selection valid after a reload of the config files.
function applyData(next) {
  const initial = data && data.initial;
  data = next;
  if (initial && !data.initial) data.initial = initial;
  if (!data.apps.some((a) => a.id === state.appId)) {
    state.appId = data.apps[0] ? data.apps[0].id : null;
    state.prefix = [];
    state.pop = null;
  }
  if (!data.layouts.some((l) => l.id === state.layoutId)) state.layoutId = data.layouts[0].id;
  render();
}

async function init() {
  const first = await api.load();
  const pick = (list, ...ids) => ids.find((id) => id && list.some((x) => x.id === id));
  state.appId = pick(first.apps, first.initial.app, first.settings.app, store.get('app')) || (first.apps[0] && first.apps[0].id) || null;
  state.layoutId = pick(first.layouts, first.initial.layout, store.get('layout'), first.settings.layout) || first.layouts[0].id;
  applyData(first);
  state.mode = defaultMode();
  render();

  api.onData(applyData);
  api.onSelect((sel) => {
    if (sel.layout) selectLayout(sel.layout);
    if (sel.app) selectApp(sel.app);
  });

  $('layout').addEventListener('change', (e) => selectLayout(e.target.value));
  $('open-config').addEventListener('click', () => api.openConfig());
  $('search').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.pop = null;
    render();
  });
  $('board-area').addEventListener('click', () => { if (state.pop) closePop(); });
  $('pop').addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releasePhysical);
  // Only re-render when the size actually changed, so a layout pass doesn't loop.
  let lastSize = '';
  new ResizeObserver(() => {
    const size = `${$('board-area').clientWidth}x${$('board-area').clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    renderBoard();
    placePop();
  }).observe($('board-area'));
  $('board-area').addEventListener('scroll', placePop);
}

init();
