import { createApi } from './http';
import { ApiPaths } from '@shared/api-contracts';

const api = createApi('/api');
const core = (path: string) => path.replace(/^\/api/, '');

interface StationData {
  shopKey: number; name: string; short: string; region: string;
  lng: number; lat: number;
  txnCount: number; volume: number; mass?: number; tons?: number; amount: number; amountCnyAvg?: number | null; avgCnyKgs?: number | null; cash: number;
  card: number; cashLiters: number; cardLiters: number; bonus: number;
  status: string; closedReason?: string;
}

interface ResourceData {
  resourceKey: number; name: string; volume: number; mass?: number; tons?: number; density?: number; amount: number; amountCnyAvg?: number | null; avgCnyKgs?: number | null; color: string;
  yoyVolume?: number; yoySales?: number; momVolume?: number; momSales?: number;
  latestMonthMass?: number; latestMonthTons?: number;
}

interface DailyData {
  date: string; volume: number; mass?: number; tons?: number; amount: number;
  cashSales?: number; cardSales?: number;
}

interface MonthlySummary {
  totalTxn: number; totalShops: number; totalLiters: number; totalSales: number;
  cashSales: number; cardSales: number; cashLiters: number; cardLiters: number;
  activeShops: number;
  inventory?: number; inventoryMonth?: string;
  totalTons?: number; totalSalesCny?: number; totalSalesCnyAvg?: number | null; totalAmountCnyAvg?: number | null; avgCnyKgs?: number | null;
}

interface RegionData {
  amount: number; volume: number; mass?: number; tons?: number; amountCnyAvg?: number | null; avgCnyKgs?: number | null; cash: number; card: number; bonus: number;
  stationCount: number; activeCount: number;
  momSales?: number; momVolume?: number; yoySales?: number; yoyVolume?: number;
}

export interface DashboardYearlyData {
  year: number;
  queryStart?: string; queryEndExclusive?: string; avgCnyKgs?: number | null;
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
  month: string; queryStart?: string; queryEndExclusive?: string; avgCnyKgs?: number | null; shopKey: number; name: string; short: string; region: string;
  summary: MonthlySummary & { baseCost: number };
  comparison: { mom: Record<string, number>; yoy: Record<string, number> };
  byResource: ResourceData[];
  daily: DailyData[];
}

export interface RegionsData {
  month: string;
  queryStart?: string; queryEndExclusive?: string; avgCnyKgs?: number | null;
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
  queryStart?: string; queryEndExclusive?: string; avgCnyKgs?: number | null;
  resources: ResourceData[];
  summary: { totalVolume: number; totalTons?: number; totalAmount: number; totalSalesCnyAvg?: number | null; totalAmountCnyAvg?: number | null; avgCnyKgs?: number | null; resourceCount: number };
}

export async function getDashboardYearly(year: number) {
  const res = await api.get(core(ApiPaths.retail.dashboardYearly(year)));
  return res.data as DashboardYearlyData;
}

export async function getMonthly(yearMonth: string) {
  const res = await api.get(core(ApiPaths.retail.monthly(yearMonth)));
  return res.data as MonthlyData;
}

export async function getStations(yearMonth: string) {
  const res = await api.get(core(ApiPaths.retail.stations(yearMonth)));
  return res.data;
}

export async function getStationMonthly(yearMonth: string, shopKey: number) {
  const res = await api.get(core(ApiPaths.retail.station(yearMonth, shopKey)));
  return res.data as StationMonthlyData;
}

export async function getRegions(yearMonth: string) {
  const res = await api.get(core(ApiPaths.retail.regions(yearMonth)));
  return res.data as RegionsData;
}

export async function getDaily(yearMonth: string) {
  const res = await api.get(core(ApiPaths.retail.daily(yearMonth)));
  return res.data as DailyDataResponse;
}

export async function getResourcesYearly(year: number, month?: number) {
  const params: Record<string, number> = { year };
  if (month) params.month = month;
  const res = await api.get(core(ApiPaths.retail.resourcesYearly(params)));
  return res.data as ResourceYearlyData;
}

export async function getKpi() {
  const res = await api.get(core(ApiPaths.retail.kpi));
  return res.data;
}

export async function getStationMapDetails() {
  const res = await api.get(core(ApiPaths.retail.stationMapDetails));
  return res.data;
}

export async function getMapStations() {
  const res = await api.get(core(ApiPaths.map.stations));
  return res.data;
}

export async function getKpiYearly(year: number) {
  const res = await api.get(core(ApiPaths.retail.kpiYearly(year, undefined)));
  return res.data;
}

export async function getYears() {
  const res = await api.get(core(ApiPaths.retail.years));
  return res.data as string[];
}

export async function getMonths() {
  const res = await api.get(core(ApiPaths.retail.months));
  return res.data as string[];
}

export async function getStationStatuses() {
  const res = await api.get(core(ApiPaths.retail.stationStatuses));
  return res.data?.items ?? res.data;
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
  mass?: number;
  density?: number;
  amount: number;
  plateNumber: string;
}

export interface SelfUseData {
  month: string;
  records: SelfUseRecord[];
  summary: {
    totalVolume: number;
    totalWeightKg?: number;
    totalTons?: number;
    totalAmount: number;
    totalRecords: number;
  };
}

export async function getSelfUse(yearMonth: string) {
  const res = await api.get(core(ApiPaths.retail.selfUseMonth(yearMonth)));
  return res.data as SelfUseData;
}

export interface SelfUseRangeData {
  date_from: string;
  date_to: string;
  records: SelfUseRecord[];
  summary: {
    totalVolume: number;
    totalWeightKg?: number;
    totalTons?: number;
    totalAmount?: number;
    totalRecords: number;
  };
}

export async function getSelfUseByRange(date_from: string, date_to: string) {
  const res = await api.get(core(ApiPaths.retail.selfUseRange(date_from, date_to)));
  return res.data as SelfUseRangeData;
}

// ── 零售外运实收统计 ──
export interface RetailTransferRecord {
  date?: string;
  month?: string;
  shopKey?: number;
  shopName?: string;
  nameKnown?: boolean;
  resourceKey?: number;
  resourceLabel?: string;
  liters: number;
  tons: number;
  density?: number;
  rows: number;
}

export interface RetailTransferSummary {
  byStation: Array<{ shopKey: number; shopName: string; liters: number; tons: number; density?: number; rows: number }>;
  byResource: Array<{ resourceKey: number; resourceLabel: string; liters: number; tons: number; density?: number; rows: number }>;
  byMonth: Array<{ month: string; liters: number; tons: number; density?: number; rows: number }>;
}

export interface RetailTransferData {
  range: { start: string; end: string };
  sourceNote?: string;
  total: { liters: number; tons: number; rows: number; density?: number };
  summary: RetailTransferSummary;
  stations?: Array<{ shopKey: number; shopName: string }>;
  records: RetailTransferRecord[];
  recordCount: number;
}

export async function getRetailTransferStats(params: {
  start?: string;
  end?: string;
  mode?: 'range' | 'year' | 'month';
  year?: number;
  month?: number;
  groupBy?: string;
  resource?: string;
  shopKey?: string | number;
  nameStatus?: 'all' | 'known' | 'blank';
}): Promise<RetailTransferData> {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await api.get(core(`${ApiPaths.retailTransfer.stats}${suffix}`));
  return res.data as RetailTransferData;
}
