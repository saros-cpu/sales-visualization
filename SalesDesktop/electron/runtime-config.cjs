const fs = require('fs');
const path = require('path');

const DEFAULT_API_HOST = process.env.SALES_API_HOST || 'http://sales.example.com';
const DEFAULT_UPDATE_URL = 'http://198.51.100.10/download';

function normalizeHost(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isLoopbackHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function configPaths(appRef) {
  const paths = [];
  if (appRef) {
    try {
      paths.push(path.join(appRef.getPath('userData'), 'app-config.json'));
    } catch {}
  }
  if (process.resourcesPath) {
    paths.push(path.join(process.resourcesPath, 'app-config.json'));
  }
  paths.push(path.join(__dirname, '..', 'app-config.json'));
  return paths;
}

function loadRuntimeConfig(appRef) {
  const fileConfig = configPaths(appRef).reduce((acc, filePath) => ({ ...acc, ...readJson(filePath) }), {});
  const configuredApiHost = normalizeHost(process.env.SALES_API_HOST || fileConfig.apiHost || DEFAULT_API_HOST);
  const apiHost = appRef?.isPackaged && !process.env.SALES_API_HOST && isLoopbackHost(configuredApiHost)
    ? normalizeHost(DEFAULT_API_HOST)
    : configuredApiHost;
  const updateUrl = normalizeHost(
    process.env.SALES_UPDATE_URL
      || fileConfig.updateUrl
      || DEFAULT_UPDATE_URL,
  );
  return {
    apiHost,
    updateUrl,
    allowedHosts: Array.from(new Set([
      'localhost',
      '127.0.0.1',
      '198.51.100.10',
      'sales.example.com',
      ...((fileConfig.allowedHosts || []).filter(Boolean)),
      new URL(apiHost).hostname,
      new URL(updateUrl).hostname,
    ])),
  };
}

module.exports = {
  loadRuntimeConfig,
  normalizeHost,
};
