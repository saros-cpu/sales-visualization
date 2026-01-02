import client from './client';

export type AutomationTaskKey = 'exchange_rates' | 'market_watch' | 'retail_snapshots' | 'retail_accounting_reports' | 'all';

export async function getSystemHealth() {
  const res = await client.get('/system/health');
  return res.data;
}

export async function getAccountingReportStatus(date?: string) {
  const res = await client.get('/system/accounting-reports/status', { params: date ? { date } : undefined });
  return res.data;
}

export async function generateAccountingReports(date?: string) {
  const res = await client.post('/system/accounting-reports/generate', date ? { date } : {});
  return res.data;
}

export async function runAutomationTask(task: AutomationTaskKey) {
  const res = await client.post('/system/automation-tasks/run', { task });
  return res.data;
}

export async function recordDevToolsOpen() {
  const res = await client.post('/system/devtools-open');
  return res.data;
}
