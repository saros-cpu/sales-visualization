const { contextBridge, ipcRenderer } = require('electron');
const { loadRuntimeConfig } = require('./runtime-config.cjs');

const runtimeConfig = loadRuntimeConfig();

contextBridge.exposeInMainWorld('__SALES_API_HOST__', runtimeConfig.apiHost);
contextBridge.exposeInMainWorld('SALES_RUNTIME_CONFIG', runtimeConfig);

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
  platform: process.platform,
  downloadFile: (url, filename, token) => ipcRenderer.invoke('download-file', { url, filename, token }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
  maximize: () => ipcRenderer.invoke('window-control', 'maximize'),
  close: () => ipcRenderer.invoke('window-control', 'close'),
  setDevToolsAccess: (enabled) => ipcRenderer.send('set-devtools-access', Boolean(enabled)),
  onDevToolsOpened: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('devtools-opened', handler);
    return () => ipcRenderer.removeListener('devtools-opened', handler);
  },
});
