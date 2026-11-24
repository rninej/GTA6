const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('palma', {
  isDesktop: true,
  toggleFullscreen: () => ipcRenderer.invoke('palma:fullscreen'),
  quit: () => ipcRenderer.invoke('palma:quit')
});
