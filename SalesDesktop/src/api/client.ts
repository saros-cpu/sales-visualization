import { createApi } from './http';

const client = createApi('/api/v2');

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await client.post('/auth/change-password', { oldPassword, newPassword });
  return res.data;
}

export async function getProductOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get('/aliases/products');
  return (res.data || []).map((p: any) => ({ value: p.displayName, label: p.displayName }));
}

export async function getEntityOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get('/aliases/entities');
  const items = new Map<string, string>();
  for (const e of res.data) {
    items.set(e.standardName, e.standardName);
    for (const a of e.aliases) items.set(a, a);
  }
  return Array.from(items.values()).map((v) => ({ value: v, label: v }));
}

export async function getProductAliasesList() {
  const res = await client.get('/aliases/products/list');
  return res.data || [];
}

export async function getEntityAliasesList() {
  const res = await client.get('/aliases/entities/list');
  return res.data || [];
}

export async function getUnmatchedAliases() {
  const res = await client.get('/aliases/unmatched');
  return res.data || { products: [], entities: [] };
}

export async function ignoreUnmatchedAliases(items: Array<{ kind: 'product' | 'entity'; rawName: string }>, remark?: string) {
  const res = await client.post('/aliases/unmatched/ignore', { items, remark });
  return res.data;
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
