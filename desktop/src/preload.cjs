const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  getPreferences: () => ipcRenderer.invoke('desktop:preferences:get'),
  updatePreferences: (patch) => ipcRenderer.invoke('desktop:preferences:update', patch),
  getRuntimeState: () => ipcRenderer.invoke('desktop:runtime:get'),
  createDesktopShortcut: () => ipcRenderer.invoke('desktop:shortcut:create'),
  requestApi: (request) => ipcRenderer.invoke('desktop:api:request', request),
});

contextBridge.exposeInMainWorld('dgxDesktop', desktopApi);
