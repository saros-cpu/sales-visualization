import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { API_HOST } from '@/api/http';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';
import '@/lib/kgz-map/kgz-map.css';
import './WallpaperApp.css';
import businessPointsRaw from '../../public/kgz-map/data/business_points.json?raw';
import {
  alertStations,
  formatClock,
  formatLiters,
  mapLayers,
  normalizeWallpaperPayload,
  stationStatusText,
  stationStatusTone,
  topInventoryStations,
  type WallpaperPayload,
} from './wallpaperData';

const CACHE_KEY = 'sales-wallpaper-map-cache-v1';
const REFRESH_INTERVAL_MS = 60_000;

function resolveKgzDataPath() {
  if (window.location.protocol === 'file:') {
    return new URL('kgz-map/data/', window.location.href).href;
  }
  return new URL('/kgz-map/data/', window.location.origin).href;
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeWallpaperPayload(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(payload: WallpaperPayload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

function fallbackPayloadFromBusinessPoints(): WallpaperPayload {
  try {
    const data = JSON.parse(businessPointsRaw || '{}');
    const stations = Array.isArray(data.stations)
      ? data.stations.map((item: any, index: number) => ({
          shopKey: Number(item.shopKey || item.id || index + 1),
          name: String(item.name || item.nameRu || item.id || ''),
          short: String(item.short || item.name || item.nameRu || item.id || ''),
          region: String(item.region || ''),
          lng: Number(item.lng),
          lat: Number(item.lat),
          status: item.status || 'normal',
          closedReason: item.closedReason,
        }))
      : [];
    const depots = Array.isArray(data.depots)
      ? data.depots
          .filter((item: any) => item?.type !== 'headquarters')
          .map((item: any) => ({
            name: String(item.name || item.nameRu || ''),
            short: String(item.short || item.name || item.nameRu || ''),
            region: String(item.region || ''),
            lng: Number(item.lng),
            lat: Number(item.lat),
            status: item.status || 'normal',
            closedReason: item.closedReason,
          }))
      : [];
    return {
      source: 'builtin_business_points',
      updatedAt: new Date().toISOString(),
      stations,
      depots,
      summary: {
        stationCount: stations.length,
        activeStationCount: stations.filter((item: any) => item.status !== 'closed').length,
        closedStationCount: stations.filter((item: any) => item.status === 'closed').length,
        warningStationCount: stations.filter((item: any) => item.status && item.status !== 'normal' && item.status !== 'closed').length,
        depotCount: depots.length,
        activeDepotCount: depots.filter((item: any) => item.status !== 'closed').length,
      },
    };
  } catch {
    return { source: 'builtin_empty', stations: [], depots: [], summary: {} };
  }
}

async function fetchWallpaperPayload() {
  const wallpaperToken = String(window.SALES_RUNTIME_CONFIG?.wallpaperToken || '').trim();
  const response = await axios.get(`${API_HOST}/api/wallpaper/map`, {
    params: { t: Date.now() },
    headers: wallpaperToken ? { 'X-Wallpaper-Token': wallpaperToken } : undefined,
    timeout: 15000,
  });
  return normalizeWallpaperPayload(response.data);
}

export default function WallpaperApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [payload, setPayload] = useState<WallpaperPayload | null>(() => readCache());
  const [mode, setMode] = useState<'loading' | 'live' | 'cached' | 'error'>(() => (readCache() ? 'cached' : 'loading'));
  const [lastError, setLastError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWallpaperPayload();
      setPayload(next);
      writeCache(next);
      setMode('live');
      setLastError('');
    } catch (error: any) {
      const cached = readCache();
      if (cached) {
        setPayload(cached);
        setMode('cached');
      } else {
        setPayload(fallbackPayloadFromBusinessPoints());
        setMode('cached');
      }
      setLastError(error?.message || '数据更新失败');
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    return () => {
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !payload) return;
    const layers = mapLayers(payload);
    if (mapRef.current) {
      mapRef.current.updateLayers?.(layers);
      window.setTimeout(() => mapRef.current?.resize?.(), 80);
      return;
    }

    let cancelled = false;
    mountHomeMap(el, layers, {
      basePath: resolveKgzDataPath(),
      showRoadPanel: false,
      showLakeLabels: true,
      showCities: true,
      showRegionLabels: false,
      showLegend: false,
      regionColor: '#10263f',
      initialCamera: {
        cameraX: -0.08,
        cameraY: 30.54,
        cameraZ: 45.81,
        targetX: -0.08,
        targetY: -0.45,
        targetZ: 2.48,
      },
    }).then((instance) => {
      if (cancelled) {
        instance?.destroy?.();
        return;
      }
      mapRef.current = instance;
      window.wallpaperAPI?.ready?.();
      window.setTimeout(() => mapRef.current?.resize?.(), 120);
      window.setTimeout(() => mapRef.current?.resize?.(), 600);
    }).catch((error) => {
      setMode('error');
      setLastError(error?.message || '地图加载失败');
    });

    return () => {
      cancelled = true;
    };
  }, [payload]);

  const summary = payload?.summary || {};
  const alerts = useMemo(() => alertStations(payload || {}, 6), [payload]);
  const inventoryRows = useMemo(() => topInventoryStations(payload || {}, 6), [payload]);
  const statusText = mode === 'live' ? '实时' : mode === 'cached' ? '缓存' : mode === 'loading' ? '加载中' : '异常';

  return (
    <main className="wallpaper-shell">
      <div className="wallpaper-map" ref={containerRef} />
      <section className="wallpaper-hud wallpaper-top">
        <div>
          <div className="wallpaper-title">Example销售运营地图</div>
          <div className="wallpaper-subtitle">Kyrgyzstan retail network</div>
        </div>
        <div className={`wallpaper-live wallpaper-live-${mode}`}>
          <span />
          {statusText}
        </div>
      </section>

      <section className="wallpaper-hud wallpaper-metrics" aria-label="运营指标">
        <div>
          <b>{summary.activeStationCount ?? 0}</b>
          <span>在营站</span>
        </div>
        <div>
          <b>{summary.closedStationCount ?? 0}</b>
          <span>停业站</span>
        </div>
        <div>
          <b>{summary.warningStationCount ?? 0}</b>
          <span>关注项</span>
        </div>
        <div>
          <b>{summary.depotCount ?? 0}</b>
          <span>油库</span>
        </div>
        <div>
          <b>{formatLiters(summary.inventoryLiters)}</b>
          <span>站点库存</span>
        </div>
      </section>

      <aside className="wallpaper-hud wallpaper-panel">
        <div className="wallpaper-panel-title">异常与关注</div>
        <div className="wallpaper-alert-list">
          {alerts.length ? alerts.map((station) => (
            <div className="wallpaper-alert-row" key={station.shopKey}>
              <span className={`wallpaper-dot wallpaper-dot-${stationStatusTone(station.status)}`} />
              <strong>{station.shopKey}号 {station.short || station.name}</strong>
              <em>{station.closedReason || stationStatusText(station.status)}</em>
            </div>
          )) : (
            <div className="wallpaper-empty">暂无异常站点</div>
          )}
        </div>
      </aside>

      <aside className="wallpaper-hud wallpaper-panel wallpaper-panel-bottom">
        <div className="wallpaper-panel-title">库存靠前站点</div>
        <div className="wallpaper-rank-list">
          {inventoryRows.map((station, index) => (
            <div className="wallpaper-rank-row" key={station.shopKey}>
              <span>{index + 1}</span>
              <strong>{station.short || station.name}</strong>
              <em>{formatLiters(station.inventory)}</em>
            </div>
          ))}
        </div>
      </aside>

      <footer className="wallpaper-footer">
        <span>数据：{formatClock(payload?.snapshotGeneratedAt || payload?.updatedAt)}</span>
        <span>刷新：{formatClock(new Date().toISOString())}</span>
        {lastError && <span>{lastError}</span>}
      </footer>
    </main>
  );
}
