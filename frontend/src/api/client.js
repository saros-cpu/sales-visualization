const BASE = '';

export function storeAuthTokens(data = {}) {
  if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
  if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
}

export function clearAuthTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = fetch('/api/v2/auth/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh_failed');
        const body = await res.json();
        const accessToken = body?.data?.accessToken || body?.accessToken;
        if (!accessToken) throw new Error('refresh_failed');
        localStorage.setItem('accessToken', accessToken);
        return accessToken;
      })
      .catch(() => {
        clearAuthTokens();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function buildHeaders(options) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const token = localStorage.getItem('accessToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function api(path, options = {}, retried = false) {
  const { headers: _headers, ...requestOptions } = options;
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...requestOptions,
    headers: buildHeaders(options),
  });

  if (res.status === 401 && !path.includes('/auth/') && !retried) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api(path, options, true);
  }

  if (res.status === 401 && !path.includes('/auth/')) {
    clearAuthTokens();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  if (!res.ok) {
    if (isJson) {
      const body = await res.json();
      if (
        res.status === 403
        && (body.code === 4091 || body.error === 'password_change_required' || body.message === 'password_change_required')
        && !path.includes('/auth/change-password')
      ) {
        window.location.href = '/change-password';
      }
      throw new Error(body.message || body.error || '请求失败');
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  if (isJson) {
    const json = await res.json();
    return json.data ?? json;
  }
  return res;
}

export const get = (path, params) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return api(path + qs);
};

export const post = (path, body) =>
  api(path, { method: 'POST', body: JSON.stringify(body) });

export const del = (path) => api(path, { method: 'DELETE' });

export const put = (path, body) =>
  api(path, { method: 'PUT', body: JSON.stringify(body) });

export const buildQuery = (params) => {
  const p = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p[k] = v;
  }
  return new URLSearchParams(p).toString();
};

function filenameFromDisposition(value) {
  if (!value) return '';
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = value.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : '';
}

export async function triggerDownload(url, filename = '') {
  if (!url) return;
  const token = localStorage.getItem('accessToken');
  if (token) {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename || filenameFromDisposition(res.headers.get('content-disposition')) || '';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 200);
    return;
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export const download = triggerDownload;
