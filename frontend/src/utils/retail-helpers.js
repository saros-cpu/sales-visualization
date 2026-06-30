// src/utils/retail-helpers.js — 零售模块共享工具和常量

// ── 区域常量 ──
export const REGION_COLORS = {
  'REG-06': '#00d4ff',
  'REG-07': '#ff6b6b', // 预留(暂无数据)
  'REG-01': '#00e5a0',
  'REG-02': '#ef5350',
  'CTY-20': '#ab47bc', // 预留(暂无数据)
  'REG-04': '#a78bfa',
  'REG-05': '#ffa726',
  'CTY-19': '#26c6da', // 预留(暂无数据)
  'REG-03': '#66bb6a',
};

export const REGION_ORDER = ['REG-02', 'REG-01', 'REG-04', 'REG-05', 'REG-06', 'REG-03'];

// ── 导航Tab ──
export const RETAIL_NAV = [
  { key: 'dashboard', label: '📊 总览', path: '/retail' },
  { key: 'region', label: '🗺️ 区域', path: '/retail/region' },
  { key: 'station', label: '⛽ 站点', path: '/retail/station' },
  { key: 'monthly', label: '📅 月度', path: '/retail/monthly' },
  { key: 'resource', label: '🛢️ 油品', path: '/retail/resource' },
  { key: 'report', label: '📋 报表', path: '/retail/report' },
  { key: 'alert', label: '⚠️ 预警', path: '/retail/alert', badge: true },
];

// ── 格式化函数 ──
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

export function metricNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compactNumber(value, divisor, maximumFractionDigits) {
  return (metricNumber(value) / divisor).toLocaleString('zh-CN', {
    maximumFractionDigits,
  });
}

export function formatSomKpiParts(value) {
  const numeric = metricNumber(value);
  const abs = Math.abs(numeric);
  if (abs >= 1e8) return { value: compactNumber(numeric, 1e8, 2), unit: '亿索姆' };
  if (abs >= 1e4) return { value: compactNumber(numeric, 1e4, 1), unit: '万索姆' };
  return {
    value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
    unit: '索姆',
  };
}

export function formatLitersKpiParts(value) {
  const numeric = metricNumber(value);
  if (Math.abs(numeric) >= 1e4) return { value: compactNumber(numeric, 1e4, 1), unit: '万L' };
  return {
    value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
    unit: 'L',
  };
}

export function formatCnyKpi(value) {
  if (value == null || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const abs = Math.abs(numeric);
  if (abs >= 1e8) return `${compactNumber(numeric, 1e8, 2)} 亿元`;
  if (abs >= 1e4) return `${compactNumber(numeric, 1e4, 1)} 万元`;
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 元`;
}

export function formatTonsKpi(value) {
  return `${metricNumber(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 吨`;
}

export function amountCnyOf(item) {
  if (!item || typeof item !== 'object') return null;
  const keys = ['totalSalesCnyAvg', 'totalAmountCnyAvg', 'amountCnyAvg', 'totalSalesCny', 'amountCny'];
  for (const key of keys) {
    if (item[key] != null && item[key] !== '') {
      const numeric = Number(item[key]);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  const avg = Number(item.avgCnyKgs || 0);
  const amount = Number(item.totalSales ?? item.totalAmount ?? item.amount ?? 0);
  if (avg > 0 && Number.isFinite(amount)) return amount / avg;
  return null;
}

export function sortRankingRows(rows, valueOf, limit) {
  const sorted = [...(rows || [])].sort((left, right) => metricNumber(valueOf(right)) - metricNumber(valueOf(left)));
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

// ── 油品合并排行（dashboard用） ──
export function buildResourceRank(resources) {
  const merged = new Map();
  (resources || [])
    .filter(r => !String(r.name || '').startsWith('Other'))
    .forEach(r => {
      const rawKey = Number(r.resourceKey ?? r.key);
      const rankKey = rawKey === 109 ? 106 : rawKey;
      const existing = merged.get(rankKey) || {
        resourceKey: rankKey,
        name: rankKey === 106 ? 'Д/Т' : r.name,
        volume: 0,
        amount: 0,
        color: r.color,
      };
      existing.volume += Number(r.volume || 0);
      existing.amount += Number(r.amount || 0);
      merged.set(rankKey, existing);
    });
  return sortRankingRows(Array.from(merged.values()), row => row.amount);
}

// ── 时钟 hook ──
export function useClock() {
  const getTime = () => {
    const n = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return {
      time: `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`,
      date: `${n.getFullYear()}年${pad(n.getMonth() + 1)}月${pad(n.getDate())}日 星期${days[n.getDay()]}`,
    };
  };
  return getTime;
}
