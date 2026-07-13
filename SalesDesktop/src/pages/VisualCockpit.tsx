import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { App as AntApp, Button, Card, Col, Empty, Row, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, ArrowsAltOutlined, CloseOutlined, EditOutlined, FullscreenOutlined, HolderOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getCockpit, getManagementOverview, saveCockpitTemplate, type CockpitComponent, type CockpitTemplate, type ComponentDefinition, type KpiDefinition, type KpiMetricValue } from '@/api/management';
import ChartCard from '@/components/ui/ChartCard';
import PageState from '@/components/ui/PageState';
import type { KpiGoodWhen, KpiTone } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';
import { CHART_PALETTE } from '@/theme/charts';
import { sortRankingRows } from '@/utils/rankingCharts';
import { formatRetailCnyKpi, formatRetailLitersKpi, formatRetailSomKpi, formatRetailTonsKpi } from '@/utils/retailMetrics';

const { Text } = Typography;

const fallbackComponentDefinitions: ComponentDefinition[] = [
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

const defaultComponentKeyByType: Partial<Record<CockpitComponent['type'], string>> = {
  trend: 'chart.retail_year_monthly_trend',
  ranking: 'rank.retail_year_region_sales',
  structure: 'chart.wholesale_month_category_mix',
  exchange: 'card.exchange_current',
  market_watch: 'list.market_watch',
  retail_alert: 'panel.retail_alert',
};

const exchangeRateMetricKeys = new Set(['exchange_usd_kgs', 'exchange_cny_kgs', 'exchange_kgs_cny']);
const exchangeRateComponentKeys = new Set(Array.from(exchangeRateMetricKeys, key => `kpi.${key}`));
const exchangeRateComponentIdKeys = new Set(Array.from(exchangeRateComponentKeys, key => componentIdKey(key)));
const retailAmountMetricKeys = new Set(['retail_sales_amount', 'retail_month_sales_amount']);
const retailVolumeMetricKeys = new Set(['retail_volume_liters', 'retail_month_volume_liters']);

function componentIdKey(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function componentDefinitionFromId(component: CockpitComponent, catalog: Map<string, ComponentDefinition>) {
  const normalizedId = componentIdKey(component.id || '');
  if (!normalizedId) return undefined;
  return Array.from(catalog.values()).find((item) => {
    const key = componentIdKey(item.key);
    return normalizedId === key || normalizedId.startsWith(`${key}_`);
  });
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

function resolveComponentDefinition(component: CockpitComponent, catalog: Map<string, ComponentDefinition>) {
  if (component.metricKey && exchangeRateMetricKeys.has(component.metricKey)) return catalog.get('card.exchange_current');
  if (component.componentKey && exchangeRateComponentKeys.has(component.componentKey)) return catalog.get('card.exchange_current');
  const normalizedComponentId = componentIdKey(component.id || '');
  if (Array.from(exchangeRateComponentIdKeys).some(key => normalizedComponentId === key || normalizedComponentId.startsWith(`${key}_`))) return catalog.get('card.exchange_current');
  if (component.componentKey && catalog.has(component.componentKey)) return catalog.get(component.componentKey);
  const byId = componentDefinitionFromId(component, catalog);
  if (byId) return byId;
  if (component.dataKey) {
    const byDataKey = Array.from(catalog.values()).find((item) => item.dataKey === component.dataKey);
    if (byDataKey) return byDataKey;
  }
  const type = inferredComponentType(component);
  const fallbackKey = type ? defaultComponentKeyByType[type] : undefined;
  return fallbackKey ? catalog.get(fallbackKey) : undefined;
}

function componentTitle(component: CockpitComponent, definition: ComponentDefinition | undefined, metric: KpiDefinition | undefined, language: string) {
  const item = definition || metric;
  if (!item) return component.id;
  return language.startsWith('ru') ? item.titleRu || item.titleZh : item.titleZh;
}

function templateTitle(template: CockpitTemplate | undefined, language: string) {
  if (!template) return '';
  return language.startsWith('ru') ? template.titleRu || template.titleZh : template.titleZh;
}

function localizedUnit(unit: string | undefined, language: string) {
  const value = String(unit || '').trim();
  if (!value) return '';
  const compact = value.replace(/\s+/g, '');
  const ruLabels: Record<string, string> = {
    '站': 'АЗС',
    '条': 'стр.',
    '份': 'шт.',
    '单': 'заяв.',
    '次': 'раз',
    '项': 'п.',
    L: 'л',
    l: 'л',
    t: 'т',
    '吨': 'т',
    'сом': 'сом',
    '万сом': '10 тыс. сом',
    '万索姆': '10 тыс. сом',
    '万元': '10 тыс. CNY',
  };
  const zhLabels: Record<string, string> = {
    L: '升',
    l: '升',
    t: '吨',
    'т': '吨',
    'сом': '索姆',
    som: '索姆',
    KGS: '索姆',
    kgs: '索姆',
    '万сом': '万索姆',
    '万som': '万索姆',
    '万索姆': '万索姆',
    '¥': '元',
    '¥万': '万元',
    '万元': '万元',
  };
  return (language.startsWith('ru') ? ruLabels : zhLabels)[compact] || value;
}

function unitFor(definition: KpiDefinition | undefined, language: string) {
  const unit = definition?.unit;
  return unit ? localizedUnit(unit, language) : unit;
}

function labelFor(item: { labelZh?: string; labelRu?: string; name?: string }, language: string) {
  if (language.startsWith('ru')) return item.labelRu || item.labelZh || item.name || '';
  return item.labelZh || item.labelRu || item.name || '';
}

function chartValueText(value: unknown, unit: string | undefined, language: string) {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  const text = Number.isFinite(numeric) ? formatCockpitKpiValue(numeric) : String(value);
  const label = localizedUnit(unit, language);
  return label ? `${text}${label}` : text;
}

function isAmountMetric(definition: KpiDefinition | undefined, metricKey?: string) {
  const key = metricKey || definition?.key || '';
  const title = `${definition?.titleZh || ''} ${definition?.titleRu || ''}`;
  return key.includes('amount') || key.includes('sales') || /销售额|金额|выруч|сумм/i.test(title);
}

function cockpitKpiDisplay(definition: KpiDefinition | undefined, metricKey: string | undefined, value: number | string | null | undefined, language: string) {
  const unit = definition?.unit || '';
  const compact = unit.replace(/\s+/g, '');
  const numeric = Number(value);
  if (metricKey && retailAmountMetricKeys.has(metricKey) && Number.isFinite(numeric)) {
    return { value: formatRetailSomKpi(numeric, language), suffix: undefined, precision: undefined };
  }
  if (metricKey && retailVolumeMetricKeys.has(metricKey) && Number.isFinite(numeric)) {
    return { value: formatRetailLitersKpi(numeric, language), suffix: undefined, precision: undefined };
  }
  if (isAmountMetric(definition, metricKey) && Number.isFinite(numeric)) {
    if (compact === 'сом' || compact.toLowerCase() === 'som' || compact.toUpperCase() === 'KGS') {
      return { value: numeric / 10000, suffix: localizedUnit('万索姆', language), precision: 0 };
    }
    if (compact === '¥' || compact.toUpperCase() === 'CNY') {
      return { value: numeric / 10000, suffix: localizedUnit('万元', language), precision: 0 };
    }
  }
  return { value, suffix: unitFor(definition, language), precision: definition?.precision };
}

function cockpitSecondaryDisplay(metric: KpiMetricValue | undefined, language: string) {
  const value = metric?.secondaryValue;
  if (value === null || value === undefined || value === '') {
    return { value, suffix: undefined, precision: undefined };
  }
  const unit = String(metric?.secondaryUnit || '').replace(/\s+/g, '');
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (unit === '¥' || unit.toUpperCase() === 'CNY') {
      return { value: formatRetailCnyKpi(numeric, language), suffix: undefined, precision: undefined };
    }
    if (unit === 't' || unit === '吨' || unit === 'т') {
      return { value: formatRetailTonsKpi(numeric, language), suffix: undefined, precision: undefined };
    }
  }
  return { value, suffix: localizedUnit(metric?.secondaryUnit, language), precision: metric?.secondaryPrecision };
}

function toneFor(definition: KpiDefinition | undefined, value: number | string | undefined): KpiTone {
  if (!definition) return 'neutral';
  const numeric = Number(value || 0);
  if (definition.goodWhen === 'down' && numeric > 0) return 'danger';
  if (definition.goodWhen === 'up' && numeric > 0) return 'success';
  if (definition.group === 'system' && numeric === 0) return 'success';
  return 'neutral';
}

const cockpitToneColors: Record<KpiTone, string | undefined> = {
  neutral: undefined,
  success: '#0f8a00',
  warning: '#d48806',
  danger: '#cf1322',
  info: '#1677ff',
};

type CockpitCompareItem = { value: number; label?: string; goodWhen?: KpiGoodWhen };

function cockpitCompareColor(value: number, goodWhen: KpiGoodWhen = 'up') {
  if (goodWhen === 'neutral' || value === 0) return '#5f6368';
  const isGood = goodWhen === 'up' ? value > 0 : value < 0;
  return isGood ? '#389e0d' : '#cf1322';
}

function metricCompareItems(metric: KpiMetricValue | undefined, definition: KpiDefinition | undefined, language: string): CockpitCompareItem[] {
  return (metric?.compare || [])
    .map((item) => {
      const value = Number(item.value);
      if (!Number.isFinite(value)) return null;
      return {
        value,
        label: labelFor(item, language),
        goodWhen: item.goodWhen || definition?.goodWhen || 'up',
      };
    })
    .filter(Boolean) as CockpitCompareItem[];
}

function CockpitCompareBadge({ item }: { item: CockpitCompareItem }) {
  const toneClass = item.value > 0 ? 'up' : item.value < 0 ? 'down' : 'neutral';
  const color = cockpitCompareColor(item.value, item.goodWhen);
  return (
    <span className={`cockpit-kpi-compare-item ${toneClass}`}>
      <span className="cockpit-kpi-compare-label">{item.label}</span>
      <span className="cockpit-kpi-compare-value" style={{ color }}>
        {item.value > 0 ? <ArrowUpOutlined /> : item.value < 0 ? <ArrowDownOutlined /> : null}
        {Math.abs(item.value)}%
      </span>
    </span>
  );
}

function cockpitKpiValueColor(definition: KpiDefinition | undefined, metricKey?: string) {
  const key = metricKey || definition?.key || '';
  const unit = definition?.unit || '';
  if (definition?.group === 'procurement' || key.includes('procurement') || key.includes('purchase')) return '#ca8a04';
  if (key.includes('amount') || unit === 'сом' || unit === '¥') return '#cf1322';
  if (key.includes('volume') || key.includes('tons') || unit === 'L' || unit === 't') return '#cf1322';
  if (key.includes('active_shops') || key.includes('contract_active') || unit === '站') return '#0f8a00';
  return cockpitToneColors[toneFor(definition, undefined)] || '#111827';
}

const cockpitKpiRouteByMetricKey: Record<string, string> = {
  retail_sales_amount: '/retail/overview',
  retail_volume_liters: '/retail/overview',
  retail_active_shops: '/retail/station',
  retail_inventory: '/retail/overview',
  retail_month_sales_amount: '/retail/monthly',
  retail_month_volume_liters: '/retail/monthly',
  retail_month_active_shops: '/retail/station',
  retail_trend_anomalies: '/retail/alert',
  retail_ai_suggestions: '/retail/alert',
  yearly_wholesale_tons: '/wholesale/overview',
  yearly_procurement_tons: '/procurement',
  wholesale_month_export_tons: '/wholesale/overview',
  wholesale_month_local_tons: '/wholesale/overview',
  wholesale_month_transfer_tons: '/wholesale/transfer',
  wholesale_month_procurement_tons: '/procurement',
  wholesale_month_processing_tons: '/wholesale/query',
  wholesale_month_unknown_tons: '/wholesale/query',
  wholesale_month_export_amount_cny: '/wholesale/overview',
  wholesale_month_local_amount_cny: '/wholesale/overview',
  contract_active: '/contracts/view',
  contract_total: '/contracts/view',
  contract_appendix_missing: '/contracts/view',
  contract_expiring_30d: '/contracts/view',
  train_entry_today_rows: '/train-entry',
  material_transfer_today: '/materials',
  material_transfer_pending: '/materials',
  exchange_usd_kgs: '/exchange',
  exchange_cny_kgs: '/exchange',
  exchange_kgs_cny: '/exchange',
  market_watch_items: '/exchange',
  api_failed_24h: '/system-health',
  ai_failed_7d: '/system-health',
  automation_failed: '/system-health',
  cache_missing: '/system-health',
};

function routeForCockpitKpi(definition: KpiDefinition | undefined, metricKey?: string) {
  const key = metricKey || definition?.key || '';
  if (key && cockpitKpiRouteByMetricKey[key]) return cockpitKpiRouteByMetricKey[key];
  if (!definition) return undefined;
  if (definition.group === 'retail') return definition.periodScope === 'month' ? '/retail/monthly' : definition.periodScope === 'latest' ? '/retail/alert' : '/retail/overview';
  if (definition.group === 'wholesale') return '/wholesale/overview';
  if (definition.group === 'procurement') return '/procurement';
  if (definition.group === 'contracts') return '/contracts/view';
  if (definition.group === 'entry') return '/train-entry';
  if (definition.group === 'materials') return '/materials';
  if (definition.group === 'exchange') return '/exchange';
  if (definition.group === 'system') return '/system-health';
  return undefined;
}

function formatCockpitKpiValue(value: number | string | null | undefined, precision?: number) {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (precision !== undefined) return numeric.toLocaleString(undefined, { minimumFractionDigits: precision, maximumFractionDigits: precision });
  if (Math.abs(numeric) >= 1000) return Math.round(numeric).toLocaleString();
  if (Math.abs(numeric) >= 100) return numeric.toFixed(0);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1);
  return numeric.toFixed(2);
}

function secondaryMetricLabel(metric: KpiMetricValue | undefined, language: string) {
  if (!metric) return '';
  return language.startsWith('ru')
    ? metric.secondaryLabelRu || metric.secondaryLabelZh || ''
    : metric.secondaryLabelZh || metric.secondaryLabelRu || '';
}

function CockpitKpiPanel({
  title,
  value,
  suffix,
  precision,
  secondaryValue,
  secondarySuffix,
  secondaryPrecision,
  secondaryLabel,
  compare,
  tone,
  valueColor,
  tooltip,
  style,
  onClick,
}: {
  title: string;
  value: number | string | null | undefined;
  suffix?: string;
  precision?: number;
  secondaryValue?: number | string | null;
  secondarySuffix?: string;
  secondaryPrecision?: number;
  secondaryLabel?: string;
  compare?: CockpitCompareItem[];
  tone?: KpiTone;
  valueColor?: string;
  tooltip?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const hasSecondaryValue = secondaryValue !== null && secondaryValue !== undefined && secondaryValue !== '';
  const compareItems = (compare || []).filter((item) => Number.isFinite(item.value));
  const content = (
    <Card size="small" className={['cockpit-component-card', 'cockpit-kpi-panel', compareItems.length ? 'has-compare' : '', onClick ? 'cockpit-kpi-clickable' : ''].filter(Boolean).join(' ')} style={style} onClick={onClick}>
      <div className="cockpit-kpi-panel-body">
        <div className="cockpit-kpi-panel-main">
          <div className="cockpit-kpi-panel-title">{title}</div>
          <div className="cockpit-kpi-panel-stat">
            <div className="cockpit-kpi-panel-value" style={{ color: valueColor || cockpitToneColors[tone || 'neutral'] }}>
              <span className="cockpit-kpi-panel-number">{formatCockpitKpiValue(value, precision)}</span>
              {suffix && <span className="cockpit-kpi-panel-unit">{suffix}</span>}
            </div>
            {hasSecondaryValue && (
              <div className="cockpit-kpi-panel-secondary">
                {secondaryLabel && <span className="cockpit-kpi-panel-secondary-label">{secondaryLabel}</span>}
                <span>{formatCockpitKpiValue(secondaryValue, secondaryPrecision)}</span>
                {secondarySuffix && <span className="cockpit-kpi-panel-secondary-unit">{secondarySuffix}</span>}
              </div>
            )}
          </div>
        </div>
        {compareItems.length > 0 && (
          <div className="cockpit-kpi-compare-panel">
            {compareItems.map((item, index) => (
              <CockpitCompareBadge key={`${item.label || 'compare'}-${index}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
  return tooltip ? <Tooltip title={tooltip}>{content}</Tooltip> : content;
}

const componentSpanMax = 24;
const componentHeightMax = 900;
const componentWidthPercentMax = 100;
const cockpitGridColumns = 96;
const cockpitGridRowHeight = 8;
const cockpitGridGap = 16;

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

function boundedPercent(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.round(numeric * 100) / 100, min), max);
}

function componentMinSpan(type: CockpitComponent['type']) {
  return type === 'kpi' ? 1 : 4;
}

function componentMinWidthPercent(type: CockpitComponent['type']) {
  return type === 'kpi' ? 2 : 4;
}

function componentMinPixelWidth(type: CockpitComponent['type']) {
  return type === 'kpi' ? 24 : 56;
}

function componentMinHeight(type: CockpitComponent['type']) {
  if (type === 'kpi') return 20;
  if (type === 'exchange') return 72;
  if (type === 'market_watch' || type === 'retail_alert') return 96;
  return 100;
}

function componentSpan(component: CockpitComponent, definition: ComponentDefinition | undefined, fallback: number) {
  const type = resolvedComponentType(component, definition);
  return boundedNumber(component.span, definition?.defaultSpan || fallback, componentMinSpan(type), componentSpanMax);
}

function componentWidthPercent(component: CockpitComponent, type: CockpitComponent['type'], span: number) {
  const fallback = (span / componentSpanMax) * 100;
  return boundedPercent(component.widthPercent, fallback, componentMinWidthPercent(type), componentWidthPercentMax);
}

function componentGridColumnSpan(widthPercent: number, type: CockpitComponent['type']) {
  return boundedNumber((widthPercent / 100) * cockpitGridColumns, 24, Math.ceil((componentMinWidthPercent(type) / 100) * cockpitGridColumns), cockpitGridColumns);
}

function componentGridRowSpan(height: number) {
  return Math.max(1, Math.ceil((height + cockpitGridGap) / (cockpitGridRowHeight + cockpitGridGap)));
}

function spanFromWidthPercent(widthPercent: number, type: CockpitComponent['type']) {
  return boundedNumber((widthPercent / 100) * componentSpanMax, 6, componentMinSpan(type), componentSpanMax);
}

function componentHeight(component: CockpitComponent, type: CockpitComponent['type'], fallback?: number) {
  const defaultHeight = fallback || defaultComponentHeights[type] || defaultComponentHeights.kpi;
  return boundedNumber(component.height, defaultHeight, componentMinHeight(type), componentHeightMax);
}

function cardHeightStyle(height: number, span = 6, widthPercent = (span / componentSpanMax) * 100): CSSProperties {
  const compact = height < 96;
  const tiny = height < 56;
  const narrow = widthPercent < 12;
  const valueSize = boundedNumber(height * 0.24 + widthPercent * 0.22, 22, tiny ? 10 : compact ? 14 : 18, narrow ? 24 : 40);
  const compareWidth = boundedNumber(height * 0.22 + widthPercent * 2, 98, tiny ? 56 : narrow ? 70 : 86, narrow ? 98 : 132);
  const compareValueSize = boundedNumber(height * 0.07 + widthPercent * 0.36, 18, tiny ? 13 : compact ? 15 : 18, narrow ? 18 : 23);
  const compareLabelSize = boundedNumber(height * 0.036 + widthPercent * 0.1, 13, tiny ? 11 : compact ? 12 : 13, narrow ? 14 : 15);
  const compareGap = boundedNumber(height * 0.012 + widthPercent * 0.025, 4, tiny ? 2 : 3, 6);
  const compareColumnGap = boundedNumber(height * 0.018 + widthPercent * 0.06, 8, tiny ? 3 : compact ? 4 : 6, narrow ? 8 : 12);
  const titleSize = tiny ? 10 : 12;
  const cardTitleSize = tiny ? 10 : 12;
  const padding = boundedNumber(Math.min(height * 0.09, widthPercent * 0.45), 14, tiny ? 2 : compact ? 4 : 8, 16);
  const titleMinHeight = tiny ? 0 : compact ? 14 : 18;
  return {
    minHeight: height,
    '--cockpit-card-min-height': `${height}px`,
    '--cockpit-kpi-value-size': `${valueSize}px`,
    '--cockpit-kpi-title-size': `${titleSize}px`,
    '--cockpit-kpi-title-min-height': `${titleMinHeight}px`,
    '--cockpit-kpi-title-margin': `${tiny ? 1 : compact ? 2 : 4}px`,
    '--cockpit-kpi-footer-min-height': `${tiny ? 0 : compact ? 8 : 18}px`,
    '--cockpit-kpi-delta-margin': `${tiny ? 1 : compact ? 3 : 8}px`,
    '--cockpit-kpi-footer-gap': `${tiny ? 2 : 6}px`,
    '--cockpit-kpi-stat-gap': `${tiny ? 1 : compact ? 3 : 6}px`,
    '--cockpit-kpi-compare-width': `${compareWidth}px`,
    '--cockpit-kpi-compare-value-size': `${compareValueSize}px`,
    '--cockpit-kpi-compare-label-size': `${compareLabelSize}px`,
    '--cockpit-kpi-compare-gap': `${compareGap}px`,
    '--cockpit-kpi-compare-column-gap': `${compareColumnGap}px`,
    '--cockpit-exchange-value-size': `${boundedNumber(height * 0.18 + widthPercent * 0.14, 20, tiny ? 13 : compact ? 17 : 19, 34)}px`,
    '--cockpit-exchange-label-size': `${tiny ? 10 : 12}px`,
    '--cockpit-card-title-size': `${cardTitleSize}px`,
    '--cockpit-card-padding': `${padding}px`,
    '--cockpit-layout-handle-size': `${tiny ? 18 : compact ? 22 : 26}px`,
    '--cockpit-layout-handle-offset': `${tiny ? 3 : compact ? 5 : 8}px`,
  } as CSSProperties;
}

function fallbackSpanForType(type: CockpitComponent['type']) {
  if (type === 'trend' || type === 'retail_alert') return 24;
  if (type === 'market_watch') return 16;
  if (type === 'exchange') return 12;
  if (type === 'ranking' || type === 'structure') return 12;
  return 6;
}

function resolvedComponentType(component: CockpitComponent, definition: ComponentDefinition | undefined) {
  return (definition?.type || inferredComponentType(component) || component.type || 'kpi') as CockpitComponent['type'];
}

type LayoutDraft = Partial<Pick<CockpitComponent, 'span' | 'widthPercent' | 'height'>>;

function cockpitColProps(widthPercent: number, height: number, type: CockpitComponent['type'], editing: boolean) {
  return {
    className: ['cockpit-free-col', editing ? 'is-editing' : ''].filter(Boolean).join(' '),
    flex: 'none',
    style: {
      '--cockpit-component-width': `${widthPercent}%`,
      '--cockpit-grid-column-span': componentGridColumnSpan(widthPercent, type),
      '--cockpit-grid-row-span': componentGridRowSpan(height),
    } as CSSProperties,
  };
}

function applyComponentOrder<T extends { id: string }>(components: T[], order: string[]) {
  if (!order.length) return components;
  const componentById = new Map(components.map(component => [component.id, component]));
  const ordered = order.map(id => componentById.get(id)).filter(Boolean) as T[];
  const orderedIds = new Set(ordered.map(component => component.id));
  return [...ordered, ...components.filter(component => !orderedIds.has(component.id))];
}

function isOrderChanged(components: CockpitComponent[], order: string[]) {
  if (!order.length) return false;
  const currentIds = components.map(component => component.id);
  const nextIds = applyComponentOrder(components, order).map(component => component.id);
  return currentIds.length !== nextIds.length || currentIds.some((id, index) => id !== nextIds[index]);
}

function RetailAlertPanel({ data, style }: { data: any; style?: CSSProperties }) {
  const { t, i18n } = useTranslation();
  const anomalies = data?.trendAnomalies || [];
  const suggestions = data?.suggestions || [];
  return (
    <Card size="small" title={t('cockpit.retailAlertSummary')} className="cockpit-component-card" style={style}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={anomalies.length ? 'red' : 'green'}>{t('retail.trendAnomaly')}: {anomalies.length}</Tag>
          <Tag color="blue">{t('retail.suggestions')}: {suggestions.length}</Tag>
          {data?.periodKey && <Tag>{data.periodKey}</Tag>}
        </Space>
        {suggestions.length ? suggestions.slice(0, 4).map((item: string, index: number) => (
          <div key={`${index}-${item}`} className="cockpit-suggestion-item">{item}</div>
        )) : <Text type="secondary">{t('common.noData')}</Text>}
        {data?.generatedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('retail.generatedAt')}: {i18n.language.startsWith('ru') ? data.generatedAt : data.generatedAt}
          </Text>
        )}
      </Space>
    </Card>
  );
}

function ExchangePanel({ title, data, style }: { title: string; data: any; style?: CSSProperties }) {
  const { t, i18n } = useTranslation();
  const format = (value: number | string | null | undefined, precision: number) => {
    if (value === null || value === undefined || value === '') return '-';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(precision) : '-';
  };
  const kgsCny = data?.kgsCny ?? (data?.cnyKgs ? 1 / Number(data.cnyKgs) : undefined);
  const labels = i18n.language.startsWith('ru')
    ? ['USD/KGS', 'CNY/KGS', 'KGS/CNY']
    : ['美元/索姆', '人民币/索姆', '索姆/人民币'];
  return (
    <Card size="small" title={title} className="cockpit-component-card cockpit-exchange-card" style={style}>
      <div className="cockpit-dashboard-rate-grid">
        <div className="cockpit-dashboard-rate-item">
          <span>{labels[0]}</span>
          <strong className="cyan">{format(data?.usdKgs, 4)}</strong>
        </div>
        <div className="cockpit-dashboard-rate-item">
          <span>{labels[1]}</span>
          <strong className="amber">{format(data?.cnyKgs, 4)}</strong>
        </div>
        <div className="cockpit-dashboard-rate-item">
          <span>{labels[2]}</span>
          <strong>{format(kgsCny, 6)}</strong>
        </div>
        <div className="cockpit-dashboard-rate-meta">
          <div>{data?.date || '-'}</div>
          <div>{t('exchange.source')}: {data?.source || 'NBKR'}</div>
        </div>
      </div>
    </Card>
  );
}

function MarketWatchPanel({ title, data, style }: { title: string; data: any; style?: CSSProperties }) {
  const { t } = useTranslation();
  const items = data?.items || [];
  return (
    <Card size="small" title={title} className="cockpit-component-card" style={style}>
      {items.length ? items.slice(0, 5).map((item: any) => (
        <div key={`${item.id}-${item.title}`} style={{ marginBottom: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{item.title}</div>
          <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{item.summary}</div>
          {item.priceText && <Tag style={{ marginTop: 6 }}>{item.priceText}</Tag>}
          <div style={{ color: '#999', fontSize: 11, marginTop: 4 }}>
            {item.sourceName || '-'} | {item.observedAt?.substring?.(0, 10) || '-'}
          </div>
        </div>
      )) : <Text type="secondary">{t('common.noData')}</Text>}
    </Card>
  );
}

function trendOption(data: any, language: string) {
  const rows = data?.rows || [];
  const series = data?.series || [];
  const legends = series.map((item: any, index: number) => labelFor(item, language) || `${localizedUnit(item?.unit, language) || (language.startsWith('ru') ? 'Значение' : '数值')}${index + 1}`);
  return {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const },
    legend: { data: legends, bottom: 0 },
    grid: { left: 56, right: 56, top: 48, bottom: 68, outerBoundsMode: 'same' as const, outerBoundsContain: 'axisLabel' as const },
    xAxis: { type: 'category' as const, data: rows.map((row: any) => row.label || row.date || '') },
    yAxis: [
      { type: 'value' as const, name: localizedUnit(series[0]?.unit, language) },
      ...(series.some((item: any) => item.yAxisIndex === 1) ? [{ type: 'value' as const, name: localizedUnit(series.find((item: any) => item.yAxisIndex === 1)?.unit, language), position: 'right' as const }] : []),
    ],
    series: series.map((item: any, index: number) => ({
      name: legends[index],
      tooltipUnit: localizedUnit(item.unit, language),
      type: item.type || 'line',
      yAxisIndex: item.yAxisIndex || 0,
      data: rows.map((row: any) => row[item.key] ?? 0),
    })),
  };
}

function rankingOption(data: any, language: string) {
  const rows = sortRankingRows(data?.rows || [], (row: any) => row.value, 12);
  return {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 16, right: 48, top: 20, bottom: 20, outerBoundsMode: 'same' as const, outerBoundsContain: 'axisLabel' as const },
    xAxis: { type: 'value' as const, name: localizedUnit(data?.unit, language) },
    yAxis: { type: 'category' as const, inverse: true, data: rows.map((row: any) => row.label || '-') },
    series: [{ name: language.startsWith('ru') ? 'Значение' : '数值', tooltipUnit: localizedUnit(data?.unit, language), type: 'bar' as const, data: rows.map((row: any) => row.value || 0) }],
  };
}

function structureOption(data: any, language: string) {
  const rows = (data?.rows || []).filter((row: any) => Number(row.value || 0) > 0);
  return {
    color: CHART_PALETTE,
    tooltip: { trigger: 'item' as const, formatter: (p: any) => {
      const percent = p?.percent == null ? '-' : `${p.percent}%`;
      return `${p?.marker || ''}${p?.name || ''}: ${chartValueText(p?.value, data?.unit, language)} (${percent})`;
    } },
    series: [{
      type: 'pie' as const,
      radius: ['38%', '68%'],
      data: rows.map((row: any) => ({ name: row.label, value: row.value })),
    }],
  };
}

export default function VisualCockpit() {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useApiQuery(['cockpit', i18n.language], () => getCockpit(i18n.language), { refetchInterval: 120000 });
  const [selectedKey, setSelectedKey] = useState<string>();
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string>();
  const [layoutDrafts, setLayoutDrafts] = useState<Record<string, LayoutDraft>>({});
  const [layoutOrder, setLayoutOrder] = useState<string[]>([]);
  const [draggingComponentId, setDraggingComponentId] = useState<string>();
  const [resizingComponentId, setResizingComponentId] = useState<string>();
  const [savingLayout, setSavingLayout] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);
  const bigScreenRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const isAdmin = user?.role === 'admin';
  const bigScreenAvailable = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);
  const bigScreenLabel = i18n.language.startsWith('ru') ? 'Большой экран' : '大屏';

  const templates = query.data?.templates || [];
  const selectedTemplate = useMemo(() => {
    if (!templates.length) return undefined;
    return templates.find(item => item.templateKey === selectedKey) || templates[0];
  }, [selectedKey, templates]);
  const visibleTemplateComponents = selectedTemplate?.config?.components || [];

  useEffect(() => {
    setLayoutDrafts({});
    setLayoutOrder([]);
    setDraggingComponentId(undefined);
    setResizingComponentId(undefined);
    setLayoutEditing(false);
    setSelectedComponentId(undefined);
  }, [selectedTemplate?.templateKey]);

  useEffect(() => () => cleanupResizeRef.current?.(), []);

  const catalogByKey = useMemo(() => {
    const map = new Map<string, KpiDefinition>();
    (query.data?.kpiCatalog || []).forEach(item => map.set(item.key, item));
    return map;
  }, [query.data?.kpiCatalog]);

  const componentCatalogByKey = useMemo(() => {
    const map = new Map<string, ComponentDefinition>();
    (query.data?.componentCatalog || []).forEach(item => map.set(item.key, item));
    fallbackComponentDefinitions.forEach(item => {
      if (!map.has(item.key)) map.set(item.key, item);
    });
    return map;
  }, [query.data?.componentCatalog]);

  const updateComponentLayout = (componentId: string, patch: LayoutDraft) => {
    setLayoutDrafts((previous) => ({
      ...previous,
      [componentId]: {
        ...(previous[componentId] || {}),
        ...patch,
      },
    }));
  };

  const cancelLayoutEdit = () => {
    setLayoutDrafts({});
    setLayoutOrder([]);
    setDraggingComponentId(undefined);
    setResizingComponentId(undefined);
    setSelectedComponentId(undefined);
    setLayoutEditing(false);
  };

  const scheduleViewportResize = () => {
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setBigScreen(document.fullscreenElement === bigScreenRef.current);
      scheduleViewportResize();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement === bigScreenRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const enterBigScreen = async () => {
    if (!bigScreenRef.current || !document.fullscreenEnabled) return;
    if (layoutEditing) cancelLayoutEdit();
    await bigScreenRef.current.requestFullscreen();
  };

  const saveLayout = async () => {
    if (!selectedTemplate) return;
    setSavingLayout(true);
    try {
      let sourceTemplate = selectedTemplate;
      try {
        const overview = await getManagementOverview();
        sourceTemplate = overview.templates.find((item) => item.templateKey === selectedTemplate.templateKey) || selectedTemplate;
      } catch {
        sourceTemplate = selectedTemplate;
      }
      let nextComponents = (sourceTemplate.config?.components || []).map((component) => {
        const draft = layoutDrafts[component.id];
        if (!draft) return component;
        const merged = { ...component, ...draft };
        const definition = resolveComponentDefinition(merged, componentCatalogByKey);
        const type = resolvedComponentType(merged, definition);
        const span = componentSpan(merged, definition, fallbackSpanForType(type));
        const widthPercent = componentWidthPercent(merged, type, span);
        return {
          ...component,
          span: spanFromWidthPercent(widthPercent, type),
          widthPercent,
          height: componentHeight(merged, type),
        };
      });
      if (isOrderChanged(visibleTemplateComponents, layoutOrder)) {
        const visibleOrder = applyComponentOrder(visibleTemplateComponents, layoutOrder).map(component => component.id);
        const orderRank = new Map(visibleOrder.map((id, index) => [id, index]));
        nextComponents = nextComponents
          .map((component, index) => ({ component, index }))
          .sort((left, right) => {
            const leftRank = orderRank.get(left.component.id);
            const rightRank = orderRank.get(right.component.id);
            if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
            if (leftRank !== undefined) return -1;
            if (rightRank !== undefined) return 1;
            return left.index - right.index;
          })
          .map(item => item.component);
      }
      await saveCockpitTemplate({
        ...sourceTemplate,
        config: {
          ...(sourceTemplate.config || { components: [] }),
          components: nextComponents,
        },
      });
      message.success(t('common.saved'));
      setLayoutDrafts({});
      setLayoutOrder([]);
      setDraggingComponentId(undefined);
      setResizingComponentId(undefined);
      setSelectedComponentId(undefined);
      setLayoutEditing(false);
      queryClient.invalidateQueries({ queryKey: ['cockpit'] });
      query.refetch();
    } catch (error) {
      message.error((error as Error).message || t('common.saveFailed'));
    } finally {
      setSavingLayout(false);
    }
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, component: CockpitComponent, widthPercent: number, height: number, type: CockpitComponent['type']) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupResizeRef.current?.();
    setResizingComponentId(component.id);
    setSelectedComponentId(component.id);
    const gridElement = event.currentTarget.closest('.kpi-grid');
    const componentElement = event.currentTarget.closest('.cockpit-layout-editable');
    const gridWidth = gridElement?.getBoundingClientRect().width || window.innerWidth;
    const componentWidth = componentElement?.getBoundingClientRect().width || (gridWidth * widthPercent) / 100;
    const start = {
      x: event.clientX,
      y: event.clientY,
      widthPercent,
      height,
      pixelWidth: componentWidth,
      gridWidth,
    };
    const onMove = (moveEvent: PointerEvent) => {
      const nextPixelWidth = Math.max(componentMinPixelWidth(type), start.pixelWidth + moveEvent.clientX - start.x);
      const nextWidthPercent = boundedPercent((nextPixelWidth / start.gridWidth) * 100, start.widthPercent, componentMinWidthPercent(type), componentWidthPercentMax);
      const nextHeight = boundedNumber(start.height + moveEvent.clientY - start.y, start.height, componentMinHeight(type), componentHeightMax);
      updateComponentLayout(component.id, { widthPercent: nextWidthPercent, span: spanFromWidthPercent(nextWidthPercent, type), height: nextHeight });
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      cleanupResizeRef.current = null;
      setResizingComponentId(undefined);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    cleanupResizeRef.current = onEnd;
  };

  const moveComponentTo = (dragId: string, targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setLayoutOrder((previous) => {
      const baseOrder = (previous.length ? applyComponentOrder(visibleTemplateComponents, previous) : visibleTemplateComponents).map(component => component.id);
      const nextOrder = baseOrder.filter(id => id !== dragId);
      const targetIndex = nextOrder.indexOf(targetId);
      if (targetIndex < 0) return baseOrder;
      nextOrder.splice(targetIndex, 0, dragId);
      return nextOrder;
    });
  };

  const moveComponentToEnd = (dragId: string) => {
    if (!dragId) return;
    setLayoutOrder((previous) => {
      const baseOrder = (previous.length ? applyComponentOrder(visibleTemplateComponents, previous) : visibleTemplateComponents).map(component => component.id);
      return [...baseOrder.filter(id => id !== dragId), dragId];
    });
  };

  const startComponentDrag = (event: ReactDragEvent<HTMLElement>, componentId: string) => {
    if (!layoutEditing || !isAdmin) return;
    if (resizingComponentId) {
      event.preventDefault();
      return;
    }
    setDraggingComponentId(componentId);
    setSelectedComponentId(componentId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', componentId);
  };

  const dragOverComponent = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    if (!layoutEditing || !isAdmin) return;
    const dragId = draggingComponentId || event.dataTransfer.getData('text/plain');
    if (!dragId || dragId === targetId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    moveComponentTo(dragId, targetId);
  };

  const finishComponentDrag = () => {
    setDraggingComponentId(undefined);
  };

  const dragOverGrid = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!layoutEditing || !isAdmin) return;
    const dragId = draggingComponentId || event.dataTransfer.getData('text/plain');
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const dropOnGrid = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!layoutEditing || !isAdmin) return;
    const dragId = draggingComponentId || event.dataTransfer.getData('text/plain');
    if (!dragId) return;
    event.preventDefault();
    moveComponentToEnd(dragId);
    finishComponentDrag();
  };

  const renderLayoutFrame = (component: CockpitComponent, span: number, widthPercent: number, height: number, type: CockpitComponent['type'], content: ReactNode) => {
    const editable = layoutEditing && isAdmin;
    const selected = selectedComponentId === component.id;
    const dragging = draggingComponentId === component.id;
    const resizing = resizingComponentId === component.id;
    return (
      <div
        className={['cockpit-layout-editable', editable ? 'is-editing' : '', selected ? 'is-selected' : '', dragging ? 'is-dragging' : '', resizing ? 'is-resizing' : ''].filter(Boolean).join(' ')}
        style={cardHeightStyle(height, span, widthPercent)}
        title={editable ? t('cockpit.moveComponent') : undefined}
        onDragOver={editable ? (event) => dragOverComponent(event, component.id) : undefined}
        onDrop={editable ? (event) => {
          event.stopPropagation();
          finishComponentDrag();
        } : undefined}
        onDragEnd={editable ? finishComponentDrag : undefined}
        onClick={editable ? (event) => {
          event.stopPropagation();
          setSelectedComponentId(component.id);
        } : undefined}
      >
      {content}
        {editable && (
          <>
            <button
              type="button"
              className="cockpit-move-handle"
              draggable
              aria-label={t('cockpit.moveComponent')}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => startComponentDrag(event, component.id)}
              onDragEnd={finishComponentDrag}
            >
              <HolderOutlined />
            </button>
            <button
              type="button"
              className="cockpit-resize-handle"
              aria-label={t('cockpit.resizeComponent')}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => startResize(event, component, widthPercent, height, type)}
            >
              <ArrowsAltOutlined />
            </button>
          </>
        )}
      </div>
    );
  };

  const renderComponent = (component: CockpitComponent) => {
    const componentDefinition = resolveComponentDefinition(component, componentCatalogByKey);
    const type = resolvedComponentType(component, componentDefinition);
    const metricKey = component.metricKey || componentDefinition?.metricKey;
    const dataKey = component.dataKey || componentDefinition?.dataKey;
    const definition = metricKey ? catalogByKey.get(metricKey) : undefined;
    const title = componentTitle(component, componentDefinition, definition, i18n.language);
    const data = dataKey ? query.data?.componentData?.[dataKey] : undefined;
    const span = componentSpan(component, componentDefinition, fallbackSpanForType(type));
    const widthPercent = componentWidthPercent(component, type, span);
    const height = componentHeight(component, type, type === 'trend' ? 360 : type === 'ranking' || type === 'structure' ? 340 : undefined);

    if (type === 'retail_alert') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <RetailAlertPanel data={query.data?.retailAlert} style={cardHeightStyle(height, span, widthPercent)} />
          ))}
        </Col>
      );
    }
    if (type === 'trend') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <ChartCard title={title} option={trendOption(data, i18n.language)} height={height} />
          ))}
        </Col>
      );
    }
    if (type === 'ranking') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <ChartCard title={title} option={rankingOption(data, i18n.language)} height={height} />
          ))}
        </Col>
      );
    }
    if (type === 'structure') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <ChartCard title={title} option={structureOption(data, i18n.language)} height={height} />
          ))}
        </Col>
      );
    }
    if (type === 'exchange') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <ExchangePanel title={title} data={data} style={cardHeightStyle(height, span, widthPercent)} />
          ))}
        </Col>
      );
    }
    if (type === 'market_watch') {
      return (
        <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
          {renderLayoutFrame(component, span, widthPercent, height, type, (
            <MarketWatchPanel title={title} data={data} style={cardHeightStyle(height, span, widthPercent)} />
          ))}
        </Col>
      );
    }
    const metric = metricKey ? query.data?.metrics?.[metricKey] : undefined;
    const targetRoute = routeForCockpitKpi(definition, metricKey);
    const kpiDisplay = cockpitKpiDisplay(definition, metricKey, metric?.value ?? 0, i18n.language);
    const secondaryDisplay = cockpitSecondaryDisplay(metric, i18n.language);
    const compareItems = metricCompareItems(metric, definition, i18n.language);
    return (
      <Col key={component.id} {...cockpitColProps(widthPercent, height, type, layoutEditing && isAdmin)}>
        {renderLayoutFrame(component, span, widthPercent, height, type, (
          <CockpitKpiPanel
            title={title}
            value={kpiDisplay.value}
            suffix={kpiDisplay.suffix}
            precision={kpiDisplay.precision}
            secondaryValue={secondaryDisplay.value}
            secondarySuffix={secondaryDisplay.suffix}
            secondaryPrecision={secondaryDisplay.precision}
            secondaryLabel={secondaryMetricLabel(metric, i18n.language)}
            compare={compareItems}
            tone={toneFor(definition, metric?.value)}
            valueColor={cockpitKpiValueColor(definition, metricKey)}
            tooltip={metric?.updatedAt ? `${t('common.updated')}: ${metric.updatedAt}` : undefined}
            style={cardHeightStyle(height, span, widthPercent)}
            onClick={!layoutEditing && targetRoute ? () => navigate(targetRoute) : undefined}
          />
        ))}
      </Col>
    );
  };

  if (query.isLoading) return <PageState status="loading" />;
  if (query.error) return <PageState status="error" description={(query.error as Error).message} onRetry={() => query.refetch()} />;

  if (!selectedTemplate) {
    return <Card title={t('nav.visualCockpit')}><Empty description={t('cockpit.noTemplate')} /></Card>;
  }

  const components = visibleTemplateComponents;
  const hasLayoutChanges = Object.keys(layoutDrafts).length > 0 || isOrderChanged(components, layoutOrder);
  const componentsWithLayout = applyComponentOrder(components, layoutOrder).map((component) => ({
    ...component,
    ...(layoutDrafts[component.id] || {}),
  }));

  return (
    <div ref={bigScreenRef} className={['cockpit-page', bigScreen ? 'is-big-screen' : ''].filter(Boolean).join(' ')}>
      <Row justify="space-between" className="page-toolbar">
        <Col>
          <h2>{t('nav.visualCockpit')}</h2>
          <Text type="secondary">{templateTitle(selectedTemplate, i18n.language)}</Text>
        </Col>
        <Col>
          <Space wrap className="cockpit-toolbar-actions">
            <Select
              value={selectedTemplate.templateKey}
              onChange={setSelectedKey}
              style={{ width: 220 }}
              options={templates.map(item => ({ value: item.templateKey, label: templateTitle(item, i18n.language) }))}
            />
            {bigScreenAvailable && (
              <Button icon={<FullscreenOutlined />} onClick={enterBigScreen}>
                {bigScreenLabel}
              </Button>
            )}
            {isAdmin && (
              layoutEditing ? (
                <>
                  <Button icon={<SaveOutlined />} type="primary" loading={savingLayout} disabled={!hasLayoutChanges} onClick={saveLayout}>
                    {t('cockpit.saveLayout')}
                  </Button>
                  <Button icon={<CloseOutlined />} onClick={cancelLayoutEdit}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <Button icon={<EditOutlined />} onClick={() => setLayoutEditing(true)}>
                    {t('cockpit.editLayout')}
                  </Button>
                  <Button icon={<SettingOutlined />} onClick={() => navigate('/management-center')}>
                    {t('cockpit.configure')}
                  </Button>
                </>
              )
            )}
          </Space>
        </Col>
      </Row>
      {componentsWithLayout.length ? (
        <div
          className={['kpi-grid', 'cockpit-dense-grid', layoutEditing && isAdmin ? 'is-editing' : ''].filter(Boolean).join(' ')}
          onDragOver={layoutEditing && isAdmin ? dragOverGrid : undefined}
          onDrop={layoutEditing && isAdmin ? dropOnGrid : undefined}
        >
          {componentsWithLayout.map(renderComponent)}
        </div>
      ) : (
        <Card><Empty description={t('cockpit.emptyTemplate')} /></Card>
      )}
    </div>
  );
}
