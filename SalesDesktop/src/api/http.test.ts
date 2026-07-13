import { afterEach, describe, expect, it, vi } from 'vitest';

describe('desktop api host resolution', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('accepts runtime allowed hostnames for full API URLs', async () => {
    vi.stubGlobal('window', {
      __SALES_API_HOST__: 'https://sales.example.com',
      SALES_RUNTIME_CONFIG: {
        apiHost: 'https://sales.example.com',
        allowedHosts: ['198.51.100.10', 'sales.example.com'],
      },
      location: {
        protocol: 'file:',
        port: '',
        origin: 'file://',
        hostname: '',
        hash: '',
      },
    });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const { resolveApiHost } = await import('./http');

    expect(resolveApiHost()).toBe('https://sales.example.com');
  });

  it('uses the local backend by default when running from the dev server', async () => {
    vi.stubGlobal('window', {
      __SALES_API_HOST__: 'https://sales.example.com',
      SALES_RUNTIME_CONFIG: {
        apiHost: 'https://sales.example.com',
        allowedHosts: ['198.51.100.10', 'sales.example.com'],
      },
      location: {
        protocol: 'http:',
        port: '5173',
        origin: 'http://localhost:5173',
        hostname: 'localhost',
        hash: '',
      },
    });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const { resolveApiHost } = await import('./http');

    expect(resolveApiHost()).toBe('http://localhost:8900');
  });

  it('upgrades legacy public HTTP hosts before resolving the API host', async () => {
    vi.stubGlobal('window', {
      __SALES_API_HOST__: '',
      SALES_RUNTIME_CONFIG: {
        apiHost: '',
        allowedHosts: ['198.51.100.10', 'sales.example.com'],
      },
      location: {
        protocol: 'file:',
        port: '',
        origin: 'file://',
        hostname: '',
        hash: '',
      },
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'sales_api_host' ? 'http://198.51.100.10' : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    const { resolveApiHost } = await import('./http');

    expect(resolveApiHost()).toBe('https://sales.example.com');
  });
});
