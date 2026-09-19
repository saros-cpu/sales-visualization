export const RETAIL_DATA_START_YEAR = 2023;

export function numericMetric(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export const metricNumber = numericMetric;

export function fallbackRetailYears(currentYear = new Date().getFullYear()) {
  const latestYear = Math.max(currentYear, RETAIL_DATA_START_YEAR);
  return Array.from(
    { length: latestYear - RETAIL_DATA_START_YEAR + 1 },
    (_, index) => latestYear - index,
  );
}

export function normalizeRetailYears(values, currentYear = new Date().getFullYear()) {
  const years = Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= RETAIL_DATA_START_YEAR),
  )).sort((a, b) => b - a);
  return years.length ? years : fallbackRetailYears(currentYear);
}

export function normalizeRetailMonthOptions(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => (typeof item === 'string' ? { month: item } : item))
    .filter((item) => typeof item?.month === 'string' && /^\d{4}-\d{2}$/.test(item.month))
    .sort((left, right) => right.month.localeCompare(left.month));
}

export function latestRetailMonthForYear(items, year) {
  const prefix = `${year}-`;
  return normalizeRetailMonthOptions(items).find((item) => item.month.startsWith(prefix))?.month || null;
}

export function preferredRetailMonth(items, preferred, fallback = '') {
  const options = normalizeRetailMonthOptions(items);
  if (preferred && options.some((item) => item.month === preferred)) return preferred;
  return options[0]?.month || fallback;
}

export function defaultRetailMonth(today = new Date()) {
  const day = new Date(today);
  day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
}

export function retailTonsOf(item) {
  if (!item || typeof item !== 'object') return 0;
  const row = item;
  const tons = numericMetric(
    row.totalTons
      ?? row.tons
      ?? row.latestMonthTons
      ?? row.totalEndInventoryTons
      ?? row.endInventoryTons,
  );
  if (tons > 0) return tons;
  const mass = numericMetric(row.totalWeightKg ?? row.mass ?? row.latestMonthMass);
  return mass > 0 ? mass / 1000 : 0;
}

export function retailCnyAmountOf(item) {
  if (!item || typeof item !== 'object') return null;
  const row = item;
  for (const key of ['totalSalesCnyAvg', 'totalAmountCnyAvg', 'amountCnyAvg', 'totalSalesCny', 'amountCny']) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  const avg = numericMetric(row.avgCnyKgs);
  const amount = numericMetric(row.totalSales ?? row.totalAmount ?? row.amount);
  return avg > 0 ? amount / avg : null;
}

function resolveLocale(language) {
  return String(language || '').startsWith('ru') ? 'ru-RU' : 'zh-CN';
}

function compactNumber(value, divisor, maximumFractionDigits, locale) {
  return (numericMetric(value) / divisor).toLocaleString(locale, { maximumFractionDigits });
}

function joinKpiParts(parts, language) {
  return resolveLocale(language) === 'ru-RU' ? `${parts.value} ${parts.unit}` : `${parts.value}${parts.unit}`;
}

export function formatRetailLitersKpiParts(value, language) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 1000) {
      return { value: (numeric / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }), unit: 'тыс. л' };
    }
    return { value: numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 }), unit: 'л' };
  }
  if (Math.abs(numeric) >= 10000) {
    return { value: compactNumber(numeric, 10000, 1, 'zh-CN'), unit: '万L' };
  }
  return { value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: 'L' };
}

export function formatRetailLitersKpi(value, language) {
  return joinKpiParts(formatRetailLitersKpiParts(value, language), language);
}

export function formatRetailSomKpiParts(value, language) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 100000000) {
      return { value: compactNumber(numeric, 100000000, 2, 'ru-RU'), unit: 'млрд сом' };
    }
    if (Math.abs(numeric) >= 1000000) {
      return { value: compactNumber(numeric, 1000000, 1, 'ru-RU'), unit: 'млн сом' };
    }
    return { value: numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 }), unit: 'сом' };
  }
  if (Math.abs(numeric) >= 100000000) {
    return { value: compactNumber(numeric, 100000000, 2, 'zh-CN'), unit: '亿索姆' };
  }
  if (Math.abs(numeric) >= 10000) {
    return { value: compactNumber(numeric, 10000, 1, 'zh-CN'), unit: '万索姆' };
  }
  return { value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: '索姆' };
}

export function formatRetailSomKpi(value, language) {
  return joinKpiParts(formatRetailSomKpiParts(value, language), language);
}

export function formatRetailCnyKpi(value, language) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 1000000) {
      return `${compactNumber(numeric, 1000000, 1, 'ru-RU')} млн ¥`;
    }
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ¥`;
  }
  if (Math.abs(numeric) >= 100000000) {
    return `${compactNumber(numeric, 100000000, 2, 'zh-CN')}亿元`;
  }
  if (Math.abs(numeric) >= 10000) {
    return `${compactNumber(numeric, 10000, 1, 'zh-CN')}万元`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}元`;
}

export function formatRetailTonsKpi(value, language) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} т`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}吨`;
}

export function formatRetailTons(value, digits = 3, language) {
  const locale = resolveLocale(language);
  return numericMetric(value).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function splitRetailStationName(name, short) {
  const cjkRe = /[\u3400-\u9fff]/;
  const cyrillicRe = /[\u0400-\u052f]/;
  const split = (value) => String(value || '')
    .split(/\s*(?:\r?\n|\/|\uff0f|\|)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set();
  const parts = [...split(name), ...split(short)].filter((part) => {
    if (seen.has(part)) return false;
    seen.add(part);
    return true;
  });
  const zh = parts.find((part) => cjkRe.test(part));
  const ru = parts.find((part) => cyrillicRe.test(part));
  const primary = zh || parts[0] || '-';
  const secondary = ru && ru !== primary ? ru : (parts.find((part) => part !== primary) || '');
  return {
    primary,
    secondary,
    title: secondary ? `${primary} / ${secondary}` : primary,
  };
}

export function sortRankingRows(rows, valueOf, limit) {
  const sorted = [...(rows || [])].sort((left, right) => numericMetric(valueOf(right)) - numericMetric(valueOf(left)));
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

/**
 * 自用油「按当前展示记录实算」的汇总口径。
 *
 * 桌面端/Web 端自用油页顶部（或汇总区）此前固定读接口返回的整区间 summary，
 * 按车牌筛选后条数、升数、吨位、金额、质量却不跟着变。现在双端统一在这里实算：
 * 未输入车牌时结果与接口整区间 summary 一致，输入车牌后按筛选后的记录汇总。
 */
export function summarizeSelfUseRecords(records) {
  let volume = 0;
  let weightKg = 0;
  let amount = 0;
  let count = 0;
  for (const row of Array.isArray(records) ? records : []) {
    count += 1;
    volume += numericMetric(row?.volume);
    weightKg += numericMetric(row?.totalWeightKg ?? row?.mass ?? row?.weightKg);
    amount += numericMetric(row?.amount);
  }
  const round = (value, digits) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };
  return {
    totalRecords: count,
    totalVolume: round(volume, 2),
    totalWeightKg: round(weightKg, 2),
    totalTons: round(weightKg / 1000, 3),
    totalAmount: round(amount, 2),
  };
}
