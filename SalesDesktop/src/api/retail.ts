import { createApi } from './http';

const api = createApi('/api');

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
  cashSales?: number; cardSales?: number;
}

interface MonthlySummary {
  totalTxn: number; totalShops: number; totalLiters: number; totalSales: number;
  cashSales: number; cardSales: number; cashLiters: number; cardLiters: number;
  activeShops: number;
  inventory?: number; inventoryMonth?: string;
  totalTons?: number; totalSalesCny?: number;
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
  const res = await api.get('/dashboard/yearly', { params: { year } });
  return res.data as DashboardYearlyData;
}

export async function getMonthly(yearMonth: string) {
  const res = await api.get(`/monthly/${yearMonth}`);
  return res.data as MonthlyData;
}

export async function getStations(yearMonth: string) {
  const res = await api.get(`/stations/${yearMonth}`);
  return res.data;
}

export async function getStationMonthly(yearMonth: string, shopKey: number) {
  const res = await api.get(`/station/${yearMonth}/${shopKey}`);
  return res.data as StationMonthlyData;
}

export async function getRegions(yearMonth: string) {
  const res = await api.get(`/regions/${yearMonth}`);
  return res.data as RegionsData;
}

export async function getDaily(yearMonth: string) {
  const res = await api.get(`/daily/${yearMonth}`);
  return res.data as DailyDataResponse;
}

export async function getResourcesYearly(year: number, month?: number) {
  const params: Record<string, number> = { year };
  if (month) params.month = month;
  const res = await api.get('/resources/yearly', { params });
  return res.data as ResourceYearlyData;
}

export async function getKpi() {
  const res = await api.get('/kpi');
  return res.data;
}

export async function getKpiYearly(year: number) {
  const res = await api.get('/kpi/yearly', { params: { year } });
  return res.data;
}

export async function getYears() {
  const res = await api.get('/years');
  return res.data as string[];
}

export async function getMonths() {
  const res = await api.get('/months');
  return res.data as string[];
}

export async function getStationStatuses() {
  const res = await api.get('/retail/station-statuses');
  return res.data?.items ?? res.data;
}

export async function exportMonthlyExcel(ym: string) {
  const res = await api.get(`/export/monthly/${ym}`);
  return res.data;
}

export interface SelfUseRecord {
  transactionKey: number;
  date: string;
  time: string;
  shopKey: number;
  stationName: string;
  stationShort?: string;
  resourceKey: number;
  productName: string;
  volume: number;
  amount: number;
  plateNumber: string;
}

export interface SelfUseData {
  month: string;
  records: SelfUseRecord[];
  summary: {
    totalVolume: number;
    totalAmount: number;
    totalRecords: number;
  };
}

export async function getSelfUse(yearMonth: string) {
  const res = await api.get(`/retail/self-use/${yearMonth}`);
  return res.data as SelfUseData;
}

export interface SelfUseRangeData {
  date_from: string;
  date_to: string;
  records: SelfUseRecord[];
  summary: {
    totalVolume: number;
    totalRecords: number;
  };
}

export async function getSelfUseByRange(date_from: string, date_to: string) {
  const res = await api.get('/retail/self-use', { params: { date_from, date_to } });
  return res.data as SelfUseRangeData;
}
