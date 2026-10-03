const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mediaStatus', {
  state: () => ipcRenderer.invoke('status:state'),
  pin: value => ipcRenderer.invoke('status:pin', value),
  open: (kind, id) => ipcRenderer.invoke('status:open', kind, id),
  hide: () => ipcRenderer.invoke('status:hide'),
  view: kind => ipcRenderer.invoke('status:view', kind)
});
