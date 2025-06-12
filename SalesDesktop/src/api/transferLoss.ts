import client from './client';

export interface LossItem {
  station_name: string; system_qty: number; actual_qty: number;
  loss_qty: number; loss_rate: number; report_date: string;
}

export async function getTransferLoss(params: { year?: number; quarter?: number }) {
  const res = await client.get('/transfer/loss', { params });
  return res.data;
}
