// src/api/retail.js — 零售模块 API
import { get } from './client';

// ── 年份 & 月份 ──
export const getYears = () => get('/api/years');
export const getMonths = () => get('/api/months');

// ── 仪表板 ──
export const getDashboardYearly = (year) =>
  get(`/api/dashboard/yearly?year=${year}`);
export const getKpiYearly = (year) =>
  get(`/api/kpi/yearly?year=${year}&inventory=0`);
export const getStationMapDetails = () => get('/api/station-map-details');

// ── 月度 ──
export const getMonthlyData = (ym, { refresh } = {}) => {
  return get(`/api/monthly/${ym}`, refresh ? { refresh: '1' } : undefined);
};
export const getStations = (ym) => get(`/api/stations/${ym}`);
export const getStationsForMonth = (ym) => get(`/api/stations/${ym}`);

// ── 站点详情 ──
export const getStationDetail = (ym, shopKey) =>
  get(`/api/station/${ym}/${shopKey}`);

// ── 区域 ──
export const getRegions = (ym) => get(`/api/regions/${ym}`);
export const getDaily = (ym) => get(`/api/daily/${ym}`);

// ── 油品 ──
export const getResourcesYearly = (year, month) => {
  const params = new URLSearchParams({ year: String(year) });
  if (month) params.set('month', String(month));
  return get(`/api/resources/yearly?${params}`);
};

// ── 站点状态（预警页） ──
export const getStationStatuses = () => get('/api/retail/station-statuses');

// ── KPI（通用） ──
export const getKpi = () => get('/api/kpi');

// ── 报告导出 ──
export const generateYearlyReport = (year) =>
  get(`/api/export/analysis/yearly/${encodeURIComponent(year)}`);
export const generateMonthlyReport = (ym) =>
  get(`/api/export/analysis/monthly/${encodeURIComponent(ym)}`);
export const exportMonthlyExcel = (ym) =>
  get(`/api/export/monthly/${ym}`);

// ── 零售页面导航 ──
export const getRetailPages = () => get('/api/retail/pages');
