import { message } from 'antd';
import { API_HOST, refreshAccessToken } from './http';
import { downloadWithAuth } from './download';
import { ApiPaths, ReportCatalog } from '@shared/api-contracts';

const BASE_URL = API_HOST;

type ReportKind = 'analysisMonthly' | 'analysisYearly' | 'retailDaily';

type ReportRequest =
  | { kind: 'analysisMonthly'; yearMonth: string }
  | { kind: 'analysisYearly'; year: number }
  | { kind: 'retailDaily'; yearMonth: string };

type GeneratedReportResult = {
  kind: ReportKind;
  response: any;
  downloaded: Array<{ url: string; filename: string }>;
  opened?: string;
};

async function getToken() {
  return await refreshAccessToken() || localStorage.getItem('accessToken') || '';
}

async function fetchWithAuth(url: string, init: RequestInit = {}) {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken) {
      headers.set('Authorization', `Bearer ${retryToken}`);
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

async function fetchJsonWithAuth(url: string, init: RequestInit = {}) {
  const res = await fetchWithAuth(url, init);
  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function downloadBlob(url: string, filename: string) {
  await downloadWithAuth(url, filename);
}

function absoluteUrl(path?: string) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function ensureGenerated(json: any, fallbackMessage: string) {
  if (json?.status === 'ok' || json?.code === 0 || json?.ok === true) return;
  throw new Error(json?.message || json?.error || fallbackMessage);
}

async function downloadAnalysisFiles(json: any, fallbackBaseName: string) {
  const downloaded: GeneratedReportResult['downloaded'] = [];
  if (json.docxDownloadUrl) {
    const url = absoluteUrl(json.docxDownloadUrl);
    const filename = json.docxFile || `${fallbackBaseName}.docx`;
    await downloadBlob(url, filename);
    downloaded.push({ url, filename });
  }
  if (json.htmlDownloadUrl) {
    const url = absoluteUrl(json.htmlDownloadUrl);
    const filename = json.htmlFile || `${fallbackBaseName}.html`;
    await downloadBlob(url, filename);
    downloaded.push({ url, filename });
  }
  return downloaded;
}

export async function generateAndDownloadReport(request: ReportRequest): Promise<GeneratedReportResult> {
  if (request.kind === 'analysisMonthly') {
    const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.analysisMonthly.generate(request.yearMonth)));
    ensureGenerated(json, '生成月度分析报告失败');
    const downloaded = await downloadAnalysisFiles(json, String(ReportCatalog.analysisMonthly.fallbackName(request.yearMonth)).replace(/\.docx$/i, ''));
    const opened = absoluteUrl(json.htmlViewUrl);
    if (opened) (window as any).electronAPI?.openExternal(opened);
    return { kind: request.kind, response: json, downloaded, opened: opened || undefined };
  }

  if (request.kind === 'analysisYearly') {
    const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.analysisYearly.generate(request.year)));
    ensureGenerated(json, '生成年度分析报告失败');
    const downloaded = await downloadAnalysisFiles(json, String(ReportCatalog.analysisYearly.fallbackName(request.year)).replace(/\.docx$/i, ''));
    const opened = absoluteUrl(json.htmlViewUrl);
    if (opened) (window as any).electronAPI?.openExternal(opened);
    return { kind: request.kind, response: json, downloaded, opened: opened || undefined };
  }

  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.retailDaily.generate(request.yearMonth)));
  ensureGenerated(json, '生成零售日报失败');
  const downloaded: GeneratedReportResult['downloaded'] = [];
  const filename = json.file || ReportCatalog.retailDaily.fallbackName(request.yearMonth);
  const url = absoluteUrl(ReportCatalog.retailDaily.download(request.yearMonth));
  await downloadBlob(url, filename);
  downloaded.push({ url, filename });
  if (json.singleDayFile) {
    const singleDayUrl = absoluteUrl(json.singleDayDownloadUrl || ReportCatalog.retailDaily.singleDayDownload(request.yearMonth));
    await downloadBlob(singleDayUrl, json.singleDayFile);
    downloaded.push({ url: singleDayUrl, filename: json.singleDayFile });
  }
  return { kind: request.kind, response: json, downloaded };
}

export async function exportExcel(yearMonth: string) {
  try {
    await generateAndDownloadReport({ kind: 'retailDaily', yearMonth });
    message.success('导出成功');
  } catch (err: any) {
    message.error('导出失败: ' + (err.message || ''));
  }
}

export async function downloadRetailRangeReport(dateFrom: string, dateTo: string, refresh = false) {
  const params = { date_from: dateFrom, date_to: dateTo, refresh: refresh ? 1 : undefined };

  const json = await fetchJsonWithAuth(absoluteUrl(ApiPaths.reports.retailRange(params)));
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '生成报表失败');
  }

  await downloadBlob(
    absoluteUrl(ApiPaths.reports.retailRangeDownload({ date_from: dateFrom, date_to: dateTo })),
    json.file || `加油站零售周报表_${dateFrom}_至_${dateTo}.xlsx`,
  );
}

export async function downloadDailyBriefingReport(reportDate: string, refresh = false) {
  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.dailyBriefing.generate(reportDate, { refresh: refresh ? 1 : undefined })));
  ensureGenerated(json, '生成每日汇报表失败');
  await downloadBlob(
    absoluteUrl(ReportCatalog.dailyBriefing.download(reportDate)),
    json.file || ReportCatalog.dailyBriefing.fallbackName(reportDate),
  );
}

export async function exportAnalysis(yearMonth: string) {
  try {
    await generateAndDownloadReport({ kind: 'analysisMonthly', yearMonth });
    message.success('分析报告已生成');
  } catch (err: any) {
    message.error('生成分析报告失败: ' + (err.message || ''));
  }
}

export async function downloadMonthlyReport(ym: string) {
  await generateAndDownloadReport({ kind: 'analysisMonthly', yearMonth: ym });
}

export async function downloadYearlyReport(year: number) {
  await generateAndDownloadReport({ kind: 'analysisYearly', year });
}

export async function downloadWholesaleReport(params: { year: number; month?: number }) {
  const path = params.month
    ? ApiPaths.reports.wholesaleAnalysisMonthly(`${params.year}-${String(params.month).padStart(2, '0')}`)
    : ApiPaths.reports.wholesaleAnalysisYearly(params.year);
  const json = await fetchJsonWithAuth(absoluteUrl(path));
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'wholesale-report.docx');
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'wholesale-report.html');
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadWholesaleDetails(yearMonth: string) {
  await downloadBlob(
    absoluteUrl(ApiPaths.reports.wholesaleDetails(yearMonth)),
    `明细表_${yearMonth}.xlsx`,
  );
}

export async function downloadSelfUseReport(dateFrom: string, dateTo: string) {
  await downloadBlob(
    absoluteUrl(ReportCatalog.selfUse.generate({ date_from: dateFrom, date_to: dateTo })),
    ReportCatalog.selfUse.fallbackName(dateFrom, dateTo),
  );
}

export async function downloadProfitReport(yearMonth: string) {
  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.profitMonth.generate(yearMonth)));
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '生成利润核算报表失败');
  }
  await downloadBlob(
    absoluteUrl(ReportCatalog.profitMonth.download(yearMonth)),
    json.file || ReportCatalog.profitMonth.fallbackName(yearMonth),
  );
}

export async function downloadProfitYearReport(year: number) {
  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.profitYear.generate(year)));
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '生成年度利润核算报表失败');
  }
  await downloadBlob(
    absoluteUrl(ReportCatalog.profitYear.download(year)),
    json.file || ReportCatalog.profitYear.fallbackName(year),
  );
}

export interface ProfitProductRow {
  shopKey: number;
  resourceKey: number;
  product: string;
  volume: number;
  tons: number;
  salesPrice: number | null;
  salesAmount: number;
  purchaseProduct: string;
  purchasePrice: number;
  purchaseAmount: number;
}

export interface ProfitStationSummary {
  shopKey: number;
  name: string;
  volume: number;
  salesAmount: number;
  dieselVolume: number;
  dieselTons: number;
  dieselSalesAmount: number;
  purchaseAmount: number;
  salary: number;
  salaryBase: number;
  freight: number;
  water: number;
  waterBase: number;
  police: number;
  policeBase: number;
  netFee: number;
  netFeeBase: number;
  otherFees: number;
  income: number;
  purchaseCost: number;
  vat: number;
  businessTax: number;
  grossProfit: number;
  netProfit: number;
  tons: number;
  operatingDays: number;
  periodDays: number;
  operatingRatio: number;
  firstOperatingDay?: string | null;
  costProrationReason?: 'full_month' | 'new_station' | 'no_operation' | string;
  rows: ProfitProductRow[];
}

export interface ProfitSummary {
  volume?: number;
  salesAmount?: number;
  dieselVolume?: number;
  dieselTons?: number;
  dieselSalesAmount?: number;
  purchaseAmount?: number;
  salary?: number;
  freight?: number;
  otherFees?: number;
  income?: number;
  purchaseCost?: number;
  vat?: number;
  businessTax?: number;
  grossProfit?: number;
  netProfit?: number;
  tons?: number;
  avgCnyKgs?: number | null;
  netProfitCny?: number | null;
  hasActivity?: boolean;
}

export interface ProfitComparisonItem {
  period?: string;
  prevMonth?: string;
  yoyMonth?: string;
  prevPeriod?: string;
  yoyPeriod?: string;
  summary?: ProfitSummary | null;
  source?: string | null;
}

export interface ProfitComparison {
  mom?: ProfitComparisonItem | null;
  yoy?: ProfitComparisonItem | null;
}

export interface ProfitMonthData {
  year: number;
  month: number;
  yearMonth: string;
  queryStart: string;
  queryEnd: string;
  periodDays: number;
  summary: ProfitSummary;
  stations: ProfitStationSummary[];
  comparison?: ProfitComparison;
  snapshotGeneratedAt?: string | null;
  snapshotCached?: boolean;
}

export interface ProfitYearMonthRow extends ProfitSummary {
  month: number;
  monthName: string;
  active: boolean;
}

export interface ProfitYearData {
  year: number;
  includedMonths: number;
  months: ProfitYearMonthRow[];
  summary: ProfitSummary;
  comparison?: ProfitComparison;
  snapshotGeneratedAt?: string | null;
  snapshotCached?: boolean;
}

export async function getProfitMonthData(yearMonth: string, refresh = false) {
  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.profitMonth.data(yearMonth, { refresh: refresh ? 1 : undefined })));
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '读取利润核算数据失败');
  }
  return json.data as ProfitMonthData;
}

export async function getProfitYearData(year: number, refresh = false) {
  const json = await fetchJsonWithAuth(absoluteUrl(ReportCatalog.profitYear.data(year, { refresh: refresh ? 1 : undefined })));
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '读取年度利润核算数据失败');
  }
  return json.data as ProfitYearData;
}
