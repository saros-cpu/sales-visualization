import { message } from 'antd';
import { API_HOST, refreshAccessToken } from './http';
import { downloadWithAuth } from './download';

const BASE_URL = API_HOST;
const API_BASE = `${BASE_URL}/api`;

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
    const json = await fetchJsonWithAuth(`${API_BASE}/export/analysis/monthly/${encodeURIComponent(request.yearMonth)}`);
    ensureGenerated(json, '生成月度分析报告失败');
    const downloaded = await downloadAnalysisFiles(json, `月度分析报告_${request.yearMonth}`);
    const opened = absoluteUrl(json.htmlViewUrl);
    if (opened) (window as any).electronAPI?.openExternal(opened);
    return { kind: request.kind, response: json, downloaded, opened: opened || undefined };
  }

  if (request.kind === 'analysisYearly') {
    const json = await fetchJsonWithAuth(`${API_BASE}/export/analysis/yearly/${encodeURIComponent(String(request.year))}`);
    ensureGenerated(json, '生成年度分析报告失败');
    const downloaded = await downloadAnalysisFiles(json, `年度分析报告_${request.year}`);
    const opened = absoluteUrl(json.htmlViewUrl);
    if (opened) (window as any).electronAPI?.openExternal(opened);
    return { kind: request.kind, response: json, downloaded, opened: opened || undefined };
  }

  const json = await fetchJsonWithAuth(`${API_BASE}/export/monthly/${encodeURIComponent(request.yearMonth)}`);
  ensureGenerated(json, '生成零售日报失败');
  const filename = json.file || `零售日销表_${request.yearMonth}.xlsx`;
  const url = `${API_BASE}/export/monthly/${encodeURIComponent(request.yearMonth)}/download`;
  await downloadBlob(url, filename);
  return { kind: request.kind, response: json, downloaded: [{ url, filename }] };
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
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  if (refresh) params.set('refresh', '1');

  const json = await fetchJsonWithAuth(`${API_BASE}/export/retail/range?${params}`);
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '生成报表失败');
  }

  await downloadBlob(
    `${API_BASE}/export/retail/range/download?${new URLSearchParams({ date_from: dateFrom, date_to: dateTo })}`,
    json.file || `加油站零售周报表_${dateFrom}_至_${dateTo}.xlsx`,
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
    ? `${API_BASE}/export/analysis/wholesale/monthly/${params.year}-${String(params.month).padStart(2, '0')}`
    : `${API_BASE}/export/analysis/wholesale/yearly/${params.year}`;
  const json = await fetchJsonWithAuth(path);
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'wholesale-report.docx');
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'wholesale-report.html');
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadWholesaleDetails(yearMonth: string) {
  await downloadBlob(
    `${API_BASE}/export/wholesale/details/${yearMonth}`,
    `wholesale_details_${yearMonth}.xlsx`,
  );
}

export async function downloadSelfUseReport(dateFrom: string, dateTo: string) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  await downloadBlob(
    `${API_BASE}/export/self-use?${params}`,
    `自用油_${dateFrom}_至_${dateTo}.xlsx`,
  );
}
