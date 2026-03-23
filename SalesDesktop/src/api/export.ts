import { message } from 'antd';
import { API_HOST, refreshAccessToken } from './http';
import { downloadWithAuth } from './download';

const BASE_URL = API_HOST;
const API_BASE = `${BASE_URL}/api`;

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

export async function exportExcel(yearMonth: string) {
  try {
    const json = await fetchJsonWithAuth(`${API_BASE}/export/monthly/${yearMonth}`);
    if (json.status === 'ok' || json.code === 0) {
      const filename = json.file || `零售日销表_${yearMonth}.xlsx`;
      await downloadBlob(`${API_BASE}/export/monthly/${yearMonth}/download`, filename);
      message.success('导出成功');
    } else {
      message.error(json.message || '导出失败');
    }
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
    const json = await fetchJsonWithAuth(`${API_BASE}/export/analysis/monthly/${yearMonth}`);
    if (json.status === 'ok' || json.code === 0) {
      if (json.docxDownloadUrl) {
        await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx');
      }
      if (json.htmlDownloadUrl) {
        await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html');
      }
      if (json.htmlViewUrl) {
        (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
      }
      message.success('分析报告已生成');
    } else {
      message.error(json.message || '生成分析报告失败');
    }
  } catch (err: any) {
    message.error('生成分析报告失败: ' + (err.message || ''));
  }
}

export async function downloadMonthlyReport(ym: string) {
  const json = await fetchJsonWithAuth(`${BASE_URL}/api/export/analysis/monthly/${ym}`);
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx');
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html');
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadYearlyReport(year: number) {
  const json = await fetchJsonWithAuth(`${BASE_URL}/api/export/analysis/yearly/${year}`);
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx');
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html');
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadWholesaleReport(params: { year: number; month?: number }) {
  const ym = params.month ? `${params.year}-${String(params.month).padStart(2, '0')}` : `${params.year}`;
  const json = await fetchJsonWithAuth(`${BASE_URL}/api/export/analysis/wholesale/monthly/${ym}`);
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
