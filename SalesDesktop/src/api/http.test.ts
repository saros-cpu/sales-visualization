import { afterEach, describe, expect, it, vi } from 'vitest';

describe('desktop api host resolution', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('accepts runtime allowed hostnames for full API URLs', async () => {
    vi.stubGlobal('window', {
      __SALES_API_HOST__: 'http://sales.example.com',
      SALES_RUNTIME_CONFIG: {
        apiHost: 'http://sales.example.com',
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

    expect(resolveApiHost()).toBe('http://sales.example.com');
  });
});
