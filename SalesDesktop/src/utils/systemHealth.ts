export const SYSTEM_HEALTH_TABS = new Set([
  'actions',
  'services',
  'api',
  'cache',
  'governance',
  'accounting',
  'automation',
  'ai',
]);

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

export function textList(value: unknown): string[] {
  return asArray(value).map((item: any) => {
    if (item == null) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'number' || typeof item === 'boolean') return String(item);
    if (typeof item === 'object') {
      return String(item.message || item.error || item.reason || JSON.stringify(item));
    }
    return String(item);
  }).filter(Boolean);
}

export function systemHealthTabRoute(tab: string) {
  return tab === 'actions' ? '/system-health' : `/system-health?tab=${tab}`;
}

export function resolveSystemHealthTab(search: string) {
  const tab = new URLSearchParams(search).get('tab') || 'actions';
  return SYSTEM_HEALTH_TABS.has(tab) ? tab : 'actions';
}

export function actionItemRoute(item: any) {
  const signal = [
    item?.category,
    item?.code,
    item?.title,
    item?.detail,
    item?.action,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/exchange|汇率|курс/.test(signal)) return '/exchange';
  if (/api|接口|audit|审计/.test(signal)) return systemHealthTabRoute('api');
  if (/cache|缓存|快照/.test(signal)) return systemHealthTabRoute('cache');
  if (/automation|自动任务|task/.test(signal)) return systemHealthTabRoute('automation');
  if (/accounting|吉方|交接日报/.test(signal)) return systemHealthTabRoute('accounting');
  if (/knowledge|知识|знан|индекс|update|updater|更新/.test(signal)) return systemHealthTabRoute('governance');
  if (/retail.*alert|零售.*异常|anomaly|异常/.test(signal)) return '/retail/alert';
  if (/report|日报|报表|254/.test(signal)) return '/reports';
  return '';
}
