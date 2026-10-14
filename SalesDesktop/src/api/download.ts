import { refreshAccessToken, buildFallbackUrls, NETWORK_ERROR_RE } from './http';

async function getFreshToken(preferredToken?: string) {
  const refreshed = await refreshAccessToken();
  return refreshed || preferredToken || localStorage.getItem('accessToken') || '';
}

type ElectronDownloadResult =
  {
    ok: boolean;
    filePath?: string;
    error?: string;
    message?: string;
    status?: number;
    statusText?: string;
    bodyPreview?: string;
    canceled?: boolean;
  };

export async function downloadWithAuth(url: string, filename: string, token?: string) {
  const authToken = await getFreshToken(token);
  if (window.electronAPI?.downloadFile) {
    const result = await window.electronAPI.downloadFile(url, filename, authToken) as ElectronDownloadResult | boolean | null;
    if (typeof result === 'object' && result !== null) {
      if (result.ok) return;
      if (result.canceled) {
        throw new Error('下载已取消');
      }
      const parts = [
        result.message,
        result.error,
        result.status ? `HTTP ${result.status}` : '',
        result.bodyPreview,
      ].filter(Boolean);
      throw new Error(parts.join(' | ') || '下载失败');
    }
    if (result === true) return;
    if (result === false || result == null) {
      throw new Error('下载已取消');
    }
  }

  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let lastErr: any;
  for (const candidate of buildFallbackUrls(url)) {
    try {
      let res = await fetch(candidate, { headers });
      if (res.status === 401) {
        const retryToken = await refreshAccessToken();
        if (retryToken) {
          res = await fetch(candidate, { headers: { Authorization: `Bearer ${retryToken}` } });
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 200);
      return;
    } catch (e: any) {
      lastErr = e;
      if (e?.message && NETWORK_ERROR_RE.test(e.message)) continue;
      throw e;
    }
  }
  throw lastErr || new Error('下载失败');
}
