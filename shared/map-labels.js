// Map point name + status bilingual localization.
// Shared by wallpaper, desktop client, and web map surfaces so all three
// produce identical Chinese/Russian labels from one source of truth.

export const STATUS_LABELS = {
  zh: {
    operating: '在营',
    closed: '停业',
    renovation: '装修',
    maintenance: '维修中',
    attention: '关注',
    abnormal: '异常',
  },
  ru: {
    operating: 'Работает',
    closed: 'Закрыта',
    renovation: 'На ремонте',
    maintenance: 'На обслуживании',
    attention: 'Внимание',
    abnormal: 'Неисправность',
  },
};

// Depot (油库) operational-status labels. zh/ru only (Kyrgyz out of scope).
export const DEPOT_STATUS_LABELS = {
  zh: {
    operating: '在营',
    stopped: '停用',
    building: '在建',
  },
  ru: {
    operating: 'Работает',
    stopped: 'Остановлен',
    building: 'Строится',
  },
};

export function depotStatusKey(entry) {
  const statusText = String(entry?.status ?? '').trim().toLowerCase();
  const reason = String(entry?.closedReason ?? '').trim();
  const combined = `${statusText} ${reason}`.toLowerCase();
  if (reason.includes('装修') || /(renovation|construction|building|decorat|стро)/.test(combined)) return 'building';
  if (statusText === 'closed' || reason.includes('停业') || /(closed|stopped|suspended|inactive)/.test(combined)) return 'stopped';
  if (['normal', 'open', 'active', 'operating', 'online'].includes(statusText)) return 'operating';
  return 'operating';
}

export function depotStatusLabel(key, lang, fallback) {
  const table = DEPOT_STATUS_LABELS[lang === 'ru' ? 'ru' : 'zh'];
  if (key && table[key] != null) return table[key];
  return fallback != null ? fallback : '';
}

// Normalize an arbitrary status/statusLabel/closedReason triple into a
// canonical key. Handles Chinese labels, English codes, and raw API strings.
export function statusKey(status, statusLabel, closedReason) {
  const rawLabel = String(statusLabel ?? '').trim();
  const statusText = String(status ?? '').trim().toLowerCase();
  const reason = String(closedReason ?? '').trim();
  const combined = `${rawLabel} ${statusText} ${reason}`.toLowerCase();

  if (rawLabel.includes('装修') || reason.includes('装修') || /(renovation|construction|decorat)/.test(combined)) return 'renovation';
  if (rawLabel.includes('维修') || /(repair|servicing)/.test(combined)) return 'maintenance';
  if (rawLabel.includes('停业') || reason.includes('停业') || /(closed|stopped|suspended|inactive)/.test(combined)) return 'closed';
  if (rawLabel === '在营' || rawLabel === '正常' || rawLabel === '正常营业') return 'operating';
  if (rawLabel === '关注' || rawLabel === '预警') return 'attention';
  if (rawLabel === '异常') return 'abnormal';
  if (['normal', 'open', 'active', 'operating', 'online'].includes(statusText)) return 'operating';
  if (['warning', 'warn', 'attention'].includes(statusText)) return 'attention';
  if (rawLabel && !['normal', 'closed', 'warning', 'warn'].includes(rawLabel.toLowerCase())) return 'unknown';
  if (statusText && statusText !== 'normal') return 'abnormal';
  return 'operating';
}

export function statusLabelFor(key, lang, fallback) {
  const table = STATUS_LABELS[lang === 'ru' ? 'ru' : 'zh'];
  if (key && table[key] != null) return table[key];
  return fallback != null ? fallback : '';
}

// Return a copy of the point with `name`, `short`, `label`, and `statusLabel`
// localized for the requested language. Depots get their operational status
// (在营/停用/在建) appended to the label. Never throws on missing fields.
export function localizeMapPoint(point, lang) {
  const l = lang === 'ru' ? 'ru' : 'zh';
  const isDepot = point.type === 'depot';
  const key = isDepot
    ? depotStatusKey(point)
    : statusKey(point.status, point.statusLabel, point.closedReason);
  const statusLabel = isDepot
    ? depotStatusLabel(key, l, point.statusLabel)
    : statusLabelFor(key, l, point.statusLabel);
  const name = l === 'ru'
    ? (point.nameRu || point.short || point.name || '')
    : (point.name || '');
  const short = l === 'ru'
    ? (point.short || point.nameRu || point.name || '')
    : (point.short || point.name || '');
  const label = isDepot
    ? (name && statusLabel ? `${name} · ${statusLabel}` : (name || statusLabel || ''))
    : name;
  return {
    ...point,
    name,
    short,
    label,
    statusLabel,
  };
}
