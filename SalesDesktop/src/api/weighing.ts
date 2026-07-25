import client from './client';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface WeighingItem {
  source: string;
  id: string;
  weighSerialNo: string;
  businessDate: string;
  vehicleNo: string;
  senderName: string;
  receiverName: string;
  rawProductName: string;
  standardProductName?: string | null;
  displayProductName?: string | null;
  standardSenderName?: string | null;
  standardReceiverName?: string | null;
  displaySenderName?: string | null;
  displayReceiverName?: string | null;
  standardEntityName?: string | null;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number;
  classification: string;
  status: string;
  remark: string;
  reviewRemark?: string | null;
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
  const res = await client.get(v2(ApiPaths.weighing.list), { params });
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
  const res = await client.post(v2(ApiPaths.weighing.verify), data);
  return res.data;
}

export async function batchReviewWeighing(data: {
  action: 'approve' | 'reject' | 'classify';
  records: Array<Pick<WeighingItem, 'source' | 'id' | 'classification'>>;
  classification?: string;
  remark?: string;
}) {
  const res = await client.post(v2(ApiPaths.weighing.batchReview), data);
  return res.data;
}
