import client from './client';

export interface LossItem {
  route: string; route_code?: string;
  station_name: string; system_qty: number; actual_qty: number;
  loss_qty: number; loss_rate: number; report_date: string;
  supply_date?: string; evidence?: string; evidence_code?: string;
  evidence_days?: number | null; evidence_tons?: number;
  retail_liters?: number; rows?: number;
  target_type?: string;
}

export async function getTransferLoss(params: { year?: number; quarter?: number }) {
  const res = await client.get('/transfer/loss', { params });
  return res.data;
}

export async function getTransferLossYears() {
  const res = await client.get('/transfer/loss/years');
  return res.data as number[];
}
