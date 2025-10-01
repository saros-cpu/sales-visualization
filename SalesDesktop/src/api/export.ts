import { message } from 'antd';
import { API_HOST } from './http';

const BASE_URL = API_HOST;
const API_BASE = `${BASE_URL}/api`;

async function getToken() {
  return localStorage.getItem('accessToken') || '';
}

async function downloadBlob(url: string, filename: string, token?: string) {
  if ((window as any).electronAPI?.downloadFile) {
    const ok = await (window as any).electronAPI.downloadFile(url, filename, token || '');
    if (!ok) throw new Error('download cancelled');
    return;
  }
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 200);
}

export async function exportExcel(yearMonth: string) {
  try {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/export/monthly/${yearMonth}`, { headers });
    const json = await res.json();
    if (json.status === 'ok' || json.code === 0) {
      const filename = json.file || `零售日销表_${yearMonth}.xlsx`;
      await downloadBlob(`${API_BASE}/export/monthly/${yearMonth}/download`, filename, token);
      message.success('导出成功');
    } else {
      message.error(json.message || '导出失败');
    }
  } catch (err: any) {
    message.error('导出失败: ' + (err.message || ''));
  }
}

export async function downloadRetailRangeReport(dateFrom: string, dateTo: string, refresh = false) {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  if (refresh) params.set('refresh', '1');

  const res = await fetch(`${API_BASE}/export/retail/range?${params}`, { headers });
  const json = await res.json();
  if (!(json.status === 'ok' || json.code === 0)) {
    throw new Error(json.message || json.error || '生成报表失败');
  }

  await downloadBlob(
    `${API_BASE}/export/retail/range/download?${new URLSearchParams({ date_from: dateFrom, date_to: dateTo })}`,
    json.file || `加油站零售报表_${dateFrom}_至_${dateTo}.xlsx`,
    token,
  );
}

export async function exportAnalysis(yearMonth: string) {
  try {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/export/analysis/monthly/${yearMonth}`, { headers });
    const json = await res.json();
    if (json.status === 'ok' || json.code === 0) {
      if (json.docxDownloadUrl) {
        await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx', token);
      }
      if (json.htmlDownloadUrl) {
        await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html', token);
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
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/monthly/${ym}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadYearlyReport(year: number) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/yearly/${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadWholesaleReport(params: { year: number; month?: number }) {
  const ym = params.month ? `${params.year}-${String(params.month).padStart(2, '0')}` : `${params.year}`;
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/wholesale/monthly/${ym}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'wholesale-report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'wholesale-report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadWholesaleDetails(yearMonth: string) {
  const token = await getToken();
  await downloadBlob(
    `${API_BASE}/export/wholesale/details/${yearMonth}`,
    `wholesale_details_${yearMonth}.xlsx`,
    token,
  );
}

export async function downloadSelfUseReport(dateFrom: string, dateTo: string) {
  const token = await getToken();
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  await downloadBlob(
    `${API_BASE}/export/self-use?${params}`,
    `self_use_${dateFrom}_to_${dateTo}.xlsx`,
    token,
  );
}
