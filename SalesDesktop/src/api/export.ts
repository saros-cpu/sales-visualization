import { message } from 'antd';

const API_BASE = 'http://127.0.0.1:8900/api';

async function getToken() {
  return localStorage.getItem('accessToken') || '';
}

export async function exportExcel(yearMonth: string) {
  try {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/export/monthly/${yearMonth}`, { headers });
    const json = await res.json();
    if (json.status === 'ok' || json.code === 0) {
      const dlUrl = `${API_BASE}/export/monthly/${yearMonth}/download`;
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = json.file || `零售日销表_${yearMonth}.xlsx`;
      a.click();
      message.success('导出成功');
    } else {
      message.error(json.message || '导出失败');
    }
  } catch (err: any) {
    message.error('导出失败: ' + (err.message || ''));
  }
}

export async function exportAnalysis(yearMonth: string) {
  try {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/export/analysis/monthly/${yearMonth}`, { headers });
    const json = await res.json();
    if (json.status === 'ok' || json.code === 0) {
      const docx = json.docx || json.files?.docx;
      if (docx) {
        const a = document.createElement('a');
        a.href = `${API_BASE}/export/analysis/download/${docx}`;
        a.download = docx;
        a.click();
      }
      const html = json.html || json.files?.html;
      if (html) {
        window.open(`${API_BASE}/export/analysis/view/${html}`, '_blank');
      }
      message.success('分析报告已生成');
    } else {
      message.error(json.message || '生成分析报告失败');
    }
  } catch (err: any) {
    message.error('生成分析报告失败: ' + (err.message || ''));
  }
}