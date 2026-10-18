const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chaosVideo', {
  open: (id) =>
    typeof id === 'string'
      ? ipcRenderer.invoke('chaos:open-video', id)
      : Promise.resolve({ ok: false }),
});
contextBridge.exposeInMainWorld('chaosApp', {
  quit: () => ipcRenderer.invoke('chaos:quit'),
});
contextBridge.exposeInMainWorld('chaosWindow', {
  getFullscreen: () => ipcRenderer.invoke('chaos:get-fullscreen'),
  setFullscreen: (value) => ipcRenderer.invoke('chaos:set-fullscreen', Boolean(value)),
  onFullscreenChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('chaos:fullscreen-changed', listener);
    return () => ipcRenderer.removeListener('chaos:fullscreen-changed', listener);
  },
});
