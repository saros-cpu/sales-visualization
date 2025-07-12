const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  checkForUpdates: () => ipcRenderer.send('check-for-update'),
  downloadUpdate: () => ipcRenderer.send('download-update'),
  restartApp: () => ipcRenderer.send('restart-app'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  downloadFile: (url, filename, token) => ipcRenderer.invoke('download-file', { url, filename, token }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
