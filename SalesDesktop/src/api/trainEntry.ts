import client from './client';

export interface TrainEntryRecord {
  id: number;
  entryDate: string;
  productName: string;
  weighNo?: string;
  senderName: string;
  receiverName: string;
  vehicleNo: string;
  weightKg: number | null;
  remark: string;
  createdAt: string;
}

export async function getTrainEntryList(params: {
  date_from?: string; date_to?: string; page?: number; page_size?: number;
}) {
  const res = await client.get('/train-entry/list', { params });
  return res.data;
}

export async function createTrainEntry(data: {
  entryDate: string; productName: string; vehicleNo: string;
  weighNo?: string; senderName?: string; receiverName?: string; weightKg?: number; remark?: string;
}) {
  const res = await client.post('/train-entry', data);
  return res.data;
}

export async function batchCreateTrainEntry(records: Array<Partial<TrainEntryRecord>>) {
  const res = await client.post('/train-entry/batch', { records });
  return res.data;
}

export async function updateTrainEntry(id: number, data: Partial<{
  entryDate: string; productName: string; vehicleNo: string;
  weighNo: string; senderName: string; receiverName: string; weightKg: number; remark: string;
}>) {
  const res = await client.put(`/train-entry/${id}`, data);
  return res.data;
}

export async function deleteTrainEntry(id: number) {
  const res = await client.delete(`/train-entry/${id}`);
  return res.data;
}
