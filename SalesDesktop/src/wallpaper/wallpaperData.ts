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
  inventoryByResource?: Array<{ name?: string; inventory?: number; price?: number }>;
  inventoryAsOf?: string;
  snapshotGeneratedAt?: string;
}

export interface WallpaperDepot {
  name: string;
  short?: string;
  region?: string;
  lng?: number;
  lat?: number;
  status?: string;
  closedReason?: string;
}

export interface WallpaperPayload {
  source?: string;
  updatedAt?: string;
  snapshotGeneratedAt?: string;
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
  };
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

export function mapLayers(payload: WallpaperPayload) {
  return {
    stations: (payload.stations || []).map((station) => ({
      ...station,
      type: 'station',
      size: station.status && station.status !== 'normal' ? 0.36 : 0.28,
    })),
    depots: (payload.depots || []).map((depot) => ({
      ...depot,
      type: 'depot',
      size: depot.status === 'normal' ? 0.55 : 0.62,
    })),
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

export function formatClock(value?: string) {
  const text = String(value || '').trim();
  if (!text) return '--';
  return text.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').slice(0, 16);
}
