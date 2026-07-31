// 零售模块共享工具和常量
import {
  RETAIL_DATA_START_YEAR,
  fallbackRetailYears,
  formatRetailCnyKpi as sharedFormatRetailCnyKpi,
  formatRetailLitersKpiParts as sharedFormatRetailLitersKpiParts,
  formatRetailSomKpiParts as sharedFormatRetailSomKpiParts,
  formatRetailTonsKpi as sharedFormatRetailTonsKpi,
  latestRetailMonthForYear,
  metricNumber,
  normalizeRetailMonthOptions,
  normalizeRetailYears,
  preferredRetailMonth,
  retailCnyAmountOf,
  retailTonsOf,
  sortRankingRows,
  splitRetailStationName,
} from '@shared/retail-core';

export {
  RETAIL_DATA_START_YEAR,
  fallbackRetailYears,
  latestRetailMonthForYear,
  metricNumber,
  normalizeRetailMonthOptions,
  normalizeRetailYears,
  preferredRetailMonth,
  retailTonsOf,
  sortRankingRows,
};

export const REGION_COLORS = {
  REG-06: '#00d4ff',
  REG-07: '#ff6b6b',
  REG-01: '#00e5a0',
  REG-02: '#ef5350',
  CTY-20: '#ab47bc',
  REG-04: '#a78bfa',
  REG-05: '#ffa726',
  CTY-19: '#26c6da',
  REG-03: '#66bb6a',
};

export const REGION_ORDER = ['REG-02', 'REG-01', 'REG-04', 'REG-05', 'REG-06', 'REG-03'];

export const RETAIL_NAV = [
  { key: 'dashboard', label: '总览', path: '/retail' },
  { key: 'region', label: '区域', path: '/retail/region' },
  { key: 'station', label: '站点', path: '/retail/station' },
  { key: 'monthly', label: '月度', path: '/retail/monthly' },
  { key: 'resource', label: '油品', path: '/retail/resource' },
  { key: 'selfUse', label: '自用油', path: '/retail/self-use' },
  { key: 'profit', label: '利润', path: '/retail/profit' },
  { key: 'report', label: '报表', path: '/retail/report' },
  { key: 'alert', label: '预警', path: '/retail/alert', badge: true },
];

export function formatRetailMonthLabel(month, fallback = '选择月份') {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return month || fallback;
  return `${match[1]}年${Number(match[2])}月`;
}

export function splitStationName(name, short) {
  return splitRetailStationName(name, short);
}

export function fmtNum(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + '万';
  return sign + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function numberFormat(n) {
  if (n == null || isNaN(n)) return '0.00';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + '万';
  return sign + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function volumeFormat(n) {
  if (n == null || isNaN(n)) return '0.00';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + '万';
  return sign + abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtWanLiters(n, digits = 2) {
  if (n == null) return '—';
  return (n / 1e4).toFixed(digits);
}

export function fmtLiters(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

export function pctColor(v) {
  if (v == null) return 'rgba(160,180,210,0.6)';
  return v > 0 ? '#00e5a0' : v < 0 ? '#ef5350' : 'rgba(160,180,210,0.6)';
}

export function formatSomKpiParts(value) {
  return sharedFormatRetailSomKpiParts(value);
}

export function formatLitersKpiParts(value) {
  return sharedFormatRetailLitersKpiParts(value);
}

export function formatCnyKpi(value) {
  return sharedFormatRetailCnyKpi(value);
}

export function formatTonsKpi(value) {
  return sharedFormatRetailTonsKpi(value);
}

export function amountCnyOf(item) {
  return retailCnyAmountOf(item);
}

export function buildResourceRank(resources) {
  const merged = new Map();
  (resources || [])
    .filter((row) => !String(row.name || '').startsWith('Other'))
    .forEach((row) => {
      const rawKey = Number(row.resourceKey ?? row.key);
      const rankKey = rawKey === 109 ? 106 : rawKey;
      const existing = merged.get(rankKey) || {
        resourceKey: rankKey,
        name: rankKey === 106 ? 'Д/Т' : row.name,
        volume: 0,
        amount: 0,
        color: row.color,
      };
      existing.volume += Number(row.volume || 0);
      existing.amount += Number(row.amount || 0);
      merged.set(rankKey, existing);
    });
  return sortRankingRows(Array.from(merged.values()), (row) => row.amount);
}

export function useClock() {
  const getTime = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return {
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
      date: `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${days[now.getDay()]}`,
    };
  };
  return getTime;
}
