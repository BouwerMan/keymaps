// Loads the config directory:
//   <dir>/config.toml        optional settings (layout, app)
//   <dir>/apps/*.toml        one file per app's keybinds
//   <dir>/layouts/*.toml     optional custom keyboard layouts
//
// An app can pull binds from the real program with a [source] table (see sources/).
// Binds written in the .toml are merged on top: same keys = annotate, new keys = add.

const fs = require('fs');
const os = require('os');
const path = require('path');
const TOML = require('smol-toml');
const { parseKeys, KEY_LABELS, SHIFT_LEGENDS, MOD_KEYS } = require('./keys');
const { buildLayout, builtinLayouts } = require('./layouts');
const { importNeovim, MODE_NAMES } = require('./sources/neovim');
const { importHyprland } = require('./sources/hyprland');
const { importTmux } = require('./sources/tmux');

const EXAMPLES_DIR = path.join(__dirname, '..', '..', 'examples');

const SOURCES = { neovim: importNeovim, hyprland: importHyprland, tmux: importTmux };

function defaultConfigDir() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'keymaps');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

// First run: seed the config dir with the bundled examples.
function ensureConfigDir(dir) {
  if (!fs.existsSync(path.join(dir, 'apps'))) copyDir(EXAMPLES_DIR, dir);
}

function tomlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.toml'))
    .sort()
    .map((f) => path.join(dir, f));
}

function readToml(file) {
  return TOML.parse(fs.readFileSync(file, 'utf8'));
}

function asList(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

const normalizeMode = (m) => MODE_NAMES[m] || m;
const stepsId = (steps) => JSON.stringify(steps.map((s) => [s.mods.join('+'), s.key, s.raw || '']));
const modesOverlap = (a, b) => !a.length || !b.length || a.some((m) => b.includes(m));

// Binds written by hand in the app's .toml.
function configBindings(doc, aliases, warnings) {
  const out = [];

  const add = (entry, group, where) => {
    const keysList = asList(entry.keys);
    if (!keysList.length || typeof entry.desc !== 'string') {
      warnings.push(`${where}: needs \`keys\` and \`desc\``);
      return;
    }
    for (const keys of keysList) {
      try {
        out.push({
          keys,
          desc: entry.desc,
          group: entry.group || group || null,
          modes: asList(entry.mode).map(normalizeMode),
          note: entry.note ? String(entry.note) : '',
          steps: parseKeys(keys, aliases),
        });
      } catch (e) {
        warnings.push(`${where}: ${e.message}`);
      }
    }
  };

  // Compact form:  [groups.Windows]  "Super+Q" = "Close window"
  // or with extras: "Super+Q" = { desc = "Close window", mode = "n" }
  for (const [group, entries] of Object.entries(doc.groups || {})) {
    for (const [keys, val] of Object.entries(entries || {})) {
      const entry = typeof val === 'string' ? { desc: val } : { ...val };
      entry.keys = keys;
      add(entry, group, `groups.${group}."${keys}"`);
    }
  }
  // Long form:  [[bind]]  keys = "..."  desc = "..."  group = "..."  mode = "n"
  (doc.bind || []).forEach((entry, i) => add(entry || {}, null, `bind #${i + 1}`));
  return out;
}

async function loadApp(file) {
  const doc = readToml(file);
  const id = path.basename(file, '.toml');
  const warnings = [];
  const notices = [];
  const watch = { dirs: [], files: [] };
  let bindings = [];
  let undescribed = [];
  let sourceAliases = {};

  if (doc.source) {
    const type = String(doc.source.type || '');
    const importer = SOURCES[type];
    if (!importer) {
      warnings.push(`unknown source type "${type}" (known: ${Object.keys(SOURCES).join(', ')})`);
    } else {
      try {
        const res = await importer(doc.source);
        bindings = res.bindings.map((b) => ({ ...b, origin: type }));
        notices.push(...(res.notices || []));
        undescribed = res.undescribed || [];
        sourceAliases = res.aliases || {};
        watch.dirs.push(...(res.watchDirs || []));
        watch.files.push(...(res.watchFiles || []));
      } catch (e) {
        warnings.push(`couldn't import from ${type}: ${e.message}`);
      }
    }
  }

  // Hand-written binds annotate imported ones with the same keys, or add new ones.
  const index = new Map();
  bindings.forEach((b) => {
    const k = stepsId(b.steps);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(b);
  });
  const aliases = { ...sourceAliases, ...(doc.aliases || {}) };
  for (const own of configBindings(doc, aliases, warnings)) {
    const match = (index.get(stepsId(own.steps)) || []).find((b) => modesOverlap(b.modes, own.modes));
    if (match) {
      match.desc = own.desc;
      if (own.group) match.group = own.group;
      if (own.note) match.note = own.note;
      if (own.modes.length) match.modes = own.modes;
      match.origin += '+config';
    } else {
      bindings.push({ ...own, origin: 'config' });
    }
  }

  const described = new Set(bindings.map((b) => stepsId(b.steps)));
  const hidden = undescribed.filter((u) => !described.has(stepsId(u.steps)));
  if (hidden.length) {
    const list = hidden.slice(0, 10).map((u) => u.keys).join('  ');
    notices.push(`${hidden.length} maps have no description, so they're hidden: ${list}${hidden.length > 10 ? ' …' : ''}. Describe them in ${path.basename(file)} to show them.`);
  }

  bindings.forEach((b, i) => {
    b.id = `${id}:${i}`;
    if (!b.group) b.group = 'General';
  });

  return {
    id,
    name: typeof doc.name === 'string' ? doc.name : id,
    color: typeof doc.color === 'string' ? doc.color : null,
    description: typeof doc.description === 'string' ? doc.description : '',
    order: Number.isFinite(doc.order) ? doc.order : 100,
    file,
    bindings,
    warnings,
    notices,
    watch,
  };
}

async function load(dir) {
  const errors = [];
  const note = (file, e) => errors.push({ file, message: e.message || String(e) });

  let settings = {};
  const settingsFile = path.join(dir, 'config.toml');
  if (fs.existsSync(settingsFile)) {
    try { settings = readToml(settingsFile); } catch (e) { note(settingsFile, e); }
  }

  const apps = [];
  const watch = { dirs: [], files: [] };
  const loaded = await Promise.all(tomlFiles(path.join(dir, 'apps')).map(async (file) => {
    try { return await loadApp(file); } catch (e) { note(file, e); return null; }
  }));
  for (const app of loaded) {
    if (!app) continue;
    for (const w of app.warnings) note(app.file, { message: w });
    watch.dirs.push(...app.watch.dirs);
    watch.files.push(...app.watch.files);
    apps.push(app);
  }
  apps.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  const layouts = builtinLayouts();
  for (const file of tomlFiles(path.join(dir, 'layouts'))) {
    try {
      const layout = buildLayout(path.basename(file, '.toml'), readToml(file));
      const existing = layouts.findIndex((l) => l.id === layout.id);
      if (existing >= 0) layouts[existing] = layout; else layouts.push(layout);
    } catch (e) {
      note(file, e);
    }
  }

  return {
    configDir: dir,
    settings: {
      layout: typeof settings.layout === 'string' ? settings.layout : 'keychron-q1-max',
      app: typeof settings.app === 'string' ? settings.app : null,
    },
    apps,
    layouts,
    errors,
    watch,
    keyLabels: KEY_LABELS,
    shiftLegends: SHIFT_LEGENDS,
    modKeys: MOD_KEYS,
  };
}

module.exports = { defaultConfigDir, ensureConfigDir, load, loadApp };
