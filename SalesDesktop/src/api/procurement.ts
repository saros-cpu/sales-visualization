import client from './client';

export interface ProcurementItem {
  id: number; businessDate: string; productName: string; senderName: string;
  entityName: string; weightTons: number; weighSource: string; remark: string;
}

export async function getProcurementDetails(params: {
  date_from?: string; date_to?: string; page?: number; page_size?: number;
}) {
  const res = await client.get('/procurement/details', { params });
  return res.data;
}

export async function getSuppliers() {
  const res = await client.get('/suppliers');
  return res.data;
}
