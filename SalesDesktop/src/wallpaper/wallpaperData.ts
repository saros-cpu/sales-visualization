export interface WallpaperStation {
  shopKey: number;
  name: string;
  short: string;
  region: string;
  lng?: number;
  lat?: number;
  status?: string;
  statusType?: string;
  statusLabel?: string;
  closedReason?: string;
  statusNote?: string;
  inventory?: number;
  inventoryCapacity?: number;
  inventoryFillPercent?: number;
  inventoryFillStatus?: 'ok' | 'warning' | 'critical' | 'unknown';
  inventoryAlert?: Record<string, unknown>;
  inventoryAlerts?: Array<Record<string, unknown>>;
  inventoryByResource?: Array<{
    name?: string;
    inventory?: number;
    price?: number;
    capacity?: number;
    fillPercent?: number;
    fillStatus?: 'ok' | 'warning' | 'critical' | 'unknown';
  }>;
  inventoryAsOf?: string;
  snapshotGeneratedAt?: string;
}

export interface WallpaperDepot {
  name: string;
  short?: string;
  region?: string;
  lng?: number;
  lat?: number;
  type?: string;
  depotType?: string;
  status?: string;
  statusLabel?: string;
  closedReason?: string;
}

export interface WallpaperPayload {
  source?: string;
  updatedAt?: string;
  snapshotGeneratedAt?: string;
  sensitiveData?: boolean;
  stations?: WallpaperStation[];
  depots?: WallpaperDepot[];
  summary?: {
    stationCount?: number;
    activeStationCount?: number;
    closedStationCount?: number;
    warningStationCount?: number;
    depotCount?: number;
    activeDepotCount?: number;
    inventoryLiters?: number;
    inventoryAlertCount?: number | null;
    inventoryCriticalCount?: number | null;
    inventoryWarningCount?: number | null;
  };
  salesSummary?: {
    year?: number;
    yearStart?: string;
    yearEnd?: string;
    yearEndExclusive?: string;
    yearVolumeLiters?: number;
    yearTons?: number;
    yearAmount?: number;
    yearAmountCny?: number | null;
    yearAvgCnyKgs?: number | null;
    month?: string;
    monthStart?: string;
    monthEnd?: string;
    monthEndExclusive?: string;
    monthVolumeLiters?: number;
    monthTons?: number;
    monthAmount?: number;
    monthAmountCny?: number | null;
    monthAvgCnyKgs?: number | null;
  };
  exchangeSummary?: {
    available?: boolean;
    date?: string | null;
    usdKgs?: number | null;
    cnyKgs?: number | null;
    source?: string;
    isManual?: boolean;
    isToday?: boolean;
  };
  inventoryAlerts?: Array<Record<string, unknown>>;
  inventoryAlertSummary?: Record<string, unknown>;
}

export interface WallpaperLayerOptions {
  showActiveStations?: boolean;
  showClosedStations?: boolean;
  showDepotMarkers?: boolean;
  showInventoryAlertOnly?: boolean;
}

export function normalizeWallpaperPayload(value: any): WallpaperPayload {
  const payload = value?.data && typeof value.data === 'object' ? value.data : value;
  if (!payload || typeof payload !== 'object') {
    return { stations: [], depots: [], summary: {} };
  }
  return {
    ...payload,
    stations: Array.isArray(payload.stations) ? payload.stations : [],
    depots: Array.isArray(payload.depots) ? payload.depots : [],
    summary: payload.summary && typeof payload.summary === 'object' ? payload.summary : {},
  };
}

export function normalizeStatusLabel(status?: string, statusLabel?: string, closedReason?: string) {
  const rawLabel = String(statusLabel || '').trim();
  const statusText = String(status || '').trim();
  const reason = String(closedReason || '').trim();
  const combined = `${rawLabel} ${statusText} ${reason}`.toLowerCase();

  if (rawLabel.includes('装修') || reason.includes('装修') || /(renovation|maintenance|construction|decorat)/.test(combined)) {
    return '装修';
  }
  if (rawLabel.includes('停业') || reason.includes('停业') || /(closed|stopped|suspended|inactive)/.test(combined)) {
    return '停业';
  }
  if (['在营', '正常', '正常营业'].includes(rawLabel)) return '在营';
  if (['关注', '预警'].includes(rawLabel)) return '关注';
  if (rawLabel === '异常') return '异常';

  const key = statusText.toLowerCase() || rawLabel.toLowerCase();
  if (['normal', 'open', 'active', 'operating', 'online'].includes(key)) return '在营';
  if (['warning', 'warn', 'attention'].includes(key)) return '关注';
  if (rawLabel && !['normal', 'closed', 'warning', 'warn'].includes(rawLabel.toLowerCase())) return rawLabel;
  if (key && key !== 'normal') return '异常';
  return '在营';
}

export function stationStatusText(status?: string, statusLabel?: string, closedReason?: string) {
  return normalizeStatusLabel(status, statusLabel, closedReason);
}

export function stationStatusTone(status?: string) {
  if (status === 'closed') return 'danger';
  if (status && status !== 'normal') return 'warn';
  return 'ok';
}

export function alertStations(payload: WallpaperPayload, limit = 6) {
  return (payload.stations || [])
    .filter((item) => item.status && item.status !== 'normal')
    .slice(0, limit);
}

export function topInventoryStations(payload: WallpaperPayload, limit = 6) {
  return (payload.stations || [])
    .filter((item) => Number(item.inventory || 0) > 0)
    .slice()
    .sort((a, b) => Number(b.inventory || 0) - Number(a.inventory || 0))
    .slice(0, limit);
}

const CORE_DEPOTS: WallpaperDepot[] = [
  { name: 'STN-61', short: 'Главная нефтебаза', region: 'REG-01', lng: 0, lat: 0, type: 'headquarters', status: 'normal', statusLabel: '在营' },
  { name: 'DemoDepotNorth', short: 'Север DemoDepot', region: 'REG-08', lng: 0, lat: 0, type: 'depot', status: 'closed', statusLabel: '装修', closedReason: '装修停业' },
  { name: 'DemoDepotSouth', short: 'Юж DemoDepot', region: 'REG-07', lng: 0, lat: 0, type: 'depot', status: 'normal', statusLabel: '在营' },
];

const ZERO_INVENTORY_STATION_KEYS = new Set([11, 12, 21]);

function mapZeroInventoryStation(station: WallpaperStation) {
  if (!ZERO_INVENTORY_STATION_KEYS.has(Number(station.shopKey))) return station;
  const rows = (station.inventoryByResource || []).map((row) => {
    const capacity = Number(row?.capacity || 0);
    return {
      ...row,
      inventory: 0,
      fillPercent: row?.fillPercent !== undefined || capacity > 0 ? 0 : row?.fillPercent,
      fillStatus: capacity > 0 ? 'critical' : (row?.fillStatus || 'unknown'),
    };
  });
  const capacity = Number(station.inventoryCapacity || 0);
  return {
    ...station,
    status: 'closed',
    statusType: 'closed',
    statusLabel: '停业',
    closedReason: station.closedReason || '停业，库存清零',
    inventory: 0,
    inventoryByResource: rows,
    inventoryFillPercent: capacity > 0 ? 0 : station.inventoryFillPercent,
    inventoryFillStatus: capacity > 0 ? 'critical' : (station.inventoryFillStatus || 'unknown'),
    inventoryZeroedByMapRule: true,
    inventoryZeroReason: station.closedReason || '停业，库存清零',
  };
}

function depotKey(depot: WallpaperDepot) {
  const name = String(depot?.name || '');
  if (depot?.type === 'headquarters' || name.includes('总部') || name.includes('公司总部')) return 'hq';
  if (name.includes('北方')) return 'north';
  if (name.includes('南方')) return 'south';
  return name;
}

function ensureCoreDepots(depots: WallpaperDepot[] = []) {
  const list = Array.isArray(depots) ? [...depots] : [];
  const keys = new Set(list.map(depotKey));
  for (const depot of CORE_DEPOTS) {
    if (!keys.has(depotKey(depot))) list.push(depot);
  }
  return list;
}

function hasInventoryAlert(station: WallpaperStation) {
  if (station.inventoryAlert) return true;
  if (Array.isArray(station.inventoryAlerts) && station.inventoryAlerts.length > 0) return true;
  return (station.inventoryByResource || []).some((item) => (
    item.fillStatus === 'critical' || item.fillStatus === 'warning'
  ));
}

export function mapLayers(payload: WallpaperPayload, options: WallpaperLayerOptions = {}) {
  const showActiveStations = options.showActiveStations !== false;
  const showClosedStations = options.showClosedStations !== false;
  const showDepotMarkers = options.showDepotMarkers !== false;
  const inventoryAlertOnly = Boolean(options.showInventoryAlertOnly && payload.sensitiveData);
  return {
    stations: (payload.stations || [])
      .map((station) => mapZeroInventoryStation(station))
      .filter((station) => {
        const isClosed = station.status === 'closed';
        if (isClosed && !showClosedStations) return false;
        if (!isClosed && !showActiveStations) return false;
        if (inventoryAlertOnly && !hasInventoryAlert(station)) return false;
        return true;
      })
      .map((mappedStation) => ({
        ...mappedStation,
        type: 'station',
        statusLabel: normalizeStatusLabel(mappedStation.status, mappedStation.statusLabel, mappedStation.closedReason || mappedStation.statusNote),
        size: mappedStation.status && mappedStation.status !== 'normal' ? 0.36 : 0.28,
        color: mappedStation.status === 'closed' ? '#ef4444' : undefined,
      })),
    depots: showDepotMarkers ? ensureCoreDepots(payload.depots || []).map((depot) => {
      const rawName = String(depot.name || depot.short || '');
      const isHeadquarters = depot.type === 'headquarters' || rawName.includes('总部') || rawName.includes('公司总部');
      const name = rawName === '公司总部' ? 'STN-61' : rawName;
      return {
        ...depot,
        type: 'depot',
        depotType: isHeadquarters ? 'headquarters' : 'branch',
        name,
        label: name,
        status: depot.status || 'normal',
        statusLabel: normalizeStatusLabel(depot.status || 'normal', depot.statusLabel, depot.closedReason),
        size: isHeadquarters ? 0.26 : 0.22,
        y: isHeadquarters ? 3.48 : 3.12,
        renderOrder: 176,
        color: isHeadquarters ? '#38bdf8' : '#facc15',
        anchorColor: isHeadquarters ? '#7dd3fc' : '#fde68a',
        anchorOpacity: 0.78,
        pinLine: true,
        opacity: 0.98,
        hoverScale: 2.25,
        hoverLift: 0.24,
        showLabel: false,
        labelSubtitle: depot.short || depot.region || '',
      };
    }) : [],
    customers: [],
  };
}

function resolveLocale(locale?: string): string {
  if (locale === 'ru') return 'ru-RU';
  return 'zh-CN';
}

export function formatLiters(value?: number, locale?: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0 L';
  const loc = resolveLocale(locale);
  if (loc === 'ru-RU') {
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

export function formatSom(value?: number, locale?: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0 сом';
  const loc = resolveLocale(locale);
  if (loc === 'ru-RU') {
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

export function formatCny(value?: number | null, locale?: string) {
  if (value == null) return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const loc = resolveLocale(locale);
  if (loc === 'ru-RU') {
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

export function formatTons(value?: number, locale?: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0 t';
  const loc = resolveLocale(locale);
  if (loc === 'ru-RU') {
    return `${numeric.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} т`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 吨`;
}

export function formatRate(value?: number | null, locale?: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--';
  const loc = resolveLocale(locale);
  return numeric.toLocaleString(loc, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export function formatClock(value?: string, _locale?: string) {
  const text = String(value || '').trim();
  if (!text) return '--';
  return text.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').slice(0, 16);
}
