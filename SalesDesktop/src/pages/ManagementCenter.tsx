import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getManagementOverview,
  saveCockpitTemplate,
  saveDictionaryItem,
  updateSystemConfig,
  type CockpitComponent,
  type CockpitTemplate,
  type ComponentDefinition,
  type DepartmentOption,
  type DictionaryItem,
  type KpiDefinition,
  type SystemConfigItem,
} from '@/api/management';
import { getOrganizationOverview, type DepartmentRecord, type RoleRecord } from '@/api/organization';
import { useApiQuery } from '@/hooks/useApi';

const { Text } = Typography;

type RoleOptionSource = Pick<RoleRecord, 'roleCode' | 'roleName' | 'isActive'>;

type LocalTitleSource = {
  titleZh?: string;
  titleRu?: string;
  title_zh?: string;
  title_ru?: string;
  labelZh?: string;
  labelRu?: string;
  label_zh?: string;
  label_ru?: string;
  name?: string;
  key?: string;
};

const componentTypeLabels = {
  zh: {
    kpi: 'KPI 指标卡',
    trend: '趋势图',
    ranking: '排行图',
    structure: '结构图',
    exchange: '汇率卡片',
    market_watch: '市场观察',
    retail_alert: '零售预警',
  },
  ru: {
    kpi: 'KPI карточка',
    trend: 'График тренда',
    ranking: 'Рейтинг',
    structure: 'Структура',
    exchange: 'Курсы валют',
    market_watch: 'Обзор рынка',
    retail_alert: 'Оповещения розницы',
  },
} as const;

const componentGroupLabels = {
  zh: {
    retail: '零售数据',
    wholesale: '批发数据',
    procurement: '原料采购',
    contracts: '合同管理',
    materials: '物资调拨',
    entry: '数据录入',
    exchange: '汇率与市场',
    system: '系统健康',
  },
  ru: {
    retail: 'Розница',
    wholesale: 'Опт',
    procurement: 'Закупки сырья',
    contracts: 'Договоры',
    materials: 'Перемещения',
    entry: 'Ввод данных',
    exchange: 'Курсы и рынок',
    system: 'Система',
  },
} as const;

const periodLabels = {
  zh: { year: '年数据', month: '月数据', latest: '最新' },
  ru: { year: 'год', month: 'месяц', latest: 'актуально' },
} as const;

const departmentFallbacks = {
  management: { zh: '综合管理部', ru: 'Отдел общего управления' },
  sales: { zh: 'ProductTeam', ru: 'Отдел маркетинга и продаж' },
  procurement: { zh: '原料采购部', ru: 'Отдел закупки сырья' },
  loading: { zh: '物流管理部', ru: 'Отдел управления логистикой' },
  finance: { zh: '财务资产部', ru: 'Отдел финансов и активов' },
} as const;

const roleFallbacks = {
  admin: { zh: '系统管理员', ru: 'Администратор' },
  leadership: { zh: '领导层', ru: 'Руководство' },
  operator: { zh: '业务操作员', ru: 'Оператор' },
  auditor: { zh: '审计员', ru: 'Аудитор' },
  viewer: { zh: '查看员', ru: 'Наблюдатель' },
  sales_manager: { zh: '销售主管', ru: 'Руководитель продаж' },
  sales_staff: { zh: '销售专员', ru: 'Специалист по продажам' },
  procurement_staff: { zh: '采购专员', ru: 'Специалист по закупкам' },
  loading_staff: { zh: '物流管理专员', ru: 'Специалист по логистике' },
  finance_staff: { zh: '财务资产专员', ru: 'Специалист по финансам и активам' },
} as const;

const fallbackChartComponents: ComponentDefinition[] = [
  { key: 'chart.retail_year_monthly_trend', type: 'trend', dataKey: 'retail_year_monthly_trend', titleZh: '零售年度月趋势', titleRu: 'Месячный тренд розницы за год', group: 'retail', periodScope: 'year', defaultSpan: 24 },
  { key: 'chart.retail_month_daily_trend', type: 'trend', dataKey: 'retail_month_daily_trend', titleZh: '零售月度日趋势', titleRu: 'Дневной тренд розницы за месяц', group: 'retail', periodScope: 'month', defaultSpan: 24 },
  { key: 'rank.retail_year_region_sales', type: 'ranking', dataKey: 'retail_year_region_sales', titleZh: '零售区域销售排行', titleRu: 'Рейтинг регионов розницы', group: 'retail', periodScope: 'year', defaultSpan: 12 },
  { key: 'rank.retail_year_product_sales', type: 'ranking', dataKey: 'retail_year_product_sales', titleZh: '零售油品销售排行', titleRu: 'Рейтинг продуктов розницы', group: 'retail', periodScope: 'year', defaultSpan: 12 },
  { key: 'rank.retail_year_station_sales', type: 'ranking', dataKey: 'retail_year_station_sales', titleZh: '零售站点销售排行', titleRu: 'Рейтинг АЗС по продажам', group: 'retail', periodScope: 'year', defaultSpan: 12 },
  { key: 'chart.wholesale_month_daily_trend', type: 'trend', dataKey: 'wholesale_month_daily_trend', titleZh: '批发月度日趋势', titleRu: 'Дневной тренд опта за месяц', group: 'wholesale', periodScope: 'month', defaultSpan: 24 },
  { key: 'rank.wholesale_month_export_customers', type: 'ranking', dataKey: 'wholesale_month_export_customers', titleZh: '出口客户排行', titleRu: 'Рейтинг экспортных клиентов', group: 'wholesale', periodScope: 'month', defaultSpan: 12 },
  { key: 'rank.wholesale_month_local_customers', type: 'ranking', dataKey: 'wholesale_month_local_customers', titleZh: '本地客户排行', titleRu: 'Рейтинг локальных клиентов', group: 'wholesale', periodScope: 'month', defaultSpan: 12 },
  { key: 'rank.wholesale_month_export_products', type: 'ranking', dataKey: 'wholesale_month_export_products', titleZh: '出口油品排行', titleRu: 'Рейтинг экспортных продуктов', group: 'wholesale', periodScope: 'month', defaultSpan: 12 },
  { key: 'rank.wholesale_month_transfer_products', type: 'ranking', dataKey: 'wholesale_month_transfer_products', titleZh: '调拨油品排行', titleRu: 'Рейтинг продуктов перемещения', group: 'wholesale', periodScope: 'month', defaultSpan: 12 },
  { key: 'chart.wholesale_month_category_mix', type: 'structure', dataKey: 'wholesale_month_category_mix', titleZh: '批发分类结构', titleRu: 'Структура опта', group: 'wholesale', periodScope: 'month', defaultSpan: 12 },
  { key: 'card.exchange_current', type: 'exchange', dataKey: 'exchange_current', titleZh: '最新汇率', titleRu: 'Последние курсы', group: 'exchange', periodScope: 'latest', defaultSpan: 12 },
  { key: 'list.market_watch', type: 'market_watch', dataKey: 'market_watch', titleZh: '市场观察', titleRu: 'Обзор рынка', group: 'exchange', periodScope: 'latest', defaultSpan: 16 },
  { key: 'panel.retail_alert', type: 'retail_alert', dataKey: 'retail_alert', titleZh: '零售预警摘要', titleRu: 'Сводка предупреждений розницы', group: 'retail', periodScope: 'latest', defaultSpan: 24 },
];

const exchangeRateMetricKeys = new Set(['exchange_usd_kgs', 'exchange_cny_kgs', 'exchange_kgs_cny']);
const exchangeRateComponentKeys = new Set(Array.from(exchangeRateMetricKeys, key => `kpi.${key}`));
const exchangeRateComponentIdKeys = new Set(Array.from(exchangeRateComponentKeys, key => componentIdKey(key)));

const fallbackDepartments: DepartmentOption[] = Object.entries(departmentFallbacks).map(([deptCode, names]) => ({
  deptCode,
  deptName: names.zh,
  deptNameRu: names.ru,
  isActive: true,
}));

const fallbackKpiDefinitions: KpiDefinition[] = [
  { key: 'retail_sales_amount', titleZh: '零售年销售额', titleRu: 'Годовая выручка розницы', unit: 'сом', precision: 0, group: 'retail', periodScope: 'year', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_volume_liters', titleZh: '零售年销量', titleRu: 'Годовой объем розницы', unit: 'L', precision: 0, group: 'retail', periodScope: 'year', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_active_shops', titleZh: '零售年活跃站点', titleRu: 'Активные АЗС за год', unit: '站', precision: 0, group: 'retail', periodScope: 'year', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_inventory', titleZh: '零售库存', titleRu: 'Остатки розницы', unit: 'L', precision: 0, group: 'retail', periodScope: 'year', goodWhen: 'neutral', permissionCode: 'retail:view' },
  { key: 'retail_month_sales_amount', titleZh: '零售月销售额', titleRu: 'Месячная выручка розницы', unit: 'сом', precision: 0, group: 'retail', periodScope: 'month', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_month_volume_liters', titleZh: '零售月销量', titleRu: 'Месячный объем розницы', unit: 'L', precision: 0, group: 'retail', periodScope: 'month', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_month_active_shops', titleZh: '零售月活跃站点', titleRu: 'Активные АЗС за месяц', unit: '站', precision: 0, group: 'retail', periodScope: 'month', goodWhen: 'up', permissionCode: 'retail:view' },
  { key: 'retail_trend_anomalies', titleZh: '零售趋势异常', titleRu: 'Аномалии тренда розницы', unit: '条', precision: 0, group: 'retail', periodScope: 'latest', goodWhen: 'down', permissionCode: 'retail:view' },
  { key: 'retail_ai_suggestions', titleZh: '零售运营建议', titleRu: 'Рекомендации по рознице', unit: '条', precision: 0, group: 'retail', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'retail:view' },
  { key: 'yearly_wholesale_tons', titleZh: '年批发吨数', titleRu: 'Опт за год', unit: 't', precision: 1, group: 'wholesale', periodScope: 'year', goodWhen: 'up', permissionCode: 'wholesale:view' },
  { key: 'yearly_procurement_tons', titleZh: '年采购吨数', titleRu: 'Закупки за год', unit: 't', precision: 1, group: 'procurement', periodScope: 'year', goodWhen: 'up', permissionCode: 'procurement:view' },
  { key: 'wholesale_month_export_tons', titleZh: '出口批发月吨数', titleRu: 'Экспортный опт за месяц', unit: 't', precision: 1, group: 'wholesale', periodScope: 'month', goodWhen: 'up', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_local_tons', titleZh: '本地批发月吨数', titleRu: 'Локальный опт за месяц', unit: 't', precision: 1, group: 'wholesale', periodScope: 'month', goodWhen: 'up', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_transfer_tons', titleZh: '物资调拨月吨数', titleRu: 'Перемещения за месяц', unit: 't', precision: 1, group: 'wholesale', periodScope: 'month', goodWhen: 'neutral', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_procurement_tons', titleZh: '原料采购月吨数', titleRu: 'Закупки сырья за месяц', unit: 't', precision: 1, group: 'procurement', periodScope: 'month', goodWhen: 'up', permissionCode: 'procurement:view' },
  { key: 'wholesale_month_processing_tons', titleZh: '代加工月吨数', titleRu: 'Переработка за месяц', unit: 't', precision: 1, group: 'wholesale', periodScope: 'month', goodWhen: 'neutral', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_unknown_tons', titleZh: '待识别月吨数', titleRu: 'Неопределено за месяц', unit: 't', precision: 1, group: 'wholesale', periodScope: 'month', goodWhen: 'down', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_export_amount_cny', titleZh: '出口批发月金额', titleRu: 'Сумма экспортного опта за месяц', unit: '¥', precision: 0, group: 'wholesale', periodScope: 'month', goodWhen: 'up', permissionCode: 'wholesale:view' },
  { key: 'wholesale_month_local_amount_cny', titleZh: '本地批发月金额', titleRu: 'Сумма локального опта за месяц', unit: '¥', precision: 0, group: 'wholesale', periodScope: 'month', goodWhen: 'up', permissionCode: 'wholesale:view' },
  { key: 'contract_active', titleZh: '有效合同', titleRu: 'Активные договоры', unit: '份', precision: 0, group: 'contracts', periodScope: 'latest', goodWhen: 'up', permissionCode: 'contracts:view' },
  { key: 'contract_total', titleZh: '合同总数', titleRu: 'Всего договоров', unit: '份', precision: 0, group: 'contracts', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'contracts:view' },
  { key: 'contract_appendix_missing', titleZh: '附件编号缺失', titleRu: 'Нет номера приложения', unit: '份', precision: 0, group: 'contracts', periodScope: 'latest', goodWhen: 'down', permissionCode: 'contracts:view' },
  { key: 'contract_expiring_30d', titleZh: '30天内到期合同', titleRu: 'Истекают за 30 дней', unit: '份', precision: 0, group: 'contracts', periodScope: 'latest', goodWhen: 'down', permissionCode: 'contracts:view' },
  { key: 'train_entry_today_rows', titleZh: '今日录入行数', titleRu: 'Строк ввода сегодня', unit: '条', precision: 0, group: 'entry', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'train_entry:view' },
  { key: 'material_transfer_today', titleZh: '今日调拨单', titleRu: 'Перемещений сегодня', unit: '单', precision: 0, group: 'materials', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'materials:view' },
  { key: 'material_transfer_pending', titleZh: '待处理调拨', titleRu: 'Перемещения в ожидании', unit: '单', precision: 0, group: 'materials', periodScope: 'latest', goodWhen: 'down', permissionCode: 'materials:view' },
  { key: 'exchange_usd_kgs', titleZh: '美元/索姆', titleRu: 'USD/KGS', unit: '', precision: 4, group: 'exchange', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'exchange:view' },
  { key: 'exchange_cny_kgs', titleZh: '人民币/索姆', titleRu: 'CNY/KGS', unit: '', precision: 4, group: 'exchange', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'exchange:view' },
  { key: 'exchange_kgs_cny', titleZh: '索姆/人民币', titleRu: 'KGS/CNY', unit: '', precision: 6, group: 'exchange', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'exchange:view' },
  { key: 'market_watch_items', titleZh: '市场观察条目', titleRu: 'Обзоры рынка', unit: '条', precision: 0, group: 'exchange', periodScope: 'latest', goodWhen: 'neutral', permissionCode: 'exchange:view' },
  { key: 'api_failed_24h', titleZh: '24小时接口失败', titleRu: 'CTY-05ибки API за 24ч', unit: '次', precision: 0, group: 'system', periodScope: 'latest', goodWhen: 'down', adminOnly: true, permissionCode: 'system_health:view' },
  { key: 'ai_failed_7d', titleZh: '7天 AI 失败', titleRu: 'CTY-05ибки AI за 7 дней', unit: '次', precision: 0, group: 'system', periodScope: 'latest', goodWhen: 'down', adminOnly: true, permissionCode: 'system_health:view' },
  { key: 'automation_failed', titleZh: '失败自动任务', titleRu: 'Сбой автозадач', unit: '项', precision: 0, group: 'system', periodScope: 'latest', goodWhen: 'down', adminOnly: true, permissionCode: 'system_health:view' },
  { key: 'cache_missing', titleZh: '缓存异常项', titleRu: 'Проблемы кэша', unit: '项', precision: 0, group: 'system', periodScope: 'latest', goodWhen: 'down', adminOnly: true, permissionCode: 'system_health:view' },
];

function localTitle(item: LocalTitleSource, language: string) {
  if (language.startsWith('ru')) {
    return item.titleRu || item.title_ru || item.labelRu || item.label_ru || item.titleZh || item.title_zh || item.labelZh || item.label_zh || item.name || item.key || '-';
  }
  return item.titleZh || item.title_zh || item.labelZh || item.label_zh || item.titleRu || item.title_ru || item.labelRu || item.label_ru || item.name || item.key || '-';
}

function componentOptionLabel(item: ComponentDefinition, language: string) {
  const lang = language.startsWith('ru') ? 'ru' : 'zh';
  const type = componentTypeLabels[lang][item.type] || item.type;
  const group = componentGroupLabels[lang][item.group as keyof typeof componentGroupLabels.zh] || item.group;
  const period = item.periodScope ? periodLabels[lang][item.periodScope] || item.periodScope : '';
  return [localTitle(item, language), type, group, period].filter(Boolean).join(' / ');
}

function kpiComponent(metric: KpiDefinition): ComponentDefinition {
  return {
    key: `kpi.${metric.key}`,
    type: 'kpi',
    metricKey: metric.key,
    titleZh: metric.titleZh,
    titleRu: metric.titleRu,
    group: metric.group,
    periodScope: metric.periodScope || 'latest',
    defaultSpan: 6,
    adminOnly: metric.adminOnly,
    permissionCode: metric.permissionCode,
  };
}

function mergeKpiCatalog(catalog: KpiDefinition[]) {
  const merged = new Map<string, KpiDefinition>();
  for (const metric of catalog) {
    if (!exchangeRateMetricKeys.has(metric.key)) merged.set(metric.key, metric);
  }
  for (const metric of fallbackKpiDefinitions) {
    if (!exchangeRateMetricKeys.has(metric.key)) merged.set(metric.key, metric);
  }
  return Array.from(merged.values());
}

function mergeComponentCatalog(componentCatalog: ComponentDefinition[], catalog: KpiDefinition[]) {
  const merged = new Map<string, ComponentDefinition>();
  for (const item of componentCatalog) {
    if (!exchangeRateComponentKeys.has(item.key)) merged.set(item.key, item);
  }
  for (const metric of mergeKpiCatalog(catalog)) {
    const key = `kpi.${metric.key}`;
    merged.set(key, kpiComponent(metric));
  }
  for (const item of fallbackChartComponents) {
    if (!merged.has(item.key)) merged.set(item.key, item);
  }
  return Array.from(merged.values());
}

function roleLabel(role: RoleOptionSource, language: string) {
  const fallback = roleFallbacks[role.roleCode as keyof typeof roleFallbacks];
  if (language.startsWith('ru')) return fallback?.ru || role.roleName || role.roleCode;
  return role.roleName || fallback?.zh || role.roleCode;
}

function buildRoleOptions(roles: RoleOptionSource[], language: string) {
  const merged = new Map<string, RoleOptionSource>();
  for (const [roleCode, names] of Object.entries(roleFallbacks)) {
    merged.set(roleCode, { roleCode, roleName: names.zh, isActive: true });
  }
  for (const role of roles) {
    if (role.isActive !== false) merged.set(role.roleCode, role);
  }
  return Array.from(merged.values()).map((role) => ({
    value: role.roleCode,
    label: roleLabel(role, language),
  }));
}

function departmentLabel(item: DepartmentOption, language: string) {
  const code = item.deptCode;
  const fallback = departmentFallbacks[code as keyof typeof departmentFallbacks];
  if (language.startsWith('ru')) return item.deptNameRu || item.deptName || fallback?.ru || code;
  return item.deptName || fallback?.zh || item.deptNameRu || code;
}

function mergeDepartments(departments: DepartmentOption[]) {
  const source = departments.length ? departments : fallbackDepartments;
  const merged = new Map<string, DepartmentOption>();
  for (const item of fallbackDepartments) merged.set(item.deptCode, item);
  for (const item of source) {
    if (item.deptCode) merged.set(item.deptCode, item);
  }
  return Array.from(merged.values());
}

function departmentRecordToOption(item: DepartmentRecord): DepartmentOption {
  return {
    deptCode: item.deptCode,
    deptName: item.deptName,
    deptNameRu: item.deptNameRu,
    isActive: item.isActive,
  };
}

const defaultComponentKeyByType: Partial<Record<CockpitComponent['type'], string>> = {
  trend: 'chart.retail_year_monthly_trend',
  ranking: 'rank.retail_year_region_sales',
  structure: 'chart.wholesale_month_category_mix',
  exchange: 'card.exchange_current',
  market_watch: 'list.market_watch',
  retail_alert: 'panel.retail_alert',
};

function componentIdKey(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function componentKeyFromId(component: CockpitComponent, definitions: ComponentDefinition[]) {
  const normalizedId = componentIdKey(component.id || '');
  if (!normalizedId) return undefined;
  const match = definitions.find((item) => {
    const key = componentIdKey(item.key);
    return normalizedId === key || normalizedId.startsWith(`${key}_`);
  });
  return match?.key;
}

function inferredComponentType(component: CockpitComponent) {
  const id = component.id || '';
  if (id.startsWith('trend_')) return 'trend';
  if (id.startsWith('ranking_')) return 'ranking';
  if (id.startsWith('structure_')) return 'structure';
  if (id.startsWith('exchange_')) return 'exchange';
  if (id.startsWith('market_watch_')) return 'market_watch';
  if (id.startsWith('retail_alert_')) return 'retail_alert';
  if (component.type) return component.type;
  return undefined;
}

function componentValue(component: CockpitComponent, definitions: ComponentDefinition[] = []) {
  if (component.metricKey && exchangeRateMetricKeys.has(component.metricKey)) return 'card.exchange_current';
  if (component.componentKey && exchangeRateComponentKeys.has(component.componentKey)) return 'card.exchange_current';
  const normalizedComponentId = componentIdKey(component.id || '');
  if (Array.from(exchangeRateComponentIdKeys).some(key => normalizedComponentId === key || normalizedComponentId.startsWith(`${key}_`))) return 'card.exchange_current';
  if (component.componentKey) return component.componentKey;
  const keyFromId = componentKeyFromId(component, definitions);
  if (keyFromId) return keyFromId;
  if (component.dataKey) {
    const match = definitions.find((item) => item.dataKey === component.dataKey);
    if (match) return match.key;
  }
  if (component.metricKey) return `kpi.${component.metricKey}`;
  const type = inferredComponentType(component);
  if (type) return defaultComponentKeyByType[type];
  return undefined;
}

const componentSpanMax = 24;
const componentHeightMax = 900;

const defaultComponentHeights: Record<CockpitComponent['type'], number> = {
  kpi: 118,
  trend: 360,
  ranking: 340,
  structure: 340,
  exchange: 160,
  market_watch: 280,
  retail_alert: 220,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric), min), max);
}

function componentMinSpan(type: CockpitComponent['type']) {
  return type === 'kpi' ? 1 : 4;
}

function componentMinHeight(type: CockpitComponent['type']) {
  if (type === 'kpi') return 20;
  if (type === 'exchange') return 72;
  if (type === 'market_watch' || type === 'retail_alert') return 96;
  return 100;
}

function componentType(component: Partial<CockpitComponent>, definition?: ComponentDefinition) {
  return (definition?.type || component.type || 'kpi') as CockpitComponent['type'];
}

function componentDefaultHeight(component: Partial<CockpitComponent>, definition?: ComponentDefinition) {
  const type = componentType(component, definition);
  return defaultComponentHeights[type] || defaultComponentHeights.kpi;
}

function normalizeComponentSpan(value: unknown, fallback = 6, type: CockpitComponent['type'] = 'kpi') {
  return boundedNumber(value, fallback, componentMinSpan(type), componentSpanMax);
}

function normalizeComponentHeight(value: unknown, component: Partial<CockpitComponent>, definition?: ComponentDefinition) {
  const type = componentType(component, definition);
  return boundedNumber(value, componentDefaultHeight(component, definition), componentMinHeight(type), componentHeightMax);
}

function CockpitConfigTab({
  templates,
  catalog,
  componentCatalog,
  departments,
  roles,
  onSaved,
}: {
  templates: CockpitTemplate[];
  catalog: KpiDefinition[];
  componentCatalog: ComponentDefinition[];
  departments: DepartmentOption[];
  roles: RoleOptionSource[];
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [draft, setDraft] = useState<CockpitTemplate | null>(null);
  const [componentToAdd, setComponentToAdd] = useState<string>();

  const kpiDefinitions = useMemo(() => mergeKpiCatalog(catalog), [catalog]);
  const componentDefinitions = useMemo(() => mergeComponentCatalog(componentCatalog, catalog), [componentCatalog, catalog]);
  const componentByKey = useMemo(() => new Map(componentDefinitions.map(item => [item.key, item])), [componentDefinitions]);
  const metricByKey = useMemo(() => new Map(kpiDefinitions.map(item => [item.key, item])), [kpiDefinitions]);
  const componentOptions = componentDefinitions.map(item => ({
    value: item.key,
    label: componentOptionLabel(item, i18n.language),
  }));
  const roleOptions = buildRoleOptions(roles, i18n.language);
  const departmentOptions = mergeDepartments(departments)
    .filter(item => item.isActive !== false)
    .map(item => ({
      value: item.deptCode,
      label: departmentLabel(item, i18n.language),
    }));

  useEffect(() => {
    const isLocalDraft = selectedKey && draft?.templateKey === selectedKey && !templates.some(item => item.templateKey === selectedKey);
    if (isLocalDraft) return;
    const next = templates.find(item => item.templateKey === selectedKey) || templates[0];
    setSelectedKey(next?.templateKey);
    setDraft(next ? JSON.parse(JSON.stringify(next)) : null);
  }, [templates, selectedKey, draft?.templateKey]);

  const components = draft?.config?.components || [];

  const updateComponent = (id: string, patch: Partial<CockpitComponent>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      config: {
        ...draft.config,
        components: components.map(item => item.id === id ? { ...item, ...patch } : item),
      },
    });
  };

  const patchForComponentKey = (componentKey: string): Partial<CockpitComponent> => {
    const definition = componentByKey.get(componentKey);
    if (!definition) return { componentKey };
    return {
      componentKey,
      type: definition.type,
      metricKey: definition.metricKey,
      dataKey: definition.dataKey,
      span: normalizeComponentSpan(definition.defaultSpan || 6, definition.defaultSpan || 6, definition.type),
      height: componentDefaultHeight({ type: definition.type }, definition),
    };
  };

  const addTemplate = () => {
    const timestamp = Date.now();
    const next: CockpitTemplate = {
      templateKey: `custom_${timestamp}`,
      titleZh: '自定义驾驶舱',
      titleRu: 'Пользовательская панель',
      roleScope: { roles: ['admin'] },
      config: { components: [] },
      isActive: true,
      sortOrder: 100,
    };
    setSelectedKey(next.templateKey);
    setDraft(next);
  };

  const addComponent = () => {
    if (!draft) return;
    const componentKey = componentToAdd || componentDefinitions[0]?.key;
    const patch = componentKey ? patchForComponentKey(componentKey) : {
      type: 'kpi' as const,
      metricKey: catalog[0]?.key,
      span: 6,
      height: defaultComponentHeights.kpi,
    };
    const item: CockpitComponent = {
      id: `${componentKey ? componentIdKey(componentKey) : patch.type || 'component'}_${Date.now()}`,
      type: patch.type || 'kpi',
      componentKey: patch.componentKey,
      metricKey: patch.metricKey,
      dataKey: patch.dataKey,
      span: normalizeComponentSpan(patch.span || 6, 6, patch.type || 'kpi'),
      height: normalizeComponentHeight(patch.height, patch),
      visible: true,
    };
    setDraft({ ...draft, config: { ...draft.config, components: [...components, item] } });
  };

  const removeComponent = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, config: { ...draft.config, components: components.filter(item => item.id !== id) } });
  };

  const save = async () => {
    if (!draft) return;
    const normalizedComponents = components.map((component) => {
      const key = componentValue(component, componentDefinitions);
      if (!key) return component;
      const patch = patchForComponentKey(key);
      return {
        ...component,
        ...patch,
        span: normalizeComponentSpan(component.span || patch.span, patch.span || 6, patch.type || component.type || 'kpi'),
        height: normalizeComponentHeight(component.height || patch.height, component, componentByKey.get(key)),
      };
    });
    await saveCockpitTemplate({
      ...draft,
      config: {
        ...draft.config,
        components: normalizedComponents,
      },
    });
    message.success(t('common.saved'));
    onSaved();
  };

  if (!draft) return <Text type="secondary">{t('cockpit.noTemplate')}</Text>;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Text type="secondary">{t('management.template')}</Text>
          <Select
            value={draft.templateKey}
            onChange={setSelectedKey}
            style={{ width: '100%', marginTop: 6 }}
            options={templates.map(item => ({ value: item.templateKey, label: localTitle(item, i18n.language) }))}
          />
        </Col>
        <Col xs={24} lg={8}>
          <Text type="secondary">{t('management.visibleRoles')}</Text>
          <Select
            mode="multiple"
            value={draft.roleScope?.roles || []}
            onChange={(roles) => setDraft({ ...draft, roleScope: { ...(draft.roleScope || {}), roles } })}
            options={roleOptions}
            style={{ width: '100%', marginTop: 6 }}
          />
        </Col>
        <Col xs={24} lg={5}>
          <Text type="secondary">{t('management.visibleDepartments')}</Text>
          <Select
            mode="multiple"
            value={draft.roleScope?.departments || []}
            onChange={(departments) => setDraft({ ...draft, roleScope: { ...(draft.roleScope || {}), departments } })}
            options={departmentOptions}
            style={{ width: '100%', marginTop: 6 }}
          />
        </Col>
        <Col xs={24} lg={3}>
          <Text type="secondary">{t('common.status')}</Text>
          <div style={{ marginTop: 8 }}>
            <Switch
              checked={draft.isActive !== false}
              onChange={(checked) => setDraft({ ...draft, isActive: checked })}
            />
          </div>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Text type="secondary">{t('common.nameZh')}</Text>
          <Input
            value={draft.titleZh}
            onChange={(event) => setDraft({ ...draft, titleZh: event.target.value })}
            style={{ marginTop: 6 }}
          />
        </Col>
        <Col xs={24} lg={9}>
          <Text type="secondary">{t('common.nameRu')}</Text>
          <Input
            value={draft.titleRu}
            onChange={(event) => setDraft({ ...draft, titleRu: event.target.value })}
            style={{ marginTop: 6 }}
          />
        </Col>
        <Col xs={24} lg={6}>
          <Text type="secondary">{t('management.sortOrder')}</Text>
          <InputNumber
            value={draft.sortOrder || 0}
            onChange={(sortOrder) => setDraft({ ...draft, sortOrder: Number(sortOrder || 0) })}
            style={{ width: '100%', marginTop: 6 }}
          />
        </Col>
      </Row>
      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={addTemplate}>{t('management.addTemplate')}</Button>
        <Text type="secondary">{t('management.componentLibrary')}</Text>
        <Select
          showSearch
          value={componentToAdd || componentDefinitions[0]?.key}
          onChange={setComponentToAdd}
          options={componentOptions}
          style={{ width: 380 }}
          optionFilterProp="label"
          placeholder={t('management.selectComponent')}
        />
        <Button icon={<PlusOutlined />} onClick={addComponent}>{t('management.addComponent')}</Button>
        <Button icon={<SaveOutlined />} type="primary" onClick={save}>{t('common.save')}</Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        dataSource={components}
        pagination={false}
        scroll={{ x: 1320 }}
        columns={[
          { title: t('common.type'), dataIndex: 'type', width: 140, render: (_: string, row) => {
            const lang = i18n.language.startsWith('ru') ? 'ru' : 'zh';
            return <Tag>{componentTypeLabels[lang][row.type] || row.type}</Tag>;
          } },
          { title: t('management.component'), dataIndex: 'componentKey', width: 320, render: (_: string, row) => (
            <Select
              showSearch
              value={componentValue(row, componentDefinitions)}
              onChange={(componentKey) => updateComponent(row.id, patchForComponentKey(componentKey))}
              options={componentOptions}
              style={{ width: '100%' }}
              optionFilterProp="label"
              placeholder={row.metricKey ? localTitle(metricByKey.get(row.metricKey) || {}, i18n.language) : row.type}
            />
          ) },
          { title: t('management.span'), dataIndex: 'span', width: 110, render: (_: number, row) => (
            <InputNumber
              min={componentMinSpan(componentType(row, componentByKey.get(componentValue(row, componentDefinitions) || '')))}
              max={componentSpanMax}
              value={normalizeComponentSpan(row.span || 6, 6, componentType(row, componentByKey.get(componentValue(row, componentDefinitions) || '')))}
              onChange={(span) => updateComponent(row.id, { span: normalizeComponentSpan(span || 6, 6, componentType(row, componentByKey.get(componentValue(row, componentDefinitions) || ''))) })}
              style={{ width: 86 }}
            />
          ) },
          { title: t('management.height'), dataIndex: 'height', width: 120, render: (_: number, row) => (
            <InputNumber
              min={componentMinHeight(componentType(row, componentByKey.get(componentValue(row, componentDefinitions) || '')))}
              max={componentHeightMax}
              step={componentType(row, componentByKey.get(componentValue(row, componentDefinitions) || '')) === 'kpi' ? 1 : 20}
              value={normalizeComponentHeight(row.height, row, componentByKey.get(componentValue(row, componentDefinitions) || ''))}
              onChange={(height) => updateComponent(row.id, { height: normalizeComponentHeight(height, row, componentByKey.get(componentValue(row, componentDefinitions) || '')) })}
              style={{ width: 96 }}
            />
          ) },
          { title: t('management.visibleRoles'), dataIndex: 'roleScope', width: 220, render: (_: unknown, row) => (
            <Select
              mode="multiple"
              value={row.roleScope?.roles || []}
              onChange={(roles) => updateComponent(row.id, { roleScope: { ...(row.roleScope || {}), roles } })}
              options={roleOptions}
              style={{ width: '100%' }}
            />
          ) },
          { title: t('management.visibleDepartments'), dataIndex: 'roleScope', width: 220, render: (_: unknown, row) => (
            <Select
              mode="multiple"
              value={row.roleScope?.departments || []}
              onChange={(departments) => updateComponent(row.id, { roleScope: { ...(row.roleScope || {}), departments } })}
              options={departmentOptions}
              style={{ width: '100%' }}
            />
          ) },
          { title: t('common.active'), dataIndex: 'visible', width: 90, render: (_: boolean, row) => (
            <Switch checked={row.visible !== false} onChange={(visible) => updateComponent(row.id, { visible })} />
          ) },
          { title: t('common.adminOnly'), dataIndex: 'adminOnly', width: 110, render: (_: boolean, row) => (
            <Switch checked={Boolean(row.adminOnly)} onChange={(adminOnly) => updateComponent(row.id, { adminOnly })} />
          ) },
          { title: t('common.action'), width: 90, render: (_: unknown, row) => <Button danger size="small" onClick={() => removeComponent(row.id)}>{t('common.delete')}</Button> },
        ]}
      />
    </Space>
  );
}

function ConfigTab({ configs, onSaved }: { configs: SystemConfigItem[]; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(Object.fromEntries(configs.map(item => [item.configKey, item.configValue || ''])));
  }, [configs]);

  const save = async (item: SystemConfigItem) => {
    await updateSystemConfig(item.configKey, values[item.configKey] ?? '');
    message.success(t('common.saved'));
    onSaved();
  };

  return (
    <Table
      size="small"
      rowKey="configKey"
      dataSource={configs}
      pagination={{ pageSize: 20 }}
      columns={[
        { title: t('common.type'), dataIndex: 'groupKey', width: 140, render: (value) => <Tag>{value}</Tag> },
        { title: t('common.name'), render: (_, row) => localTitle(row, i18n.language) },
        { title: t('management.configKey'), dataIndex: 'configKey', width: 260 },
        { title: t('management.configValue'), dataIndex: 'configValue', width: 260, render: (_, row) => (
          <Input value={values[row.configKey]} disabled={row.isSecret} onChange={(event) => setValues(prev => ({ ...prev, [row.configKey]: event.target.value }))} />
        ) },
        { title: t('common.action'), width: 100, render: (_, row) => <Button size="small" onClick={() => save(row)}>{t('common.save')}</Button> },
      ]}
    />
  );
}

function DictionaryTab({ items, onSaved }: { items: DictionaryItem[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DictionaryItem | null>(null);
  const [form] = Form.useForm();

  const openModal = (item?: DictionaryItem) => {
    const next = item || { dictType: '', itemCode: '', labelZh: '', labelRu: '', sortOrder: 0, isActive: true };
    setEditing(next);
    form.setFieldsValue(next);
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    await saveDictionaryItem({ ...(editing || {}), ...values });
    message.success(t('common.saved'));
    setModalOpen(false);
    onSaved();
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => openModal()}>{t('common.add')}</Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        dataSource={items}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: t('common.type'), dataIndex: 'dictType', width: 180 },
          { title: t('common.code'), dataIndex: 'itemCode', width: 180 },
          { title: t('common.nameZh'), dataIndex: 'labelZh' },
          { title: t('common.nameRu'), dataIndex: 'labelRu' },
          { title: t('common.active'), dataIndex: 'isActive', width: 90, render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? t('common.yes') : t('common.no')}</Tag> },
          { title: t('common.action'), width: 90, render: (_, row) => <Button size="small" onClick={() => openModal(row)}>{t('common.edit')}</Button> },
        ]}
      />
      <Modal open={modalOpen} title={t('management.dictionaryItem')} onOk={save} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="dictType" label={t('common.type')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="itemCode" label={t('common.code')} rules={[{ required: true }]}>
            <Input disabled={Boolean(editing?.id)} />
          </Form.Item>
          <Form.Item name="labelZh" label={t('common.nameZh')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="labelRu" label={t('common.nameRu')}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label={t('management.sortOrder')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label={t('common.active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function ManagementCenter() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useApiQuery(['management-overview'], getManagementOverview);
  const organizationQuery = useApiQuery(['organization-overview-for-management'], getOrganizationOverview, {
    retry: false,
  });
  const data = query.data;
  const organization = organizationQuery.data;
  const organizationDepartments = (organization?.departments || []).map(departmentRecordToOption);
  const cockpitDepartments = (data?.departments || []).length ? data?.departments || [] : organizationDepartments;
  const cockpitRoles = organization?.roles || [];

  if (query.error) {
    return <Card title={t('nav.managementCenter')}><Text type="danger">{(query.error as Error).message}</Text></Card>;
  }

  return (
    <Card title={t('nav.managementCenter')} loading={query.isLoading}>
      <Tabs
        items={[
          {
            key: 'cockpit',
            label: t('management.cockpitConfig'),
            children: (
              <CockpitConfigTab
                templates={data?.templates || []}
                catalog={data?.kpiCatalog || []}
                componentCatalog={data?.componentCatalog || []}
                departments={cockpitDepartments}
                roles={cockpitRoles}
                onSaved={() => {
                  query.refetch();
                  queryClient.invalidateQueries({ queryKey: ['cockpit'] });
                }}
              />
            ),
          },
          {
            key: 'dictionary',
            label: t('management.dictionary'),
            children: <DictionaryTab items={data?.dictionaryItems || []} onSaved={() => query.refetch()} />,
          },
          {
            key: 'configs',
            label: t('management.systemConfig'),
            children: <ConfigTab configs={data?.configs || []} onSaved={() => query.refetch()} />,
          },
          {
            key: 'recycle',
            label: t('management.recycleBin'),
            children: (
              <Table
                size="small"
                rowKey="id"
                dataSource={data?.recycleItems || []}
                pagination={{ pageSize: 20 }}
                columns={[
                  { title: t('management.sourceTable'), dataIndex: 'sourceTable', width: 180 },
                  { title: t('management.sourceId'), dataIndex: 'sourceId', width: 120 },
                  { title: t('common.name'), dataIndex: 'title' },
                  { title: t('common.status'), dataIndex: 'restoreStatus', width: 120 },
                  { title: t('management.deletedAt'), dataIndex: 'deletedAt', width: 180 },
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
