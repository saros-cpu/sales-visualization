import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import { API_HOST, resolveApiHost } from '@/api/http';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';
import '@/lib/kgz-map/kgz-map.css';
import './WallpaperApp.css';
import businessPointsRaw from '../../public/kgz-map/data/business_points.json?raw';
import {
  formatClock,
  formatLiters,
  formatSom,
  mapLayers,
  normalizeWallpaperPayload,
  type WallpaperPayload,
} from './wallpaperData';

const CACHE_KEY = 'sales-wallpaper-map-cache-v1';
const LIVELY_API_HOST_KEY = 'sales_lively_api_host';
const DEFAULT_REFRESH_INTERVAL_MS = 30 * 60_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;

type WallpaperAuthMethod = 'public' | 'header' | 'query' | 'vpn';

interface LivelyUpdateInfo {
  version: string;
  url: string;
  size?: number;
}

interface LivelyUpdateCheck {
  currentVersion: string;
  latestVersion?: string;
  url?: string;
  size?: number;
  checkedAt?: string;
  status: 'checking' | 'current' | 'available' | 'error';
  error?: string;
}

function updateWallpaperAuthStatus(patch: Partial<NonNullable<Window['SALES_WALLPAPER_AUTH_STATUS']>>) {
  window.SALES_WALLPAPER_AUTH_STATUS = {
    ...(window.SALES_WALLPAPER_AUTH_STATUS || {}),
    ...patch,
    checkedAt: new Date().toISOString(),
  };
}

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

function normalizeHost(host: string) {
  return host.trim().replace(/\/+$/, '');
}

function resolveWallpaperApiHost() {
  const configuredHost = normalizeHost(String(
    window.SALES_RUNTIME_CONFIG?.apiHost
    || localStorage.getItem(LIVELY_API_HOST_KEY)
    || '',
  ));
  return configuredHost || resolveApiHost();
}

function resolveWallpaperVpnApiHost() {
  return normalizeHost(String(window.SALES_RUNTIME_CONFIG?.lively?.vpnApiHost || ''));
}

function readWallpaperToken() {
  return String(window.SALES_RUNTIME_CONFIG?.wallpaperToken || '').trim();
}

function applyWallpaperRuntimeConfig(apiHost: string) {
  const normalizedHost = normalizeHost(apiHost);
  if (normalizedHost) {
    localStorage.setItem(LIVELY_API_HOST_KEY, normalizedHost);
    localStorage.setItem('sales_api_host', normalizedHost);
    Object.defineProperty(window, '__SALES_API_HOST__', {
      value: normalizedHost,
      configurable: true,
    });
  } else {
    localStorage.removeItem(LIVELY_API_HOST_KEY);
    localStorage.removeItem('sales_api_host');
  }

  window.SALES_RUNTIME_CONFIG = {
    ...(window.SALES_RUNTIME_CONFIG || {}),
    apiHost: normalizedHost || resolveApiHost(),
  };
}

async function waitForWallpaperKeyFile() {
  try {
    await window.SALES_WALLPAPER_KEY_READY;
  } catch {}
}

function resolveRefreshIntervalMs() {
  const seconds = Number(window.SALES_RUNTIME_CONFIG?.lively?.refreshSeconds);
  if (!Number.isFinite(seconds) || seconds < 300) return DEFAULT_REFRESH_INTERVAL_MS;
  return seconds * 1000;
}

function runtimeSafeArea() {
  const safe = window.SALES_RUNTIME_CONFIG?.safeArea || {};
  return {
    left: Math.max(0, Number(safe.left) || 0),
    top: Math.max(0, Number(safe.top) || 0),
    right: Math.max(0, Number(safe.right) || 0),
    bottom: Math.max(0, Number(safe.bottom) || 0),
  };
}

function applyRuntimeSafeArea() {
  const safe = runtimeSafeArea();
  const root = document.documentElement;
  root.style.setProperty('--wallpaper-safe-left', `${safe.left}px`);
  root.style.setProperty('--wallpaper-safe-top', `${safe.top}px`);
  root.style.setProperty('--wallpaper-safe-right', `${safe.right}px`);
  root.style.setProperty('--wallpaper-safe-bottom', `${safe.bottom}px`);
}

function pointerIgnoreBottom() {
  return Math.max(88, runtimeSafeArea().bottom + 24);
}

function mapDataVersion(payload: WallpaperPayload | null) {
  if (!payload) return '';
  const summary = payload.summary || {};
  const snapshotAt = payload.snapshotGeneratedAt
    || payload.stations?.find((station) => station.snapshotGeneratedAt)?.snapshotGeneratedAt
    || payload.stations?.find((station) => station.inventoryAsOf)?.inventoryAsOf
    || payload.updatedAt
    || '';
  const stationVersion = (payload.stations || []).map((station) => {
    const resourceVersion = (station.inventoryByResource || [])
      .map((item) => [
        item.name || '',
        item.inventory ?? '',
        item.price ?? '',
        item.capacity ?? '',
        item.fillPercent ?? '',
        item.fillStatus ?? '',
      ].join(':'))
      .join(',');
    return [
      station.shopKey,
      station.status || '',
      station.statusType || '',
      station.statusLabel || '',
      station.closedReason || '',
      station.inventory ?? '',
      station.inventoryCapacity ?? '',
      station.inventoryFillPercent ?? '',
      station.inventoryFillStatus || '',
      station.inventoryAsOf || '',
      station.snapshotGeneratedAt || '',
      resourceVersion,
    ].join(':');
  }).join('|');
  const depotVersion = (payload.depots || []).map((depot) => [
    depot.name,
    depot.region || '',
    depot.lng ?? '',
    depot.lat ?? '',
    depot.type || '',
    depot.status || '',
    depot.closedReason || '',
  ].join(':')).join('|');
  return [
    payload.sensitiveData ? 'full' : 'public',
    snapshotAt,
    summary.stationCount ?? '',
    summary.activeStationCount ?? '',
    summary.closedStationCount ?? '',
    summary.depotCount ?? '',
    summary.inventoryLiters ?? '',
    payload.salesSummary?.yearVolumeLiters ?? '',
    payload.salesSummary?.yearAmount ?? '',
    payload.salesSummary?.monthVolumeLiters ?? '',
    payload.salesSummary?.monthAmount ?? '',
    payload.salesSummary?.yearEnd ?? '',
    payload.salesSummary?.monthEnd ?? '',
    stationVersion,
    depotVersion,
  ].join('|');
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
          .map((item: any) => ({
            name: String(item.name || item.nameRu || ''),
            short: String(item.short || item.name || item.nameRu || ''),
            region: String(item.region || ''),
            lng: Number(item.lng),
            lat: Number(item.lat),
            type: item.type,
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

async function requestWallpaperPayload(wallpaperToken: string, method: WallpaperAuthMethod, apiHost = resolveWallpaperApiHost()) {
  const params: Record<string, string | number> = { t: Date.now() };
  const headers = method === 'header' && wallpaperToken
    ? { 'X-Wallpaper-Token': wallpaperToken }
    : undefined;
  if ((method === 'query' || method === 'vpn') && wallpaperToken) {
    params.token = wallpaperToken;
  }
  const response = await axios.get(`${apiHost}/api/wallpaper/map`, {
    params,
    headers,
    timeout: 15000,
  });
  const payload = normalizeWallpaperPayload(response.data);
  updateWallpaperAuthStatus({
    method,
    sensitiveData: Boolean(payload.sensitiveData),
    fallbackReason: method === 'query' ? window.SALES_WALLPAPER_AUTH_STATUS?.fallbackReason : '',
    error: '',
  });
  return payload;
}

async function fetchWallpaperPayload() {
  await waitForWallpaperKeyFile();
  const wallpaperToken = readWallpaperToken();
  const vpnApiHost = resolveWallpaperVpnApiHost();
  const currentApiHost = resolveWallpaperApiHost();
  if (!wallpaperToken) {
    const publicPayload = await requestWallpaperPayload('', 'public', currentApiHost);
    if (publicPayload.sensitiveData || !vpnApiHost || vpnApiHost === currentApiHost) return publicPayload;
    updateWallpaperAuthStatus({ fallbackReason: 'public_returned_public' });
    return requestWallpaperPayload('', 'vpn', vpnApiHost);
  }
  try {
    const headerPayload = await requestWallpaperPayload(wallpaperToken, 'header', currentApiHost);
    if (headerPayload.sensitiveData) return headerPayload;
    updateWallpaperAuthStatus({ fallbackReason: 'header_returned_public' });
    const queryPayload = await requestWallpaperPayload(wallpaperToken, 'query', currentApiHost);
    if (queryPayload.sensitiveData || !vpnApiHost || vpnApiHost === currentApiHost) return queryPayload;
    updateWallpaperAuthStatus({ fallbackReason: 'query_returned_public' });
    return requestWallpaperPayload(wallpaperToken, 'vpn', vpnApiHost);
  } catch (error: any) {
    updateWallpaperAuthStatus({
      method: 'header',
      sensitiveData: false,
      fallbackReason: error?.message || 'header_failed',
      error: error?.message || 'header_failed',
    });
    const queryPayload = await requestWallpaperPayload(wallpaperToken, 'query', currentApiHost);
    if (queryPayload.sensitiveData || !vpnApiHost || vpnApiHost === currentApiHost) return queryPayload;
    updateWallpaperAuthStatus({ fallbackReason: 'query_returned_public' });
    return requestWallpaperPayload(wallpaperToken, 'vpn', vpnApiHost);
  }
}

function compareVersions(left?: string, right?: string) {
  const leftParts = String(left || '0').split('.').map((part) => Number(part) || 0);
  const rightParts = String(right || '0').split('.').map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolveLivelyCurrentVersion() {
  return String(window.SALES_RUNTIME_CONFIG?.lively?.packageVersion || '0.0.0').trim() || '0.0.0';
}

function isWallpaperEngineRuntime() {
  return window.SALES_RUNTIME_CONFIG?.lively?.packageId === 'kg.example.sales.wallpaper.engine';
}

function formatBytes(value?: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  if (numeric >= 1024 * 1024) {
    return `${(numeric / 1024 / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} MB`;
  }
  if (numeric >= 1024) {
    return `${(numeric / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} KB`;
  }
  return `${numeric.toLocaleString('zh-CN')} B`;
}

async function fetchLivelyUpdateCheck(): Promise<LivelyUpdateCheck> {
  await waitForWallpaperKeyFile();
  const livelyConfig = window.SALES_RUNTIME_CONFIG?.lively || {};
  const currentVersion = resolveLivelyCurrentVersion();
  const manifestUrl = livelyConfig.updateManifestUrl || `${resolveWallpaperApiHost() || API_HOST}/download/wallpaper-lively/latest.json`;
  const response = await axios.get(manifestUrl, { params: { t: Date.now() }, timeout: 15000 });
  const manifest = response.data?.data || response.data || {};
  const nextVersion = String(manifest.version || '').trim();
  const nextUrl = String(manifest.url || '').trim();
  const size = Number(manifest.size || 0) || undefined;
  const hasUpdate = Boolean(nextVersion && nextUrl && compareVersions(nextVersion, currentVersion) > 0);
  return {
    currentVersion,
    latestVersion: nextVersion || undefined,
    url: nextUrl || undefined,
    size,
    checkedAt: new Date().toISOString(),
    status: hasUpdate ? 'available' : 'current',
  };
}

export default function WallpaperApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const latestPayloadRef = useRef<WallpaperPayload | null>(null);
  const mapVersionRef = useRef('');
  const [payload, setPayload] = useState<WallpaperPayload | null>(() => readCache());
  const [mode, setMode] = useState<'loading' | 'live' | 'cached' | 'error'>(() => (readCache() ? 'cached' : 'loading'));
  const [lastError, setLastError] = useState('');
  const [updateInfo, setUpdateInfo] = useState<LivelyUpdateInfo | null>(null);
  const [updateCheck, setUpdateCheck] = useState<LivelyUpdateCheck>(() => ({
    currentVersion: resolveLivelyCurrentVersion(),
    status: 'checking',
  }));
  const [configOpen, setConfigOpen] = useState(false);
  const [configApiHost, setConfigApiHost] = useState(() => resolveWallpaperApiHost());
  const [configNotice, setConfigNotice] = useState('');
  const engineRuntime = isWallpaperEngineRuntime();

  useEffect(() => {
    applyRuntimeSafeArea();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchWallpaperPayload();
      const nextVersion = mapDataVersion(next);
      if (nextVersion !== mapDataVersion(latestPayloadRef.current)) {
        latestPayloadRef.current = next;
        setPayload(next);
      }
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
    const handleRefresh = () => {
      void refresh();
    };
    refresh();
    window.addEventListener('sales-wallpaper-refresh', handleRefresh);
    const timer = window.setInterval(refresh, resolveRefreshIntervalMs());
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('sales-wallpaper-refresh', handleRefresh);
    };
  }, [refresh]);

  const checkForUpdates = useCallback(async () => {
    setUpdateCheck((prev) => ({
      ...prev,
      currentVersion: resolveLivelyCurrentVersion(),
      status: 'checking',
      error: '',
    }));
    try {
      const next = await fetchLivelyUpdateCheck();
      setUpdateCheck(next);
      setUpdateInfo(next.status === 'available' && next.url
        ? { version: next.latestVersion || '', url: next.url, size: next.size }
        : null);
    } catch (error: any) {
      setUpdateInfo(null);
      setUpdateCheck({
        currentVersion: resolveLivelyCurrentVersion(),
        checkedAt: new Date().toISOString(),
        status: 'error',
        error: error?.message || '检查更新失败',
      });
    }
  }, []);

  useEffect(() => {
    if (engineRuntime) return undefined;
    void checkForUpdates();
    const timer = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkForUpdates, engineRuntime]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    mountHomeMap(el, { stations: [], depots: [], customers: [] }, {
      basePath: resolveKgzDataPath(),
      showRoadPanel: false,
      showLakeLabels: true,
      showCities: true,
      showRegionLabels: false,
      showLegend: false,
      regionColor: '#10263f',
      enableCameraControls: false,
      maxPixelRatio: 1.25,
      pointerIgnoreBottom: pointerIgnoreBottom(),
      starDensity: 0.45,
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
      if (latestPayloadRef.current) {
        mapVersionRef.current = mapDataVersion(latestPayloadRef.current);
        mapRef.current?.updateLayers?.(mapLayers(latestPayloadRef.current));
      }
      window.wallpaperAPI?.ready?.();
      window.setTimeout(() => mapRef.current?.resize?.(), 120);
      window.setTimeout(() => mapRef.current?.resize?.(), 600);
    }).catch((error) => {
      setMode('error');
      setLastError(error?.message || '地图加载失败');
    });

    return () => {
      cancelled = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    latestPayloadRef.current = payload;
    const nextVersion = mapDataVersion(payload);
    if (!payload || !mapRef.current || nextVersion === mapVersionRef.current) return;
    mapVersionRef.current = nextVersion;
    mapRef.current.updateLayers?.(mapLayers(payload));
    window.setTimeout(() => mapRef.current?.resize?.(), 80);
  }, [payload]);

	  const summary = payload?.summary || {};
	  const statusText = mode === 'live' ? '实时' : mode === 'cached' ? '缓存' : mode === 'loading' ? '加载中' : '异常';
	  const keyStatus = window.SALES_WALLPAPER_KEY_STATUS || {};
	  const authStatus = window.SALES_WALLPAPER_AUTH_STATUS || {};
	  const salesSummary = payload?.salesSummary || {};
	  const hasSalesSummary = Boolean(payload?.sensitiveData && payload?.salesSummary);
	  const keyState = keyStatus.state || 'missing';
	  const dataModeText = payload?.sensitiveData
	    ? '完整数据'
	    : keyState === 'loaded'
      ? '授权未通过'
      : keyState === 'invalid'
        ? '密钥无效'
        : '未配置密钥';
  const updateStatusText = updateCheck.status === 'checking'
    ? '正在检查'
    : updateCheck.status === 'available'
      ? `发现新版 ${updateCheck.latestVersion}`
      : updateCheck.status === 'error'
        ? '检查失败'
        : '已是最新';
  const updateDetailText = updateCheck.status === 'error'
    ? updateCheck.error
	    : updateCheck.size
	      ? `大小 ${formatBytes(updateCheck.size)}`
	      : '';
	  const keyDetailText = keyState === 'loaded' && !payload?.sensitiveData
	    ? '已读取密钥，但服务端未授权。请核对 API 地址、长度和指纹。'
	    : keyStatus.message || '';

  const saveConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyWallpaperRuntimeConfig(configApiHost);
    setConfigApiHost(resolveWallpaperApiHost());
    setConfigNotice('已保存，正在刷新');
    void refresh();
    window.setTimeout(() => setConfigNotice(''), 2400);
  };

  const clearConfig = () => {
    setConfigApiHost('');
    applyWallpaperRuntimeConfig('');
    setConfigNotice('已恢复默认 API');
    void refresh();
    window.setTimeout(() => setConfigNotice(''), 2400);
  };

  return (
    <main className="wallpaper-shell">
      <div className="wallpaper-map" ref={containerRef} />
      <section className="wallpaper-hud wallpaper-center" aria-label="运营概览">
        <div className="wallpaper-heading">
          <div>
            <div className="wallpaper-title">Example销售运营地图</div>
            <div className="wallpaper-subtitle">Kyrgyzstan retail network</div>
          </div>
          <div className={`wallpaper-live wallpaper-live-${mode}`}>
            <span />
            {statusText}
          </div>
          <div className={`wallpaper-data-mode ${payload?.sensitiveData ? 'wallpaper-data-full' : ''}`}>
            {dataModeText}
          </div>
        </div>
        <div className="wallpaper-metrics">
          <div>
            <b>{summary.stationCount ?? payload?.stations?.length ?? 0}</b>
            <span>站点总数</span>
          </div>
          <div>
            <b>{summary.activeStationCount ?? 0}</b>
            <span>正常营业</span>
          </div>
          <div>
            <b>{summary.closedStationCount ?? 0}</b>
            <span>暂停运营</span>
          </div>
          <div>
            <b>{summary.depotCount ?? 0}</b>
            <span>油库</span>
          </div>
          <div>
            <b>{summary.inventoryLiters == null ? '--' : formatLiters(summary.inventoryLiters)}</b>
            <span>站点库存</span>
          </div>
        </div>
      </section>

      <footer className="wallpaper-footer">
        <span>数据：{formatClock(payload?.snapshotGeneratedAt || payload?.updatedAt)}</span>
        <span>刷新：{formatClock(new Date().toISOString())}</span>
        {lastError && <span>{lastError}</span>}
      </footer>

      <section className="wallpaper-sales wallpaper-hud" aria-label="销售汇总">
        <div className="wallpaper-sales-head">
          <strong>销售汇总</strong>
          <span>{hasSalesSummary ? salesSummary.monthEnd || salesSummary.yearEnd || '实际运营' : dataModeText}</span>
        </div>
        <div className="wallpaper-sales-grid">
          <div>
            <span>{salesSummary.year ? `${salesSummary.year}年销量` : '年销量'}</span>
            <b>{hasSalesSummary ? formatLiters(salesSummary.yearVolumeLiters) : '--'}</b>
          </div>
          <div>
            <span>年销售额</span>
            <b>{hasSalesSummary ? formatSom(salesSummary.yearAmount) : '--'}</b>
          </div>
          <div>
            <span>{salesSummary.month ? `${salesSummary.month}销量` : '月销量'}</span>
            <b>{hasSalesSummary ? formatLiters(salesSummary.monthVolumeLiters) : '--'}</b>
          </div>
          <div>
            <span>月销售额</span>
            <b>{hasSalesSummary ? formatSom(salesSummary.monthAmount) : '--'}</b>
          </div>
        </div>
      </section>

      {!engineRuntime && updateInfo && (
        <a className="wallpaper-update" href={updateInfo.url} target="_blank" rel="noreferrer">
          <strong>壁纸有更新</strong>
          <span>下载 {updateInfo.version}</span>
        </a>
      )}

      {!engineRuntime && (
        <button
          className="wallpaper-config-toggle"
          type="button"
          title="壁纸设置"
          aria-label="壁纸设置"
          onClick={() => {
            setConfigApiHost(resolveWallpaperApiHost());
            setConfigOpen((open) => !open);
          }}
        >
          设置
        </button>
      )}

      {!engineRuntime && configOpen && (
        <form className="wallpaper-config-panel" onSubmit={saveConfig}>
          <label>
            <span>API 地址</span>
            <input
              value={configApiHost}
              onChange={(event) => setConfigApiHost(event.target.value)}
              placeholder="http://198.51.100.10"
            />
          </label>
	          <div className="wallpaper-key-state">
	            <span>密钥文件</span>
	            <strong>{dataModeText}</strong>
	          </div>
	          <div className={`wallpaper-key-debug wallpaper-key-debug-${keyState}`}>
	            <div className="wallpaper-key-debug-head">
	              <span>密钥诊断</span>
	              <strong>{keyStatus.source || 'wallpaper-key.json'}</strong>
	            </div>
	            <div className="wallpaper-key-debug-grid">
	              <span>读取状态</span>
	              <b>{keyState}</b>
	              <span>API 地址</span>
	              <b title={keyStatus.apiHost || resolveWallpaperApiHost()}>{keyStatus.apiHost || resolveWallpaperApiHost()}</b>
	              <span>Token 长度</span>
	              <b>{keyStatus.tokenLength ?? '--'}</b>
	              <span>Token 指纹</span>
	              <b>{keyStatus.tokenFingerprint || '--'}</b>
	              <span>授权通道</span>
	              <b>{authStatus.method || '--'}</b>
	              <span>服务端模式</span>
	              <b>{payload?.sensitiveData ? '完整数据' : authStatus.sensitiveData === false ? '公开数据' : '--'}</b>
	              <span>读取时间</span>
	              <b>{formatClock(keyStatus.loadedAt)}</b>
	            </div>
	            {keyDetailText && <div className="wallpaper-key-debug-note">{keyDetailText}</div>}
	          </div>
	          <div className={`wallpaper-update-state wallpaper-update-state-${updateCheck.status}`}>
            <div className="wallpaper-update-state-head">
              <span>壁纸更新</span>
              <strong>{updateStatusText}</strong>
            </div>
            <div className="wallpaper-update-state-grid">
              <span>当前版本</span>
              <b>{updateCheck.currentVersion}</b>
              <span>服务器版本</span>
              <b>{updateCheck.latestVersion || '--'}</b>
              <span>上次检查</span>
              <b>{formatClock(updateCheck.checkedAt)}</b>
            </div>
            {updateDetailText && <div className="wallpaper-update-state-note">{updateDetailText}</div>}
            <div className="wallpaper-update-state-actions">
              <button
                type="button"
                onClick={() => void checkForUpdates()}
                disabled={updateCheck.status === 'checking'}
              >
                手动检查更新
              </button>
              {updateCheck.status === 'available' && updateCheck.url && (
                <a href={updateCheck.url} target="_blank" rel="noreferrer">下载新版</a>
              )}
            </div>
          </div>
          <div className="wallpaper-config-actions">
            <button type="submit">保存并刷新</button>
            <button type="button" onClick={clearConfig}>恢复默认</button>
            <button type="button" onClick={() => setConfigOpen(false)}>关闭</button>
          </div>
          {configNotice && <div className="wallpaper-config-notice">{configNotice}</div>}
        </form>
      )}
    </main>
  );
}
