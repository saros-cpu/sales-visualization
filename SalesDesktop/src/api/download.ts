import { refreshAccessToken } from './http';

async function getFreshToken(preferredToken?: string) {
  const refreshed = await refreshAccessToken();
  return refreshed || preferredToken || localStorage.getItem('accessToken') || '';
}

export async function downloadWithAuth(url: string, filename: string, token?: string) {
  const authToken = await getFreshToken(token);
  if (window.electronAPI?.downloadFile) {
    const ok = await window.electronAPI.downloadFile(url, filename, authToken);
    if (!ok) throw new Error('download cancelled');
    return;
  }

  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let res = await fetch(url, { headers });
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken) {
      res = await fetch(url, { headers: { Authorization: `Bearer ${retryToken}` } });
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
}
