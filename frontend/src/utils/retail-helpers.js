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
  return Array.from(merged.values()).sort((a, b) => b.amount - a.amount);
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
