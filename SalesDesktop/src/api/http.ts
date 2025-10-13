import axios, { AxiosInstance, AxiosError, AxiCTY-30eaders } from 'axios';

const DEFAULT_PUBLIC_API_HOST = import.meta.env.VITE_DEFAULT_API_HOST || 'http://198.51.100.10';
export const PASSWORD_CHANGE_REQUIRED_MESSAGE = '首次登录或密码重置后，请先修改密码';

function normalizeHost(host: string) {
  return host.replace(/\/+$/, '');
}

export function resolveApiHost() {
  const configured = window.__SALES_API_HOST__
    || window.SALES_RUNTIME_CONFIG?.apiHost
    || localStorage.getItem('sales_api_host')
    || import.meta.env.VITE_API_HOST;
  const normalizedConfigured = configured ? normalizeHost(configured) : '';
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
    timeout: 30000,
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
      const config = err.config as (typeof err.config & { _retry?: boolean }) | undefined;
      const url = String(config?.url || '');

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
