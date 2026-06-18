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
    yearAmount?: number;
    month?: string;
    monthStart?: string;
    monthEnd?: string;
    monthEndExclusive?: string;
    monthVolumeLiters?: number;
    monthAmount?: number;
  };
  inventoryAlerts?: Array<Record<string, unknown>>;
  inventoryAlertSummary?: Record<string, unknown>;
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

export function stationStatusText(status?: string) {
  if (status === 'closed') return '停业';
  if (status === 'warning') return '关注';
  if (status && status !== 'normal') return '异常';
  return '在营';
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
  { name: 'STN-61', short: 'Главная нефтебаза', region: 'REG-01', lng: 0, lat: 0, type: 'headquarters', status: 'normal' },
  { name: 'DemoDepotNorth', short: 'Север DemoDepot', region: 'REG-08', lng: 0, lat: 0, type: 'depot', status: 'closed', closedReason: '装修停业' },
  { name: 'DemoDepotSouth', short: 'Юж DemoDepot', region: 'REG-07', lng: 0, lat: 0, type: 'depot', status: 'normal' },
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

export function mapLayers(payload: WallpaperPayload) {
  return {
    stations: (payload.stations || []).map((station) => {
      const mappedStation = mapZeroInventoryStation(station);
      return {
        ...mappedStation,
        type: 'station',
        size: mappedStation.status && mappedStation.status !== 'normal' ? 0.36 : 0.28,
        color: mappedStation.status === 'closed' ? '#ef4444' : undefined,
      };
    }),
    depots: ensureCoreDepots(payload.depots || []).map((depot) => {
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
    }),
    customers: [],
  };
}

export function formatLiters(value?: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0 L';
  if (Math.abs(numeric) >= 10000) {
    return `${(numeric / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万L`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} L`;
}

export function formatSom(value?: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0 索姆';
  if (Math.abs(numeric) >= 100000000) {
    return `${(numeric / 100000000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿索姆`;
  }
  if (Math.abs(numeric) >= 10000) {
    return `${(numeric / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万索姆`;
  }
  return `${numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 索姆`;
}

export function formatClock(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '--';
  return text.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').slice(0, 16);
}
