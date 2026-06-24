import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(__dirname, 'runtime-config.cjs');
const originalResourcesPath = process.resourcesPath;
const originalApiHost = process.env.SALES_API_HOST;
const originalUpdateUrl = process.env.SALES_UPDATE_URL;

function loadFreshRuntimeConfig() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function fakePackagedApp(userDataPath) {
  return {
    isPackaged: true,
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected path ${name}`);
      return userDataPath;
    },
  };
}

describe('electron runtime config', () => {
  afterEach(() => {
    if (originalResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = originalResourcesPath;
    if (originalApiHost === undefined) delete process.env.SALES_API_HOST;
    else process.env.SALES_API_HOST = originalApiHost;
    if (originalUpdateUrl === undefined) delete process.env.SALES_UPDATE_URL;
    else process.env.SALES_UPDATE_URL = originalUpdateUrl;
  });

  it('defaults new packaged builds to the HTTPS domain', () => {
    delete process.env.SALES_API_HOST;
    delete process.env.SALES_UPDATE_URL;
    delete process.resourcesPath;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-runtime-'));

    const { loadRuntimeConfig } = loadFreshRuntimeConfig();
    const config = loadRuntimeConfig(fakePackagedApp(userData));

    expect(config.apiHost).toBe('https://sales.example.com');
    expect(config.updateUrl).toBe('https://sales.example.com/download');
  });

  it('upgrades legacy HTTP domain config to HTTPS', () => {
    delete process.env.SALES_API_HOST;
    delete process.env.SALES_UPDATE_URL;
    delete process.resourcesPath;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-runtime-'));
    fs.writeFileSync(
      path.join(userData, 'app-config.json'),
      JSON.stringify({
        apiHost: 'http://sales.example.com',
        updateUrl: 'http://sales.example.com/download',
      }),
      'utf8',
    );

    const { loadRuntimeConfig } = loadFreshRuntimeConfig();
    const config = loadRuntimeConfig(fakePackagedApp(userData));

    expect(config.apiHost).toBe('https://sales.example.com');
    expect(config.updateUrl).toBe('https://sales.example.com/download');
    expect(config.allowedHosts).toContain('198.51.100.10');
  });

  it('upgrades legacy public IP file config to the HTTPS domain', () => {
    delete process.env.SALES_API_HOST;
    delete process.env.SALES_UPDATE_URL;
    delete process.resourcesPath;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-runtime-'));
    fs.writeFileSync(
      path.join(userData, 'app-config.json'),
      JSON.stringify({
        apiHost: 'http://198.51.100.10',
        updateUrl: 'http://198.51.100.10/download',
      }),
      'utf8',
    );

    const { loadRuntimeConfig } = loadFreshRuntimeConfig();
    const config = loadRuntimeConfig(fakePackagedApp(userData));

    expect(config.apiHost).toBe('https://sales.example.com');
    expect(config.updateUrl).toBe('https://sales.example.com/download');
  });

  it('keeps explicit environment fallback config unchanged', () => {
    process.env.SALES_API_HOST = 'http://198.51.100.10';
    process.env.SALES_UPDATE_URL = 'http://198.51.100.10/download';
    delete process.resourcesPath;
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-runtime-'));

    const { loadRuntimeConfig } = loadFreshRuntimeConfig();
    const config = loadRuntimeConfig(fakePackagedApp(userData));

    expect(config.apiHost).toBe('http://198.51.100.10');
    expect(config.updateUrl).toBe('http://198.51.100.10/download');
  });
});
