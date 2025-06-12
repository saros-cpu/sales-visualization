import client from './client';

export interface WeighingItem {
  source: string;
  id: string;
  weighSerialNo: string;
  businessDate: string;
  vehicleNo: string;
  senderName: string;
  receiverName: string;
  rawProductName: string;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number;
  classification: string;
  status: string;
  remark: string;
}

export interface WeighingListParams {
  date_from: string;
  date_to: string;
  vehicle_no?: string;
  status?: string;
  classification?: string;
  source?: string;
  page?: number;
  page_size?: number;
}

export async function getWeighingList(params: WeighingListParams) {
  const res = await client.get('/weighing/list', { params });
  return res.data;
}

export async function verifyWeighing(data: {
  weighing_source: string;
  weighing_id: number;
  field_name: string;
  old_value: string;
  new_value: string;
  operator_id: number;
  remark?: string;
}) {
  const res = await client.post('/weighing/verify', data);
  return res.data;
}
