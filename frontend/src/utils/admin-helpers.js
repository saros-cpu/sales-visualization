// src/utils/admin-helpers.js — 管理后台辅助函数
export function fmtDate(value) {
  if (!value) return '--';
  return String(value).replace('T', ' ').slice(0, 16);
}

export function shortText(value, max = 34) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function entityTypeLabel(value) {
  return { retail_station: '加油站', own_depot: '自营油库', wholesale_customer: '批发客户', unknown: '其他' }[value] || value || '--';
}

export function taskLabel(value) {
  return {
    exchange_rates: '自动补充汇率',
    market_watch: '自动补充市场观察',
    retail_snapshots: '自动补充零售快照',
    retail_accounting_reports: '自动生成吉方日报',
    all: '全部任务',
  }[value] || value || '--';
}

export function taskStatusLabel(value) {
  return { success: '成功', failed: '失败', running: '运行中' }[value] || value || '--';
}

export function healthSize(bytes) {
  const v = Number(bytes || 0);
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

export function summarizeTask(item) {
  if (item.taskName === 'exchange_rates') return `${item.added || 0} 条新增`;
  if (item.taskName === 'market_watch') return `${item.fetched || 0} 条抓取`;
  if (item.taskName === 'retail_snapshots') return item.message || '快照已刷新';
  return item.message || '--';
}

export const ADMIN_TABS = [
  { key: 'overview', label: '首页', sub: 'Dashboard' },
  { key: 'automation', label: '自动任务', sub: 'Automation' },
  { key: 'market', label: '市场观察', sub: 'Market' },
  { key: 'retail', label: '零售维护', sub: 'Retail' },
  { key: 'wholesale-contract', label: '批发合同', sub: 'Wholesale' },
  { key: 'finance', label: '财务维护', sub: 'Finance' },
  { key: 'reference', label: '基础资料', sub: 'Dict' },
  { key: 'health', label: '系统健康', sub: 'Health' },
  { key: 'system', label: '系统管理', sub: 'System' },
];
