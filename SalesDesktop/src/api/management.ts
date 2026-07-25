import client from './client';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

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

export interface KpiCompareValue {
  value?: number | null;
  labelZh?: string;
  labelRu?: string;
  goodWhen?: 'up' | 'down' | 'neutral';
}

export interface KpiMetricValue {
  value: number | string;
  secondaryValue?: number | string | null;
  secondaryUnit?: string;
  secondaryPrecision?: number;
  secondaryLabelZh?: string;
  secondaryLabelRu?: string;
  updatedAt?: string;
  status?: string;
  source?: string;
  compare?: KpiCompareValue[];
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
  const res = await client.get(v2(ApiPaths.management.cockpit), { params: { lang } });
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
  const res = await client.get(v2(ApiPaths.management.overview));
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
  const res = await client.put(v2(ApiPaths.management.config(configKey)), { configValue });
  return res.data;
}

export async function saveDictionaryItem(item: DictionaryItem) {
  const payload = { ...item, isActive: item.isActive !== false };
  const res = item.id
    ? await client.put(v2(ApiPaths.management.dictionaryItem(item.id)), payload)
    : await client.post(v2(ApiPaths.management.dictionaryItems), payload);
  return res.data;
}

export async function saveCockpitTemplate(template: CockpitTemplate) {
  const res = await client.put(v2(ApiPaths.management.cockpitTemplate(template.templateKey)), template);
  return res.data;
}

export interface ProfitCostType {
  costType: 'M' | 'N' | 'O' | 'P' | 'Q';
  labelZh: string;
  labelRu: string;
}

export interface ProfitCostItemValue {
  value: number | null;
  source: 'db' | 'config';
  updatedAt?: string | null;
}

export interface ProfitStationRow {
  shopKey: number;
  name: string;
  items: Record<string, ProfitCostItemValue>;
}

export interface ProfitCostItemsPayload {
  month: string;
  stations: ProfitStationRow[];
}

export interface ProfitPurchasePriceValue {
  resourceKey: number;
  product: string;
  purchaseProduct: string;
  purchasePrice: number | null;
  source: 'db' | 'template' | 'config';
  updatedAt?: string | null;
}

export interface ProfitPurchaseStationRow {
  shopKey: number;
  name: string;
  rows: ProfitPurchasePriceValue[];
}

export interface ProfitPurchasePricesPayload {
  month: string;
  stations: ProfitPurchaseStationRow[];
}

export async function getProfitCostTypes() {
  const res = await client.get(v2(ApiPaths.management.profitCostTypes));
  return res.data as ProfitCostType[];
}

export async function getProfitCostItems(month: string) {
  const res = await client.get(v2(ApiPaths.management.profitCostItems), { params: { month } });
  return res.data as ProfitCostItemsPayload;
}

export async function saveProfitCostItems(
  month: string,
  items: Array<{ shopKey: number; costType: string; value: number | null }>,
) {
  const res = await client.put(v2(ApiPaths.management.profitCostItems), { month, items });
  return res.data as { month: string; saved: number; deleted: number };
}

export async function getProfitPurchasePrices(month: string) {
  const res = await client.get(v2(ApiPaths.management.profitPurchasePrices), { params: { month } });
  return res.data as ProfitPurchasePricesPayload;
}

export async function saveProfitPurchasePrices(
  month: string,
  items: Array<{ shopKey: number; resourceKey: number; purchaseProduct?: string; purchasePrice: number | null }>,
) {
  const res = await client.put(v2(ApiPaths.management.profitPurchasePrices), { month, items });
  return res.data as { month: string; saved: number; deleted: number };
}

export interface WholesaleBriefingPriceRow {
  productKey: number;
  labelZh: string;
  labelRu: string;
  largePrice: number | null;
  retailPrice: number | null;
  updatedAt?: string | null;
}

export async function getWholesaleBriefingPrices() {
  const res = await client.get(v2(ApiPaths.management.profitWholesaleBriefingPrices));
  return res.data as { items: WholesaleBriefingPriceRow[] };
}

export async function saveWholesaleBriefingPrices(
  items: Array<{ productKey: number; largePrice: number | null; retailPrice: number | null }>,
) {
  const res = await client.put(v2(ApiPaths.management.profitWholesaleBriefingPrices), { items });
  return res.data as { saved: number; deleted: number };
}
