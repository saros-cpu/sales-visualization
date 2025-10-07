export async function downloadWithAuth(url: string, filename: string, token?: string) {
  if (window.electronAPI?.downloadFile) {
    const ok = await window.electronAPI.downloadFile(url, filename, token || '');
    if (!ok) throw new Error('download cancelled');
    return;
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
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
