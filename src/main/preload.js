const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keymaps', {
  load: () => ipcRenderer.invoke('keymaps:load'),
  openConfig: () => ipcRenderer.invoke('keymaps:open-config'),
  openFile: (file) => ipcRenderer.invoke('keymaps:open-file', file),
  onData: (cb) => ipcRenderer.on('keymaps:data', (_e, data) => cb(data)),
  onSelect: (cb) => ipcRenderer.on('keymaps:select', (_e, sel) => cb(sel)),
});
