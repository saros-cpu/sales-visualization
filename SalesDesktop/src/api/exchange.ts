import axios from 'axios';
import { API_HOST } from './http';
import { downloadWithAuth } from './download';
import { ApiPaths } from '@shared/api-contracts';

const client = axios.create({
  baseURL: `${API_HOST}/api`,
  timeout: 15000,
});

function corePath(path: string) {
  return path.replace(/^\/api/, '') || '/';
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface ExchangeRateItem {
  date: string;
  usdKgs: number | null;
  cnyKgs: number | null;
  source: string;
  isManual: boolean;
  gapStatus: string;
  missingUsd: boolean;
  missingCny: boolean;
}

export interface ExchangeRatesResponse {
  items: ExchangeRateItem[];
  total: number;
  missingUsd: number;
  missingCny: number;
  openGaps: number;
}

export interface CurrentExchange {
  date: string;
  usdKgs: number;
  cnyKgs: number;
  source: string;
  isManual: boolean;
}

export async function getCurrentExchange(): Promise<CurrentExchange> {
  const res = await client.get(corePath(ApiPaths.exchange.current));
  return res.data;
}

export async function getExchangeRates(year: number, month: number): Promise<ExchangeRatesResponse> {
  const res = await client.get(corePath(ApiPaths.exchange.rates({ year, month })));
  return res.data;
}

export async function exportExchangeRates(year: number, month: number) {
  const token = localStorage.getItem('accessToken') || '';
  const url = `${API_HOST}${ApiPaths.reports.exchangeRates({ year, month })}`;
  await downloadWithAuth(url, `汇率快照${year}年${month}月.xlsx`, token);
}
