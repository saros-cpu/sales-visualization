import axios from 'axios';

const retailClient = axios.create({
  baseURL: 'http://127.0.0.1:8900/api',
  timeout: 30000,
});

retailClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

retailClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

interface StationData {
  shopKey: number; name: string; short: string; region: string;
  lng: number; lat: number;
  txnCount: number; volume: number; amount: number; cash: number;
  card: number; cashLiters: number; cardLiters: number; bonus: number;
  status: string; closedReason?: string;
}

interface ResourceData {
  resourceKey: number; name: string; volume: number; amount: number; color: string;
  yoyVolume?: number; yoySales?: number; momVolume?: number; momSales?: number;
}

interface DailyData {
  date: string; volume: number; amount: number;
}

interface MonthlySummary {
  totalTxn: number; totalShops: number; totalLiters: number; totalSales: number;
  cashSales: number; cardSales: number; cashLiters: number; cardLiters: number;
  activeShops: number;
}

interface RegionData {
  amount: number; volume: number; cash: number; card: number; bonus: number;
  stationCount: number; activeCount: number;
  momSales?: number; momVolume?: number; yoySales?: number; yoyVolume?: number;
}

export interface DashboardYearlyData {
  year: number;
  stations: StationData[];
  depots: { name: string; short: string; region: string; lng: number; lat: number }[];
  regions: Record<string, RegionData>;
  byResource: ResourceData[];
}

export interface MonthlyData {
  month: string;
  summary: MonthlySummary;
  comparison: { mom: Record<string, number>; yoy: Record<string, number> };
  stations: StationData[];
  regions: Record<string, RegionData>;
  byResource: ResourceData[];
  daily: DailyData[];
}

export interface StationMonthlyData {
  month: string; shopKey: number; name: string; short: string; region: string;
  summary: MonthlySummary & { baseCost: number };
  comparison: { mom: Record<string, number>; yoy: Record<string, number> };
  byResource: ResourceData[];
  daily: DailyData[];
}

export interface RegionsData {
  month: string;
  regions: Record<string, RegionData>;
  byResource: ResourceData[];
  byResourceByRegion: Record<string, ResourceData[]>;
}

export interface DailyDataResponse {
  month: string;
  daily: DailyData[];
  stations: Record<string, DailyData[]>;
}

export interface ResourceYearlyData {
  year: number; month: number;
  resources: ResourceData[];
  summary: { totalVolume: number; totalAmount: number; resourceCount: number };
}

export async function getDashboardYearly(year: number) {
  const res = await retailClient.get('/dashboard/yearly', { params: { year } });
  return res.data as DashboardYearlyData;
}

export async function getMonthly(yearMonth: string) {
  const res = await retailClient.get(`/monthly/${yearMonth}`);
  return res.data as MonthlyData;
}

export async function getStations(yearMonth: string) {
  const res = await retailClient.get(`/stations/${yearMonth}`);
  return res.data;
}

export async function getStationMonthly(yearMonth: string, shopKey: number) {
  const res = await retailClient.get(`/station/${yearMonth}/${shopKey}`);
  return res.data as StationMonthlyData;
}

export async function getRegions(yearMonth: string) {
  const res = await retailClient.get(`/regions/${yearMonth}`);
  return res.data as RegionsData;
}

export async function getDaily(yearMonth: string) {
  const res = await retailClient.get(`/daily/${yearMonth}`);
  return res.data as DailyDataResponse;
}

export async function getResourcesYearly(year: number, month?: number) {
  const params: Record<string, number> = { year };
  if (month) params.month = month;
  const res = await retailClient.get('/resources/yearly', { params });
  return res.data as ResourceYearlyData;
}

export async function getKpi() {
  const res = await retailClient.get('/kpi');
  return res.data;
}

export async function getKpiYearly(year: number) {
  const res = await retailClient.get('/kpi/yearly', { params: { year } });
  return res.data;
}

export async function getYears() {
  const res = await retailClient.get('/years');
  return res.data as string[];
}

export async function getMonths() {
  const res = await retailClient.get('/months');
  return res.data as string[];
}
