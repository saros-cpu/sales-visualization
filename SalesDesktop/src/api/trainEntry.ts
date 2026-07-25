import client from './client';
import { API_HOST } from './http';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface TrainEntryRecord {
  id: number;
  entryDate: string;
  productName: string;
  weighNo?: string;
  senderName: string;
  receiverName: string;
  vehicleNo: string;
  weightKg: number | null;
  weightTons?: number | null;
  remark: string;
  createdAt: string;
}

export async function getTrainEntryList(params: {
  date_from?: string; date_to?: string; page?: number; page_size?: number;
}) {
  const res = await client.get(v2(ApiPaths.trainEntry.list), { params });
  return res.data;
}

export async function createTrainEntry(data: {
  entryDate: string; productName: string; vehicleNo: string;
  weighNo?: string; senderName?: string; receiverName?: string; weightKg?: number; weightTons?: number; remark?: string;
}) {
  const res = await client.post(v2(ApiPaths.trainEntry.create), data);
  return res.data;
}

export async function batchCreateTrainEntry(records: Array<Partial<TrainEntryRecord>>) {
  const res = await client.post(v2(ApiPaths.trainEntry.batch), { records });
  return res.data;
}

export interface WholesaleUploadResult {
  ok: boolean;
  batchId?: number;
  uploadType?: string;
  uploadLabel?: string;
  recalculation?: unknown;
  error?: string;
}

export async function uploadWholesaleDetailXlsx(file: File): Promise<WholesaleUploadResult> {
  const token = localStorage.getItem('accessToken') || '';
  const form = new FormData();
  form.append('file', file);
  form.append('uploadType', 'wholesale-detail-single');
  const res = await fetch(`${API_HOST}${ApiPaths.admin.importUpload}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  }
  return body ?? {};
}

export interface ManualWholesaleDetailPayload {
  businessDate: string;
  productName: string;
  entityName: string;
  classification?: string;
  weightKg: number;
  vehicleNo?: string;
  senderName?: string;
  weighSerialNo?: string;
  transportMode?: 'truck' | 'train' | string;
  remark?: string;
}

export type WholesaleDetailUpdatePayload = Partial<ManualWholesaleDetailPayload>;

export async function manualCreateWholesaleDetail(payload: ManualWholesaleDetailPayload) {
  const token = localStorage.getItem('accessToken') || '';
  const res = await fetch(`${API_HOST}${ApiPaths.admin.manualWholesaleDetail}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.message || `HTTP ${res.status}`);
  }
  return body ?? {};
}

export async function updateWholesaleDetail(id: number, payload: WholesaleDetailUpdatePayload) {
  const res = await client.put(v2(ApiPaths.wholesale.detail(id)), payload);
  return res.data;
}

export async function updateTrainEntry(id: number, data: Partial<{
  entryDate: string; productName: string; vehicleNo: string;
  weighNo: string; senderName: string; receiverName: string; weightKg: number; weightTons: number; remark: string;
}>) {
  const res = await client.put(v2(ApiPaths.trainEntry.item(id)), data);
  return res.data;
}

export async function deleteTrainEntry(id: number) {
  const res = await client.delete(v2(ApiPaths.trainEntry.item(id)));
  return res.data;
}
