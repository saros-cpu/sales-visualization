import client from './client';

export interface Contract {
  id: number; contractNo: string; appendixNo: string; signedDate: string;
  effectiveStart: string; effectiveEnd: string; customerName: string;
  productName: string; salesType: string; quantityTons: number;
  amountOriginal: number; currency: string; executedTons: number; remark?: string;
}

export interface ContractExecution {
  id: number; contractNo: string; customerName: string; productName: string;
  quantityTons: number; effectiveStart: string; effectiveEnd: string;
  monthly: Array<{ yearMonth: string; executedTons: number }>;
}

export interface MonthlyVolume {
  yearMonth: string; volumeTons: number;
}

export async function getContracts(params?: { company?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number }) {
  const res = await client.get('/contracts', { params });
  return res.data as { items: Contract[]; total: number };
}

export async function createContract(data: {
  contractNo: string; customerName: string; productName: string;
  appendixNo?: string; signedDate?: string; effectiveStart?: string;
  effectiveEnd?: string; salesType?: string; quantityTons?: number;
  amountOriginal?: number; currency?: string; remark?: string;
}) {
  const res = await client.post('/contracts', data);
  return res.data;
}

export async function batchCreateContracts(records: Array<{
  contractNo: string; customerName: string; productName: string;
  appendixNo?: string; signedDate?: string; effectiveStart?: string;
  effectiveEnd?: string; salesType?: string; quantityTons?: number;
  amountOriginal?: number; currency?: string; remark?: string;
}>) {
  const res = await client.post('/contracts/batch', { records });
  return res.data as { inserted: number; errors: Array<{ row: number; message: string; fields?: string[] }> };
}

export async function updateContract(id: number, data: Partial<Contract>) {
  const res = await client.put(`/contracts/${id}`, data);
  return res.data;
}

export async function getContractExecution(id: number) {
  const res = await client.get(`/contracts/${id}/execution`);
  return res.data as { code: number; data: ContractExecution };
}

export async function deleteContract(id: number) {
  const res = await client.delete(`/contracts/${id}`);
  return res.data;
}

export async function getContractAutoVolume(id: number) {
  const res = await client.get(`/contracts/${id}/auto-volume`);
  return res.data as { code: number; data: MonthlyVolume[] };
}
