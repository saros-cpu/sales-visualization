const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { loadRuntimeConfig } = require('./runtime-config.cjs');

let mainWindow = null;
let adminDevToolsEnabled = false;

const runtimeConfig = loadRuntimeConfig(app);
const allowedExternalHosts = new Set(runtimeConfig.allowedHosts);
function urlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

const connectSrc = Array.from(new Set([
  "'self'",
  urlOrigin(runtimeConfig.apiHost),
  urlOrigin(runtimeConfig.updateUrl),
  'http://localhost:8900',
  'http://127.0.0.1:8900',
  'ws://localhost:5173',
])).join(' ');
const allowedExternalPathPrefixes = ['/api/', '/download/'];

function isAllowedExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && allowedExternalHosts.has(parsed.hostname)
      && allowedExternalPathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (input.control && input.shift && key === 'i') {
      event.preventDefault();
      if (adminDevToolsEnabled) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.webContents.send('devtools-opened');
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function setupUpdater() {
  if (!app.isPackaged) {
    console.log('[Updater] skipped in dev mode');
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: runtimeConfig.updateUrl });

  ipcMain.on('check-for-update', () => { autoUpdater.checkForUpdates(); });
  ipcMain.on('download-update', () => { autoUpdater.downloadUpdate(); });
  ipcMain.on('restart-app', () => { autoUpdater.quitAndInstall(); });

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', { status: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', { status: 'available', version: info.version, releaseDate: info.releaseDate });
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-status', { status: 'not-available' });
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update-status', { status: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-status', { status: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-status', { status: 'error', message: err.message });
  });
}

function setupFileDownload() {
  ipcMain.handle('download-file', async (event, { url, filename, token }) => {
    if (!isAllowedExternalUrl(url)) return false;

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: filename,
      filters: [
        { name: 'Documents', extensions: ['xlsx', 'docx', 'html', 'pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) return false;

    try {
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(result.filePath, buffer);
      return true;
    } catch (e) {
      return false;
    }
  });
}

function setupOpenExternal() {
  ipcMain.handle('open-external', async (event, url) => {
    if (typeof url === 'string' && isAllowedExternalUrl(url)) {
      await shell.openExternal(url);
    }
  });
}

function setupWindowControl() {
  const run = (command) => {
    if (!mainWindow) return false;
    if (command === 'minimize') {
      mainWindow.minimize();
      return true;
    }
    if (command === 'maximize') {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return true;
    }
    if (command === 'close') {
      mainWindow.close();
      return true;
    }
    return false;
  };

  ipcMain.handle('window-control', (_event, command) => run(command));
  ipcMain.on('window-minimize', () => run('minimize'));
  ipcMain.on('window-maximize', () => run('maximize'));
  ipcMain.on('window-close', () => run('close'));
}

function setupDevToolsAccess() {
  ipcMain.on('set-devtools-access', (event, enabled) => {
    adminDevToolsEnabled = Boolean(enabled);
    if (!adminDevToolsEnabled && mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    }
  });
}

app.whenReady().then(() => {
  const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: blob:; font-src 'self' data:`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  createWindow();
  setupUpdater();
  setupFileDownload();
  setupOpenExternal();
  setupWindowControl();
  setupDevToolsAccess();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
