const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme } = require('electron');
const config = require('./config');

// CLI flags:
//   --app <id>         open on this app (file name without .toml)
//   --layout <id>      use this keyboard layout
//   --config-dir <dir> read config from somewhere other than ~/.config/keymaps
//   --toggle           if already open and focused, hide it (handy for a WM keybind)
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === '--app') out.app = take();
    else if (a.startsWith('--app=')) out.app = a.slice(6);
    else if (a === '--layout') out.layout = take();
    else if (a.startsWith('--layout=')) out.layout = a.slice(9);
    else if (a === '--config-dir') out.configDir = take();
    else if (a.startsWith('--config-dir=')) out.configDir = a.slice(13);
    else if (a === '--toggle') out.toggle = true;
  }
  return out;
}

const args = parseArgs(process.argv);
const configDir = path.resolve(args.configDir || config.defaultConfigDir());

// Electron would otherwise keep its cache in ~/.config/keymaps, mixed in with the config.
const cacheBase = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
// Screenshot runs (dev aid, see below) stay separate from a copy you have open.
const devShot = Boolean(process.env.KEYMAPS_SCREENSHOT);
app.setPath('userData', path.join(cacheBase, devShot ? 'keymaps-dev' : 'keymaps'));

let win = null;
let latest = null;

if (!devShot && !app.requestSingleInstanceLock(args)) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, _cwd, extra) => {
    if (!win) return;
    const next = extra && typeof extra === 'object' ? extra : parseArgs(argv);
    if (next.toggle && win.isVisible() && win.isFocused() && !next.app) {
      win.hide();
      return;
    }
    if (next.app || next.layout) win.webContents.send('keymaps:select', next);
    win.show();
    win.focus();
  });
  app.whenReady().then(start);
}

// ---------- loading + watching ----------

let loading = null;
let again = false;
let reloadTimer = null;
const dirWatchers = new Map();
const fileWatchers = new Set();

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reload, 200);
}

function syncWatchers(watch) {
  // Watch the real folder: ~/.config/keymaps may be a symlink (e.g. stowed dotfiles).
  let realConfigDir = configDir;
  try { realConfigDir = fs.realpathSync(configDir); } catch { /* not created yet */ }
  const dirs = new Set([realConfigDir, ...watch.dirs]);
  for (const [d, w] of dirWatchers) if (!dirs.has(d)) { w.close(); dirWatchers.delete(d); }
  for (const d of dirs) {
    if (dirWatchers.has(d)) continue;
    try { dirWatchers.set(d, fs.watch(d, { recursive: true }, scheduleReload)); } catch { /* missing */ }
  }
  // Files are polled, so ones that don't exist yet (e.g. hyprland.conf) get picked up.
  const files = new Set(watch.files);
  for (const f of fileWatchers) if (!files.has(f)) { fs.unwatchFile(f); fileWatchers.delete(f); }
  for (const f of files) {
    if (fileWatchers.has(f)) continue;
    fs.watchFile(f, { interval: 1500 }, scheduleReload);
    fileWatchers.add(f);
  }
}

async function reload() {
  if (loading) { again = true; return loading; }
  loading = (async () => {
    try {
      latest = await config.load(configDir);
      syncWatchers(latest.watch);
      if (win && !win.isDestroyed()) win.webContents.send('keymaps:data', latest);
    } finally {
      loading = null;
      if (again) { again = false; reload(); }
    }
  })();
  return loading;
}

// ---------- window ----------

function start() {
  config.ensureConfigDir(configDir);
  Menu.setApplicationMenu(null);
  const firstLoad = reload();

  ipcMain.handle('keymaps:load', async () => {
    if (!latest) await firstLoad;
    return { ...latest, initial: { app: args.app, layout: args.layout } };
  });
  ipcMain.handle('keymaps:open-config', () => shell.openPath(configDir));
  ipcMain.handle('keymaps:open-file', (_e, file) => {
    // Only open files inside the config dir.
    const resolved = path.resolve(String(file));
    if (resolved.startsWith(configDir + path.sep)) return shell.openPath(resolved);
    return 'refused';
  });

  win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    title: 'Keymaps',
    icon: path.join(__dirname, '..', '..', 'assets', 'keymaps.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f4f3ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });

  // Dev aid: KEYMAPS_SCREENSHOT=out.png [KEYMAPS_EVAL="js"] captures the window and exits.
  if (process.env.KEYMAPS_SCREENSHOT) {
    win.webContents.once('did-finish-load', async () => {
      await firstLoad;
      await new Promise((r) => setTimeout(r, 600));
      if (process.env.KEYMAPS_EVAL) await win.webContents.executeJavaScript(process.env.KEYMAPS_EVAL);
      await new Promise((r) => setTimeout(r, 400));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.KEYMAPS_SCREENSHOT, img.toPNG());
      app.quit();
    });
  }
}

app.on('window-all-closed', () => app.quit());
