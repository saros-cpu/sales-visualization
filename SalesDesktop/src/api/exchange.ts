import axios from 'axios';

const client = axios.create({
  baseURL: 'http://198.51.100.10:8080/api',
  timeout: 15000,
});

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
  const res = await client.get('/home/exchange-current');
  return res.data;
}

export async function getExchangeRates(year: number, month: number): Promise<ExchangeRatesResponse> {
  const res = await client.get('/exchange-rates', { params: { year, month } });
  return res.data;
}

export function exportExchangeRates(year: number, month: number) {
  const token = localStorage.getItem('accessToken');
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  const url = `http://198.51.100.10:8080/api/export/exchange-rates?${params}`;
  const a = document.createElement('a');
  a.href = url;
  if (token) {
    // fetch with auth header then download blob
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const u = URL.createObjectURL(blob);
        const b = document.createElement('a');
        b.href = u;
        b.download = `汇率快照${year}年${month}月.xlsx`;
        b.click();
        URL.revokeObjectURL(u);
      });
  } else {
    a.click();
  }
}