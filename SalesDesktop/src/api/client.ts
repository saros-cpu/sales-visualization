import axios from 'axios';

const client = axios.create({
  baseURL: 'http://127.0.0.1:8900/api/v2',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await client.post('/auth/change-password', { oldPassword, newPassword });
  return res.data;
}

export async function getProductOptions(): Promise<{value: string; label: string}[]> {
  const res = await client.get('/aliases/products');
  return (res.data.data || []).map((p: any) => ({ value: p.displayName, label: p.displayName }));
}

export async function getEntityOptions(): Promise<{value: string; label: string}[]> {
  const res = await client.get('/aliases/entities');
  const items = new Map<string, string>();
  for (const e of res.data.data) {
    items.set(e.standardName, e.standardName);
    for (const a of e.aliases) items.set(a, a);
  }
  return Array.from(items.values()).map((v) => ({ value: v, label: v }));
}

export async function getProductAliasesList() {
  const res = await client.get('/aliases/products/list');
  return res.data.data || [];
}

export async function getEntityAliasesList() {
  const res = await client.get('/aliases/entities/list');
  return res.data.data || [];
}

export async function createProductAlias(productId: number, aliasName: string) {
  const res = await client.post('/aliases/products', { productId, aliasName });
  return res.data;
}

export async function deleteProductAlias(id: number) {
  const res = await client.delete(`/aliases/products/${id}`);
  return res.data;
}

export async function createEntityAlias(entityType: string, entityCode: string, standardName: string, aliasName: string) {
  const res = await client.post('/aliases/entities', { entityType, entityCode, standardName, aliasName });
  return res.data;
}

export async function deleteEntityAlias(id: number) {
  const res = await client.delete(`/aliases/entities/${id}`);
  return res.data;
}

export default client;
