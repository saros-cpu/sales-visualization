// 基础 API 客户端 - 统一处理请求、Cookie、错误
const BASE = '';

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  // 401 → 跳转登录
  if (res.status === 401 && !path.includes('/auth/')) {
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  if (!res.ok) {
    if (isJson) {
      const body = await res.json();
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

// 构建查询字符串
export const buildQuery = (params) => {
  const p = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p[k] = v;
  }
  return new URLSearchParams(p).toString();
};

// 触发文件下载
export function triggerDownload(url) {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
export const download = triggerDownload;
