import client from './client';

export interface WholesaleItem {
  id: number; businessDate: string; productName: string; vehicleNo: string;
  senderName: string; entityName: string; entityCode: string; entityType: string;
  classification: string; weightTons: number; weighSource: string;
  transportMode: string; auditStatus: string; remark: string; createdAt: string;
}

export async function getWholesaleDetails(params: {
  date_from?: string; date_to?: string; classification?: string;
  product_name?: string; entity_name?: string; page?: number; page_size?: number;
}) {
  const res = await client.get('/wholesale/details', { params });
  return res.data;
}

export async function getWholesaleExportDetail(params: {
  classification?: string; date_from?: string; date_to?: string;
}) {
  const res = await client.get('/wholesale/export-detail', { params });
  return res.data;
}
