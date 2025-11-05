const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  fetchEvents: () => ipcRenderer.invoke('fetch-events'),
  onRefresh: (cb) => ipcRenderer.on('refresh-events', cb),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (ev, cfg) => cb(cfg)),
  listConfig: () => ipcRenderer.invoke('list-config'),
  acceptTerms: () => ipcRenderer.invoke('accept-terms'),
  openMain: () => ipcRenderer.invoke('open-main'),
  openHome: () => ipcRenderer.invoke('open-home'),
  setConfig: (cfg) => ipcRenderer.invoke('set-config', cfg),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  reportHomeSize: (size) => ipcRenderer.invoke('home-resize', size),
  addIcal: (url) => ipcRenderer.invoke('add-ical', url),
  minimizeWindow: (windowName) => ipcRenderer.invoke('minimize-window', windowName),
  toggleMaximizeWindow: (windowName) => ipcRenderer.invoke('toggle-maximize-window', windowName),
  closeWindow: (windowName) => ipcRenderer.invoke('close-window', windowName),
});