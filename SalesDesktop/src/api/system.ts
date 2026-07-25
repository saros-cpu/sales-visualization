import { ApiPaths } from '@shared/api-contracts';
import client from './client';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '');

export type AutomationTaskKey =
  | 'exchange_rates'
  | 'market_watch'
  | 'retail_snapshots'
  | 'retail_accounting_reports'
  | 'retail_254_monthly_archive'
  | 'all';

export async function getSystemHealth() {
  const res = await client.get(v2(ApiPaths.system.health));
  return res.data;
}

export async function getAutomationTasks() {
  const res = await client.get(v2(ApiPaths.system.automationTasks));
  return res.data;
}

export async function getAccountingReportStatus(date?: string) {
  const res = await client.get(v2(ApiPaths.system.accountingReportStatus(date)));
  return res.data;
}

export async function generateAccountingReports(date?: string) {
  const res = await client.post(v2(ApiPaths.system.generateAccountingReports), date ? { date } : {});
  return res.data;
}

export async function runAutomationTask(task: AutomationTaskKey, options?: { month?: string }) {
  const res = await client.post(v2(ApiPaths.system.runAutomationTask), { task, ...options });
  return res.data;
}

export async function recordDevToolsOpen() {
  const res = await client.post(v2(ApiPaths.system.devtoolsOpen));
  return res.data;
}
