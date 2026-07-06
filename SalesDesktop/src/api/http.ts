import axios, { AxiosInstance, AxiosError, AxiCTY-30eaders } from 'axios';

const DEFAULT_PUBLIC_API_HOST = import.meta.env.VITE_DEFAULT_API_HOST || 'https://sales.example.com';
const PUBLIC_FALLBACK_API_HOSTS = ['http://198.51.100.10'];
export const PASSWORD_CHANGE_REQUIRED_MESSAGE = '首次登录或密码重置后，请先修改密码';

function normalizeHost(host: string) {
  return host.replace(/\/+$/, '');
}

function upgradeLegacyPublicUrl(host: string) {
  const normalizedHost = normalizeHost(host);
  try {
    const parsed = new URL(normalizedHost);
    if (parsed.protocol === 'http:' && ['sales.example.com', '198.51.100.10'].includes(parsed.hostname)) {
      parsed.protocol = 'https:';
      parsed.hostname = 'sales.example.com';
      parsed.port = '';
      return normalizeHost(parsed.toString());
    }
  } catch {
    return normalizedHost;
  }
  return normalizedHost;
}

function defaultAllowedApiHosts() {
  const devHosts = ['localhost', '127.0.0.1'].flatMap((host) => [
    `http://${host}:8900`,
    `http://${host}:5173`,
  ]);
  const runtimeAllowedHosts = (window.SALES_RUNTIME_CONFIG?.allowedHosts || [])
    .map((host) => normalizeHost(String(host)))
    .flatMap((host) => [
      host,
      `http://${host}`,
      `https://${host}`,
    ]);
  return new Set([
    normalizeHost(DEFAULT_PUBLIC_API_HOST),
    ...devHosts,
    ...runtimeAllowedHosts,
  ]);
}

function isAllowedApiHost(host: string) {
  const normalizedHost = normalizeHost(host);
  const allowedHosts = defaultAllowedApiHosts();
  if (allowedHosts.has(normalizedHost)) return true;
  try {
    const parsed = new URL(normalizedHost);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return allowedHosts.has(parsed.hostname) || allowedHosts.has(parsed.origin);
  } catch {
    return false;
  }
}

export function resolveApiHost() {
  const configuredHosts = [
    window.__SALES_API_HOST__,
    window.SALES_RUNTIME_CONFIG?.apiHost,
    localStorage.getItem('sales_api_host'),
    import.meta.env.VITE_API_HOST,
  ].filter(Boolean).map((value) => upgradeLegacyPublicUrl(String(value)));
  const normalizedConfigured = configuredHosts.find(isAllowedApiHost) || '';
  const isDevHost = import.meta.env.DEV || window.location.port === '5173';
  if (normalizedConfigured && !(isDevHost && normalizedConfigured === window.location.origin)) {
    return normalizedConfigured;
  }
  if (isDevHost) {
    const host = window.location.hostname || 'localhost';
    const backendHost = host === '0.0.0.0' ? 'localhost' : host;
    return `http://${backendHost}:8900`;
  }
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return normalizeHost(DEFAULT_PUBLIC_API_HOST);
}

export const API_HOST = resolveApiHost();

function fallbackApiHosts() {
  return Array.from(new Set([
    normalizeHost(DEFAULT_PUBLIC_API_HOST),
    ...PUBLIC_FALLBACK_API_HOSTS.map(normalizeHost),
  ])).filter((host) => host && host !== API_HOST && isAllowedApiHost(host));
}

export function clearAuthTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;

  try {
    const res = await axios.post(
      `${API_HOST}/api/v2/auth/refresh`,
      null,
      { headers: { Authorization: `Bearer ${refreshToken}` } },
    );
    const accessToken = res.data?.data?.accessToken;
    if (!accessToken) return null;
    localStorage.setItem('accessToken', accessToken);
    return accessToken;
  } catch {
    clearAuthTokens();
    return null;
  }
}

function isPasswordChangeRequired(body: Record<string, unknown> | undefined) {
  return (
    body?.code === 4091
    || body?.message === 'password_change_required'
    || body?.error === 'password_change_required'
  );
}

export function createApi(basePath: string): AxiosInstance {
  const instance = axios.create({
    baseURL: `${API_HOST}${basePath}`,
    timeout: 120000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (res) => {
      if (res.data && typeof res.data === 'object' && 'data' in res.data) {
        res.data = res.data.data;
      }
      return res;
    },
    async (err: AxiosError) => {
      const body = err.response?.data as Record<string, unknown> | undefined;
      const config = err.config as (typeof err.config & { _fallbackRetry?: boolean; _retry?: boolean }) | undefined;
      const url = String(config?.url || '');

      if (!err.response && config && !config._fallbackRetry) {
        const fallbackHost = fallbackApiHosts()[0];
        if (fallbackHost) {
          config._fallbackRetry = true;
          config.baseURL = `${fallbackHost}${basePath}`;
          return instance(config);
        }
      }

      if (err.response?.status === 403 && isPasswordChangeRequired(body)) {
        if (!url.includes('/auth/change-password') && window.location.hash !== '#/change-password') {
          window.location.hash = '#/change-password';
        }
        return Promise.reject(new Error(PASSWORD_CHANGE_REQUIRED_MESSAGE));
      }

      if (err.response?.status === 401) {
        const canRefresh = !config?._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh');
        if (config && canRefresh) {
          config._retry = true;
          const accessToken = await refreshAccessToken();
          if (accessToken) {
            const headers = AxiCTY-30eaders.from(config.headers);
            headers.set('Authorization', `Bearer ${accessToken}`);
            config.headers = headers;
            return instance(config);
          }
        }
        clearAuthTokens();
        if (window.location.hash !== '#/login') window.location.hash = '#/login';
      }

      if (isPasswordChangeRequired(body)) {
        return Promise.reject(new Error(PASSWORD_CHANGE_REQUIRED_MESSAGE));
      }
      if (body?.message) {
        return Promise.reject(new Error(String(body.message)));
      }
      return Promise.reject(err);
    },
  );

  return instance;
}

export default createApi;
