import client from './client';

export interface KpiDefinition {
  key: string;
  titleZh: string;
  titleRu: string;
  unit?: string;
  precision?: number;
  group: string;
  periodScope?: 'year' | 'month' | 'latest';
  goodWhen?: 'up' | 'down' | 'neutral';
  adminOnly?: boolean;
  permissionCode?: string;
}

export interface ComponentDefinition {
  key: string;
  type: CockpitComponent['type'];
  titleZh: string;
  titleRu?: string;
  group: string;
  periodScope?: 'year' | 'month' | 'latest';
  defaultSpan?: number;
  metricKey?: string;
  dataKey?: string;
  adminOnly?: boolean;
  permissionCode?: string;
}

export interface KpiMetricValue {
  value: number | string;
  updatedAt?: string;
  status?: string;
  source?: string;
}

export interface CockpitComponent {
  id: string;
  componentKey?: string;
  type: 'kpi' | 'trend' | 'ranking' | 'structure' | 'exchange' | 'market_watch' | 'retail_alert';
  metricKey?: string;
  dataKey?: string;
  span?: number;
  widthPercent?: number;
  height?: number;
  visible?: boolean;
  adminOnly?: boolean;
  roleScope?: { roles?: string[]; departments?: string[] };
}

export interface CockpitTemplate {
  id?: number;
  templateKey: string;
  titleZh: string;
  titleRu?: string;
  roleScope?: { roles?: string[]; departments?: string[] };
  config: { components: CockpitComponent[] };
  isActive?: boolean;
  sortOrder?: number;
  updatedAt?: string;
}

export interface SystemConfigItem {
  configKey: string;
  configValue: string;
  valueType: string;
  groupKey: string;
  labelZh: string;
  labelRu?: string;
  isSecret?: boolean;
  updatedAt?: string;
}

export interface DictionaryItem {
  id?: number;
  dictType: string;
  itemCode: string;
  labelZh: string;
  labelRu?: string;
  value?: unknown;
  sortOrder?: number;
  isActive?: boolean;
  updatedAt?: string;
}

export interface RecycleItem {
  id: number;
  sourceTable: string;
  sourceId: string;
  title?: string;
  deletedBy?: number;
  deletedAt?: string;
  restoreStatus: string;
}

export interface DepartmentOption {
  deptCode: string;
  deptName: string;
  deptNameRu?: string | null;
  isActive?: boolean;
}

export async function getCockpit(lang?: string) {
  const res = await client.get('/cockpit', { params: { lang } });
  return res.data as {
    templates: CockpitTemplate[];
    metrics: Record<string, KpiMetricValue>;
    kpiCatalog: KpiDefinition[];
    componentCatalog: ComponentDefinition[];
    componentData: Record<string, any>;
    retailAlert?: {
      trendAnomalies?: any[];
      suggestions?: string[];
      generatedAt?: string;
      periodKey?: string;
    };
    periods?: { year: number; month: number; yearMonth: string };
  };
}

export async function getManagementOverview() {
  const res = await client.get('/management/overview');
  return res.data as {
    configs: SystemConfigItem[];
    dictionaryItems: DictionaryItem[];
    templates: CockpitTemplate[];
    recycleItems: RecycleItem[];
    kpiCatalog: KpiDefinition[];
    componentCatalog: ComponentDefinition[];
    departments: DepartmentOption[];
  };
}

export async function updateSystemConfig(configKey: string, configValue: string) {
  const res = await client.put(`/management/configs/${encodeURIComponent(configKey)}`, { configValue });
  return res.data;
}

export async function saveDictionaryItem(item: DictionaryItem) {
  const payload = { ...item, isActive: item.isActive !== false };
  const res = item.id
    ? await client.put(`/management/dictionary-items/${item.id}`, payload)
    : await client.post('/management/dictionary-items', payload);
  return res.data;
}

export async function saveCockpitTemplate(template: CockpitTemplate) {
  const res = await client.put(`/management/cockpit/templates/${template.templateKey}`, template);
  return res.data;
}
