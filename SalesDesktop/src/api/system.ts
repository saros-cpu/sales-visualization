import client from './client';

export async function getSystemHealth() {
  const res = await client.get('/system/health');
  return res.data;
}

export async function recordDevToolsOpen() {
  const res = await client.post('/system/devtools-open');
  return res.data;
}
