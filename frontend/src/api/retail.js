// src/api/retail.js — 零售模块 API
import { ApiPaths, ReportCatalog } from '@shared/api-contracts';
import { get, download } from './client';

// ── 年份 & 月份 ──
export const getYears = () => get(ApiPaths.retail.years);
export const getMonths = () => get(ApiPaths.retail.months);

// ── 仪表板 ──
export const getDashboardYearly = (year) =>
  get(ApiPaths.retail.dashboardYearly(year));
export const getKpiYearly = (year) =>
  get(ApiPaths.retail.kpiYearly(year));
export const getStationMapDetails = () => get(ApiPaths.retail.stationMapDetails);

// ── 月度 ──
export const getMonthlyData = (ym, { refresh } = {}) => {
  return get(ApiPaths.retail.monthly(ym), refresh ? { refresh: '1' } : undefined);
};
export const getStations = (ym) => get(ApiPaths.retail.stations(ym));

// ── 站点详情 ──
export const getStationDetail = (ym, shopKey) =>
  get(ApiPaths.retail.station(ym, shopKey));

// ── 区域 ──
export const getRegions = (ym) => get(ApiPaths.retail.regions(ym));
export const getDaily = (ym) => get(ApiPaths.retail.daily(ym));

// ── 油品 ──
export const getResourcesYearly = (year, month) => {
  const params = new URLSearchParams({ year: String(year) });
  if (month) params.set('month', String(month));
  return get(ApiPaths.retail.resourcesYearly(Object.fromEntries(params)));
};

// ── 站点状态（预警页） ──
export const getStationStatuses = () => get(ApiPaths.retail.stationStatuses);

// ── KPI（通用） ──
export const getKpi = () => get(ApiPaths.retail.kpi);

// ── 报告导出 ──
export const generateYearlyReport = (year) =>
  get(ApiPaths.reports.analysisYearly(year));
export const generateMonthlyReport = (ym) =>
  get(ApiPaths.reports.analysisMonthly(ym));
export const exportMonthlyExcel = (ym) =>
  get(ApiPaths.reports.monthlyRetail(ym));

export const downloadMonthlyRetailReport = async (ym) => {
  const res = await exportMonthlyExcel(ym);
  if ((res.status && res.status !== 'ok') || (res.code && res.code !== 0)) {
    throw new Error(res.error || res.message || '零售日报生成失败');
  }
  await download(ReportCatalog.retailDaily.download(ym), res.file || ReportCatalog.retailDaily.fallbackName(ym));
  if (res.singleDayFile) {
    await download(res.singleDayDownloadUrl || ReportCatalog.retailDaily.singleDayDownload(ym), res.singleDayFile);
  }
  return res;
};

export const getSelfUseByRange = (dateFrom, dateTo) =>
  get(ApiPaths.retail.selfUseRange(dateFrom, dateTo));

export const downloadSelfUseReport = (dateFrom, dateTo) => {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  return download(ApiPaths.reports.selfUse(Object.fromEntries(params)), ReportCatalog.selfUse.fallbackName(dateFrom, dateTo));
};

export const getProfitMonthData = (ym, { refresh } = {}) =>
  get(ReportCatalog.profitMonth.data(ym, refresh ? { refresh: '1' } : undefined));

export const getProfitYearData = (year, { refresh } = {}) =>
  get(ReportCatalog.profitYear.data(year, refresh ? { refresh: '1' } : undefined));

export const downloadProfitReport = async (ym) => {
  const res = await get(ReportCatalog.profitMonth.generate(ym));
  if ((res.status && res.status !== 'ok') || (res.code && res.code !== 0)) {
    throw new Error(res.error || res.message || '利润核算月度文件生成失败');
  }
  await download(ReportCatalog.profitMonth.download(ym), res.file || ReportCatalog.profitMonth.fallbackName(ym));
  return res;
};

export const downloadProfitYearReport = async (year) => {
  const res = await get(ReportCatalog.profitYear.generate(year));
  if ((res.status && res.status !== 'ok') || (res.code && res.code !== 0)) {
    throw new Error(res.error || res.message || '年度利润核算总表生成失败');
  }
  await download(ReportCatalog.profitYear.download(year), res.file || ReportCatalog.profitYear.fallbackName(year));
  return res;
};

// ── 零售页面导航 ──
export const getRetailPages = () => get(ApiPaths.retail.pages);
