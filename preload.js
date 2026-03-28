const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
});
