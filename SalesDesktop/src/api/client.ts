import { createApi } from './http';
import { ApiPaths } from '@shared/api-contracts';

const client = createApi('/api/v2');
const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await client.post(v2(ApiPaths.auth.changePassword), { oldPassword, newPassword });
  return res.data;
}

export async function getProductOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get(v2(ApiPaths.aliases.products));
  return (res.data || []).map((p: any) => ({ value: p.displayName, label: p.displayName }));
}

export async function getProductAliasOptions(): Promise<{ value: number; label: string }[]> {
  const res = await client.get(v2(ApiPaths.aliases.products));
  return (res.data || []).map((p: any) => ({ value: p.id, label: p.displayName }));
}

export async function getEntityOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get(v2(ApiPaths.aliases.entities));
  const items = new Map<string, string>();
  for (const e of res.data) {
    items.set(e.standardName, e.standardName);
    for (const a of e.aliases) items.set(a, a);
  }
  return Array.from(items.values()).map((v) => ({ value: v, label: v }));
}

export async function getProductAliasesList() {
  const res = await client.get(v2(ApiPaths.aliases.productsList));
  return res.data || [];
}

export async function getEntityAliasesList() {
  const res = await client.get(v2(ApiPaths.aliases.entitiesList));
  return res.data || [];
}

export async function getWholesaleCustomers(params?: { customerType?: string; keyword?: string }) {
  const res = await client.get(v2(ApiPaths.aliases.customers(params)));
  return res.data || [];
}

export async function getUnmatchedAliases() {
  const res = await client.get(v2(ApiPaths.aliases.unmatched));
  return res.data || { products: [], entities: [] };
}

export async function ignoreUnmatchedAliases(items: Array<{ kind: 'product' | 'entity'; rawName: string }>, remark?: string) {
  const res = await client.post(v2(ApiPaths.aliases.unmatchedIgnore), { items, remark });
  return res.data;
}

export async function createProductAlias(productId: number, aliasName: string) {
  const res = await client.post(v2(ApiPaths.aliases.products), { productId, aliasName });
  return res.data;
}

export async function deleteProductAlias(id: number) {
  const res = await client.delete(v2(ApiPaths.aliases.product(id)));
  return res.data;
}

export async function createEntityAlias(entityType: string, entityCode: string, standardName: string, aliasName: string) {
  const res = await client.post(v2(ApiPaths.aliases.entities), { entityType, entityCode, standardName, aliasName });
  return res.data;
}

export async function saveWholesaleCustomer(name: string, customerType: string) {
  const res = await client.post(v2(ApiPaths.aliases.customersBase), { name, customerType });
  return res.data;
}

export async function mergeWholesaleCustomerAlias(sourceCustomerId: number, targetCustomerId: number, aliasName: string) {
  const res = await client.post(v2(ApiPaths.aliases.customerMerge), { sourceCustomerId, targetCustomerId, aliasName });
  return res.data;
}

export async function deleteEntityAlias(id: number) {
  const res = await client.delete(v2(ApiPaths.aliases.entity(id)));
  return res.data;
}

export default client;
