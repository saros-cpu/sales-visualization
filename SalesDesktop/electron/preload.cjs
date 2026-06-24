const { contextBridge, ipcRenderer } = require('electron');

const DEFAULT_RUNTIME_CONFIG = {
  apiHost: 'https://sales.example.com',
  updateUrl: 'https://sales.example.com/download',
  allowedHosts: ['198.51.100.10', 'sales.example.com'],
};

let runtimeConfig = DEFAULT_RUNTIME_CONFIG;
try {
  const { loadRuntimeConfig } = require('./runtime-config.cjs');
  runtimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...loadRuntimeConfig() };
} catch {}

contextBridge.exposeInMainWorld('__SALES_API_HOST__', runtimeConfig.apiHost);
contextBridge.exposeInMainWorld('SALES_RUNTIME_CONFIG', runtimeConfig);

contextBridge.exposeInMainWorld('updater', {
  onStatusChange: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  getStatus: () => ipcRenderer.invoke('get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  resolveInstallPrompt: (action) => ipcRenderer.invoke('resolve-update-install-prompt', action),
  onInstallPrompt: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update-install-requested', handler);
    return () => ipcRenderer.removeListener('update-install-requested', handler);
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  downloadFile: (url, filename, token) => ipcRenderer.invoke('download-file', { url, filename, token }),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  resolveAppClose: (action) => ipcRenderer.invoke('resolve-app-close', action),
  onAppCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app-close-requested', handler);
    return () => ipcRenderer.removeListener('app-close-requested', handler);
  },
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  setDevToolsAccess: (enabled) => ipcRenderer.send('set-devtools-access', Boolean(enabled)),
  onDevToolsOpened: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('devtools-opened', handler);
    return () => ipcRenderer.removeListener('devtools-opened', handler);
  },
});
