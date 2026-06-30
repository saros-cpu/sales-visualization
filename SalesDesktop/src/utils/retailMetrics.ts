export function numericMetric(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function retailTonsOf(item: unknown) {
  if (!item || typeof item !== 'object') return 0;
  const row = item as Record<string, unknown>;
  const tons = numericMetric(row.totalTons ?? row.tons ?? row.latestMonthTons ?? row.totalEndInventoryTons ?? row.endInventoryTons);
  if (tons > 0) return tons;
  const mass = numericMetric(row.totalWeightKg ?? row.mass ?? row.latestMonthMass);
  return mass > 0 ? mass / 1000 : 0;
}

export function formatRetailTons(value: unknown, digits = 3) {
  return numericMetric(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function resolveLocale(language?: string) {
  return language?.startsWith('ru') ? 'ru-RU' : 'zh-CN';
}

export function retailCnyAmountOf(item: unknown) {
  if (!item || typeof item !== 'object') return null;
  const row = item as Record<string, unknown>;
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

export function formatRetailLitersKpi(value: unknown, language?: string) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 1000) {
      return `${(numeric / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} тыс. л`;
    }
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} л`;
  }
  if (Math.abs(numeric) >= 10000) {
    return `${(numeric / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万L`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} L`;
}

export function formatRetailSomKpi(value: unknown, language?: string) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 100000000) {
      return `${(numeric / 100000000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млрд сом`;
    }
    if (Math.abs(numeric) >= 1000000) {
      return `${(numeric / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн сом`;
    }
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} сом`;
  }
  if (Math.abs(numeric) >= 100000000) {
    return `${(numeric / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿索姆`;
  }
  if (Math.abs(numeric) >= 10000) {
    return `${(numeric / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万索姆`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 索姆`;
}

export function formatRetailCnyKpi(value: unknown, language?: string) {
  if (value === null || value === undefined || value === '') return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 1000000) {
      return `${(numeric / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ¥`;
    }
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ¥`;
  }
  if (Math.abs(numeric) >= 100000000) {
    return `${(numeric / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元`;
  }
  if (Math.abs(numeric) >= 10000) {
    return `${(numeric / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万元`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 元`;
}

export function formatRetailTonsKpi(value: unknown, language?: string) {
  const numeric = numericMetric(value);
  const locale = resolveLocale(language);
  if (locale === 'ru-RU') {
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} т`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 吨`;
}
