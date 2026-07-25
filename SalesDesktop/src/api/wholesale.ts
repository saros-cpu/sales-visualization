import { API_HOST, createApi } from './http';
import { downloadWithAuth } from './download';
import type { WholesalePageData } from '@/types/api';
import { ApiPaths } from '@shared/api-contracts';

const apiV1 = createApi('/api');
const apiV2 = createApi('/api/v2');
const core = (path: string) => path.replace(/^\/api/, '') || '/';
const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface WholesaleItem {
  id: number | string; sourceId?: number | string; businessDate: string; productName: string; rawProductName?: string; standardProductName?: string;
  vehicleNo: string; weighSerialNo?: string;
  senderName: string; standardSenderName?: string; entityName: string; rawEntityName?: string; standardEntityName?: string;
  entityCode: string; entityType: string;
  classification: string; weightKg?: number; weightTons: number; matchStatus?: string; weighSource: string;
  transportMode: string; remark: string; createdAt: string;
  importBatchId?: number | string | null; sourceType?: string; sourceRowNumber?: number;
  dataSource?: 'business' | 'weighing' | 'uploaded' | string;
}

export interface WholesaleDetailParams {
  date_from?: string; date_to?: string; classification?: string;
  product_name?: string; entity_name?: string; vehicle_no?: string; source?: string; transport_mode?: string;
  data_source?: 'business' | 'weighing' | 'uploaded' | string; page?: number; page_size?: number;
}

function cleanParams(params: WholesaleDetailParams) {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]),
  );
}

export async function getWholesaleDetails(params: WholesaleDetailParams) {
  const res = await apiV2.get(v2(ApiPaths.wholesale.details), { params });
  return res.data;
}

export async function getWholesaleDetailFilterOptions(): Promise<{
  companies: Array<{ value: string; label: string; customerType?: string }>;
  products: Array<{ value: string; label: string }>;
}> {
  const res = await apiV2.get(v2(ApiPaths.wholesale.detailFilterOptions));
  return {
    companies: Array.isArray(res.data?.companies) ? res.data.companies : [],
    products: Array.isArray(res.data?.products) ? res.data.products : [],
  };
}

export async function downloadWholesaleDetailsExport(params: WholesaleDetailParams) {
  const clean = cleanParams(params);
  const search = new URLSearchParams(clean);
  const url = `${API_HOST}${ApiPaths.wholesale.detailsExport}${search.toString() ? `?${search.toString()}` : ''}`;
  const filename = `明细表_${params.date_from || 'start'}_${params.date_to || 'end'}.xlsx`;
  await downloadWithAuth(url, filename, localStorage.getItem('accessToken') || '');
}

export async function getWholesaleExportDetail(params: {
  classification?: string; date_from?: string; date_to?: string;
}) {
  const res = await apiV2.get(v2(ApiPaths.wholesale.exportDetail), { params });
  return res.data;
}

export async function fetchWholesale(params: { year: number; month?: number }): Promise<WholesalePageData> {
  const res = await apiV1.get(core(ApiPaths.wholesale.overview()), { params });
  return res.data;
}
