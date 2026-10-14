const { app, BrowserWindow, ipcMain, dialog, shell, session, Tray, Menu, net, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');
const { loadRuntimeConfig } = require('./runtime-config.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let adminDevToolsEnabled = false;
let updateStatus = { status: 'idle', autoCheck: true };
let updatePromptVisible = false;
let closePromptVisible = false;
let closePromptRequestId = 0;
let updateProgressLastLoggedPercent = -1;
let updateCheckInFlight = false;

const runtimeConfig = loadRuntimeConfig(app);
const appIcon = path.join(__dirname, '..', 'build', 'icon.ico');
const appProtocolHost = 'salesdesktop';
const allowedExternalHosts = new Set(runtimeConfig.allowedHosts);
const fallbackUpdateUrls = ['http://198.51.100.10/download'];
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let singleInstanceServer = null;
if (process.platform === 'win32') {
  app.setAppUserModelId('com.sales.desktop');
}
function urlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function connectOriginsForAllowedHosts() {
  const origins = [];
  for (const host of allowedExternalHosts) {
    const normalizedHost = String(host || '').trim();
    if (!normalizedHost) continue;
    if (normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') {
      origins.push(`http://${normalizedHost}:8900`);
      origins.push(`http://${normalizedHost}:5173`);
      origins.push(`ws://${normalizedHost}:5173`);
      continue;
    }
    origins.push(`http://${normalizedHost}`);
    origins.push(`https://${normalizedHost}`);
  }
  return origins;
}

function isAllowedUpdateUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && allowedExternalHosts.has(parsed.hostname)
      && parsed.pathname.startsWith('/download');
  } catch {
    return false;
  }
}

function updateFeedUrlCandidates() {
  return Array.from(new Set([
    normalizeUrl(runtimeConfig.updateUrl),
    ...fallbackUpdateUrls.map(normalizeUrl),
  ])).filter((url) => url && isAllowedUpdateUrl(url));
}

function isUpdateNetworkFailure(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return [
    'network',
    'enotfound',
    'eai_again',
    'econnreset',
    'econnrefused',
    'etimedout',
    'timeout',
    'net::err',
    'dns',
    'getaddrinfo',
  ].some((text) => message.includes(text));
}

const connectSrc = Array.from(new Set([
  "'self'",
  urlOrigin(runtimeConfig.apiHost),
  urlOrigin(runtimeConfig.updateUrl),
  ...connectOriginsForAllowedHosts(),
  'http://localhost:8900',
  'http://127.0.0.1:8900',
  'http://10.8.0.1',
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

function registerAppProtocol() {
  const distRoot = path.resolve(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== appProtocolHost) {
        return new Response('not found', { status: 404 });
      }

      const rawPath = decodeURIComponent(url.pathname || '/');
      const requestedPath = rawPath === '/' ? '/index.html' : rawPath;
      const filePath = path.resolve(distRoot, `.${requestedPath}`);
      const relativePath = path.relative(distRoot, filePath);
      const isSafePath = relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
      if (!isSafePath) {
        return new Response('bad request', { status: 400 });
      }

      if (!fs.existsSync(filePath)) {
        const hasExtension = Boolean(path.extname(filePath));
        if (hasExtension) return new Response('not found', { status: 404 });
        return net.fetch(pathToFileURL(path.join(distRoot, 'index.html')).toString());
      }

      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });
}

async function clearRendererAuth() {
  const logoutUrl = JSON.stringify(`${runtimeConfig.apiHost.replace(/\/+$/, '')}/api/v2/auth/logout`);
  const clearScript = `
    (() => {
      try {
        const token = localStorage.getItem('accessToken');
        const refreshToken = localStorage.getItem('refreshToken') || '';
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        sessionStorage.clear();
        if (token) {
          fetch(${logoutUrl}, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(refreshToken ? { refreshToken } : {}),
            keepalive: true,
          }).catch(() => {});
        }
      } catch (_) {}
      return true;
    })();
  `;

  await Promise.all(BrowserWindow.getAllWindows().map(async (win) => {
    if (!win || win.isDestroyed()) return;
    try {
      await Promise.race([
        win.webContents.executeJavaScript(clearScript, true),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]);
    } catch {}
  }));
}

function showMainWindow() {
  if (isQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function quitAppAfterLogout() {
  if (isQuitting) return;
  isQuitting = true;
  await clearRendererAuth();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
}

async function quitAndInstallAfterLogout() {
  if (isQuitting) return;
  isQuitting = true;
  await clearRendererAuth();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  autoUpdater.quitAndInstall();
}

function setupTray() {
  if (tray || !fs.existsSync(appIcon)) return;
  tray = new Tray(appIcon);
  tray.setToolTip('销售管理系统');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开', click: showMainWindow },
    { type: 'separator' },
    { label: '关闭', click: () => { quitAppAfterLogout(); } },
  ]));
  tray.on('double-click', showMainWindow);
}

function minimizeMainWindowToTray() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
  }
}

function requestCloseDecisionFromRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const requestId = ++closePromptRequestId;
  closePromptVisible = true;
  mainWindow.webContents.send('app-close-requested');
  mainWindow.webContents.executeJavaScript(
    "window.dispatchEvent(new CustomEvent('sales-app-close-requested')); true;",
    true,
  ).catch(() => {});
  setTimeout(() => {
    if (requestId === closePromptRequestId) closePromptVisible = false;
  }, 8000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: true,
    autoHideMenuBar: true,
    title: '销售管理系统',
    icon: fs.existsSync(appIcon) ? appIcon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (fs.existsSync(appIcon)) mainWindow.setIcon(appIcon);
  setupTray();

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadURL(`app://${appProtocolHost}/index.html`);
  }

  // SEC-1: Restrict navigation to app:// and localhost (dev) only
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedProtocols = isDev
      ? ['http://localhost', 'http://127.0.0.1']
      : [`app://${appProtocolHost}`];
    const allowed = allowedProtocols.some((prefix) => url.startsWith(prefix));
    if (!allowed) {
      console.warn('[security] blocked navigation:', url);
      event.preventDefault();
    }
  });

  // SEC-1: Deny all new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (key === 'f11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return;
    }
    if (input.control && input.shift && key === 'i') {
      event.preventDefault();
      if (adminDevToolsEnabled) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
        mainWindow.webContents.send('devtools-opened');
      }
    }
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    requestCloseDecisionFromRenderer();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function emitUpdateStatus(nextStatus) {
  updateStatus = { ...updateStatus, ...nextStatus };
  mainWindow?.webContents.send('update-status', updateStatus);
  return updateStatus;
}

function isUpdateBusy() {
  return ['checking', 'available', 'downloading', 'downloaded'].includes(updateStatus.status) || updateCheckInFlight;
}

function isDuplicateUpdateError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  return [
    'already',
    'in progress',
    'checkforupdates',
    'check for updates',
    'downloadupdate',
    'download update',
  ].some((text) => message.includes(text));
}

function formatLogArg(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendUpdateLog(level, ...args) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatLogArg).join(' ')}\n`;
    fs.appendFile(path.join(logDir, 'updater.log'), line, () => {});
  } catch {}
}

function requestInstallUpdateFromRenderer(info) {
  if (!mainWindow || updatePromptVisible) return;
  updatePromptVisible = true;
  const payload = { version: info?.version || '' };
  appendUpdateLog('info', 'request renderer install prompt', payload);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('update-install-requested', payload);
}

async function resolveUpdateInstallPrompt(action) {
  if (action === 'restart') {
    appendUpdateLog('info', 'restart to install requested');
    updatePromptVisible = false;
    await quitAndInstallAfterLogout();
    return true;
  }
  appendUpdateLog('info', 'install prompt deferred');
  updatePromptVisible = false;
  return true;
}

function setupUpdater() {
  const unsupportedMessage = '更新仅支持打包安装后的客户端';
  const feedUrls = updateFeedUrlCandidates();
  const setUpdateFeedUrl = (feedUrl) => {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    appendUpdateLog('info', 'set update feed url', feedUrl);
  };
  const checkForUpdatesWithFeedFallback = async () => {
    let lastError = null;
    const candidates = feedUrls.length ? feedUrls : [runtimeConfig.updateUrl];
    for (let index = 0; index < candidates.length; index += 1) {
      const feedUrl = candidates[index];
      setUpdateFeedUrl(feedUrl);
      try {
        return await autoUpdater.checkForUpdates();
      } catch (err) {
        lastError = err;
        if (
          isDuplicateUpdateError(err)
          || !isUpdateNetworkFailure(err)
          || index === candidates.length - 1
        ) {
          throw err;
        }
        appendUpdateLog('warn', 'update feed failed, retry next feed', {
          feedUrl,
          message: err?.message || String(err),
          nextFeedUrl: candidates[index + 1],
        });
      }
    }
    throw lastError;
  };

  const checkForUpdates = async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    if (isUpdateBusy()) {
      appendUpdateLog('info', 'skip duplicate update check', updateStatus);
      return updateStatus;
    }
    try {
      updateCheckInFlight = true;
      emitUpdateStatus({ status: 'checking', message: undefined });
      await checkForUpdatesWithFeedFallback();
      return updateStatus;
    } catch (err) {
      if (isDuplicateUpdateError(err)) {
        appendUpdateLog('warn', 'ignore duplicate update check error', err?.message || err);
        return updateStatus;
      }
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    } finally {
      updateCheckInFlight = false;
    }
  };

  ipcMain.handle('get-update-status', () => updateStatus);
  ipcMain.handle('check-for-update', () => checkForUpdates());
  ipcMain.handle('download-update', async () => {
    if (!app.isPackaged) {
      return emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    }
    if (['downloading', 'downloaded', 'available'].includes(updateStatus.status)) {
      appendUpdateLog('info', 'skip duplicate manual download', updateStatus);
      return updateStatus;
    }
    try {
      await autoUpdater.downloadUpdate();
      return updateStatus;
    } catch (err) {
      if (isDuplicateUpdateError(err)) {
        appendUpdateLog('warn', 'ignore duplicate manual download error', err?.message || err);
        return updateStatus;
      }
      return emitUpdateStatus({ status: 'error', message: err?.message || String(err) });
    }
  });
  ipcMain.handle('restart-app', async () => {
    if (!app.isPackaged) return false;
    await quitAndInstallAfterLogout();
    return true;
  });
  ipcMain.handle('resolve-update-install-prompt', async (event, action) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow !== mainWindow) return false;
    return resolveUpdateInstallPrompt(action);
  });

  if (!app.isPackaged) {
    emitUpdateStatus({ status: 'unsupported', message: unsupportedMessage, autoCheck: false });
    console.log('[Updater] skipped in dev mode');
    return;
  }
  autoUpdater.logger = {
    info: (...args) => appendUpdateLog('info', ...args),
    warn: (...args) => appendUpdateLog('warn', ...args),
    error: (...args) => appendUpdateLog('error', ...args),
    debug: (...args) => appendUpdateLog('debug', ...args),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  if (process.platform === 'win32' && 'verifyUpdateCodeSignature' in autoUpdater) {
    autoUpdater.verifyUpdateCodeSignature = async () => null;
  }
  setUpdateFeedUrl(feedUrls[0] || runtimeConfig.updateUrl);

  autoUpdater.on('checking-for-update', () => {
    appendUpdateLog('info', 'checking for update');
    emitUpdateStatus({ status: 'checking', message: undefined });
  });
  autoUpdater.on('update-available', (info) => {
    updateProgressLastLoggedPercent = -1;
    appendUpdateLog('info', 'update available', info);
    emitUpdateStatus({ status: 'available', version: info.version, releaseDate: info.releaseDate, message: undefined });
  });
  autoUpdater.on('update-not-available', () => {
    appendUpdateLog('info', 'update not available');
    emitUpdateStatus({ status: 'not-available', message: undefined });
  });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent || 0);
    if (percent >= updateProgressLastLoggedPercent + 10 || percent === 100) {
      updateProgressLastLoggedPercent = percent;
      appendUpdateLog('info', 'download progress', {
        percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond,
      });
    }
    emitUpdateStatus({
      status: 'downloading',
      percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
      message: undefined,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    appendUpdateLog('info', 'update downloaded', info);
    emitUpdateStatus({ status: 'downloaded', version: info.version, message: undefined });
    requestInstallUpdateFromRenderer(info);
  });
  autoUpdater.on('error', (err) => {
    appendUpdateLog('error', 'update error', err?.stack || err?.message || err);
    if (isDuplicateUpdateError(err)) {
      appendUpdateLog('warn', 'ignore duplicate updater event error', updateStatus);
      return;
    }
    emitUpdateStatus({ status: 'error', message: err.message });
  });

  setTimeout(() => {
    checkForUpdates();
  }, 8000);
}

function setupFileDownload() {
  ipcMain.handle('download-file', async (event, { url, filename, token }) => {
    if (!isAllowedExternalUrl(url)) {
      return {
        ok: false,
        error: 'download_host_not_allowed',
        message: '下载链接未通过桌面安全白名单',
      };
    }

    // 主域名(sales.example.com)在部分客户端网络不可达时，回退到 198.51.100.10(http)。
    const candidateUrls = (() => {
      const list = [url];
      try {
        if (/^https?:\/\//i.test(url)) {
          const swapped = url
            .replace(/^https:\/\//i, 'http://')
            .replace(/sales\.example\.kg/i, '198.51.100.10');
          if (swapped !== url) list.push(swapped);
        }
      } catch {}
      return list;
    })();

    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath('downloads'), filename),
      filters: [
        { name: 'Documents', extensions: ['xlsx', 'docx', 'html', 'pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return {
        ok: false,
        error: 'download_cancelled',
        message: '已取消保存文件',
        canceled: true,
      };
    }

    let lastErr = {
      ok: false,
      error: 'download_failed',
      message: '下载文件时发生未知错误',
    };
    for (const target of candidateUrls) {
      try {
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(target, { headers });
        if (!response.ok) {
          let body = '';
          try {
            body = (await response.text()).slice(0, 4000);
          } catch {
            body = '';
          }
          lastErr = {
            ok: false,
            error: `http_${response.status}`,
            status: response.status,
            statusText: response.statusText,
            message: `下载接口返回错误：${response.status} ${response.statusText}`,
            bodyPreview: body,
          };
          // HTTP 错误也尝试回退主机（回退主机大概率同错），最终返回该错误
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(result.filePath, buffer);
        return {
          ok: true,
          filePath: result.filePath,
        };
      } catch (e) {
        lastErr = {
          ok: false,
          error: 'download_failed',
          message: e?.message || '下载文件时发生未知错误',
        };
        // 网络/连接错误 → 换回退主机重试
        continue;
      }
    }
    return lastErr;
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
  const getTargetWindow = (event) => BrowserWindow.fromWebContents(event?.sender) || mainWindow;
  const run = (command, event) => {
    const targetWindow = getTargetWindow(event);
    if (!targetWindow || targetWindow.isDestroyed()) return false;
    if (command === 'minimize') {
      targetWindow.minimize();
      return true;
    }
    if (command === 'maximize') {
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
      return true;
    }
    if (command === 'close') {
      targetWindow.close();
      return true;
    }
    return false;
  };

  ipcMain.handle('window-control', (event, command) => run(command, event));
  ipcMain.on('window-minimize', (event) => run('minimize', event));
  ipcMain.on('window-maximize', (event) => run('maximize', event));
  ipcMain.on('window-close', (event) => run('close', event));
  ipcMain.handle('resolve-app-close', async (event, action) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    if (sourceWindow !== mainWindow) return false;

    if (action === 'quit') {
      closePromptVisible = false;
      closePromptRequestId += 1;
      await quitAppAfterLogout();
      return true;
    }
    if (action === 'minimize') {
      closePromptVisible = false;
      closePromptRequestId += 1;
      minimizeMainWindowToTray();
      return true;
    }
    closePromptVisible = false;
    closePromptRequestId += 1;
    return true;
  });
}

function setupDevToolsAccess() {
  ipcMain.on('set-devtools-access', (event, enabled) => {
    adminDevToolsEnabled = Boolean(enabled);
    if (!adminDevToolsEnabled && mainWindow?.webContents.isDevToolsOpened()) {
      mainWindow.webContents.closeDevTools();
    }
  });
}

if (!gotSingleInstanceLock) {
  app.quit();
  setTimeout(() => process.exit(1), 1500);
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  function startApp() {
    app.whenReady().then(() => {
      registerAppProtocol();
      const csp = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: blob:; font-src 'self' data:`;
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
    app.on('before-quit', () => { isQuitting = true; });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  }

  const srv = require('net').createServer();
  srv.once('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      // another instance on this machine already holds the port
      app.quit();
      setTimeout(() => process.exit(1), 1500);
      return;
    }
    if (!srv.listening) startApp();
  });
  srv.listen(47321, '127.0.0.1', () => {
    // machine-wide lock held for the whole process lifetime
    singleInstanceServer = srv;
    startApp();
  });
}
