import { contextBridge, ipcRenderer } from 'electron';

const desktopApi = Object.freeze({
  getPreferences: () => ipcRenderer.invoke('desktop:preferences:get'),
  updatePreferences: (patch) => ipcRenderer.invoke('desktop:preferences:update', patch),
  getRuntimeState: () => ipcRenderer.invoke('desktop:runtime:get'),
  requestApi: (request) => ipcRenderer.invoke('desktop:api:request', request),
});

contextBridge.exposeInMainWorld('dgxDesktop', desktopApi);
