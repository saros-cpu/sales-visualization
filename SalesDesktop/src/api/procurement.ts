import client from './client';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface ProcurementItem {
  id: number; businessDate: string; productName: string; rawProductName?: string; standardProductName?: string; senderName: string;
  entityName: string; weightTons: number; weighSource: string; remark: string;
}

export async function getProcurementDetails(params: {
  date_from?: string; date_to?: string; product_name?: string; page?: number; page_size?: number;
}) {
  const res = await client.get(v2(ApiPaths.procurement.details), { params });
  return res.data;
}

export async function getProcurementProducts(): Promise<Array<{ value: string; label: string; productId?: number; rows?: number }>> {
  const res = await client.get(v2(ApiPaths.procurement.products));
  return res.data || [];
}

export async function getSuppliers() {
  const res = await client.get(v2(ApiPaths.procurement.suppliers));
  return res.data;
}
