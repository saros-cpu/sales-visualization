import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import axios from 'axios';
import { API_HOST, resolveApiHost } from '@/api/http';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';
import '@/lib/kgz-map/kgz-map.css';
import './WallpaperApp.css';
import businessPointsRaw from '../../public/kgz-map/data/business_points.json?raw';
import {
  formatClock,
  formatCny,
  formatLiters,
  formatRate,
  formatSom,
  formatTons,
  mapLayers,
  normalizeWallpaperPayload,
  type WallpaperPayload,
} from './wallpaperData';

const CACHE_KEY = 'sales-wallpaper-map-cache-v1';
const WALLPAPER_API_HOST_KEY = 'sales_wallpaper_api_host';
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60_000;
const MIN_REFRESH_INTERVAL_MS = 5 * 60_000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60_000;
const WALLPAPER_BASE_W = 1920;
const WALLPAPER_BASE_H = 1080;
const WALLPAPER_SCALE_MIN = 0.5;
const WALLPAPER_SCALE_MAX = 1.5;

// i18n
type WallLang = 'zh' | 'ru';
const wallI18n: Record<string, Record<WallLang, string>> = {
  appTitle: { zh: 'Example Petroleum零售版图', ru: 'Карта розничной торговли example' },
  statusLive: { zh: '实时', ru: 'Онлайн' },
  statusCached: { zh: '缓存', ru: 'Кэш' },
  statusLoading: { zh: '加载中', ru: 'Загрузка' },
  statusError: { zh: '异常', ru: 'CTY-05ибка' },
  dataFull: { zh: '完整数据', ru: 'Полные данные' },
  dataUnauthorized: { zh: '授权未通过', ru: 'Нет доступа' },
  dataInvalidKey: { zh: '密钥无效', ru: 'Неверный ключ' },
  dataNoKey: { zh: '未配置密钥', ru: 'Ключ не настроен' },
  totalStations: { zh: '站点总数', ru: 'Всего АЗС' },
  activeStations: { zh: '正常营业', ru: 'Работают' },
  closedStations: { zh: '暂停运营', ru: 'Закрыты' },
  depots: { zh: '油库', ru: 'Нефтебазы' },
  stationInventory: { zh: '站点库存', ru: 'Запасы на АЗС' },
  inventoryAlert: { zh: '库存预警', ru: 'Предупр. запасов' },
  salesTitle: { zh: '销售汇总', ru: 'Продажи' },
  yearVolumeLabel: { zh: '年销量/吨位', ru: 'Годовой объём/вес' },
  yearTonsLabel: { zh: '年吨位', ru: 'Годовой вес' },
  yearAmount: { zh: '年销售额', ru: 'Годовая сумма' },
  monthVolumeLabel: { zh: '月销量/吨位', ru: 'Месячный объём/вес' },
  monthTonsLabel: { zh: '月吨位', ru: 'Месячный вес' },
  monthAmount: { zh: '月销售额', ru: 'Месячная сумма' },
  actualOperation: { zh: '实际运营', ru: 'Факт' },
  exchangeUsdKgs: { zh: '美元/索姆', ru: 'USD/KGS' },
  exchangeCnyKgs: { zh: '人民币/索姆', ru: 'CNY/KGS' },
  updateBanner: { zh: '壁纸有更新', ru: 'Доступно обновление' },
  updateDownload: { zh: '下载', ru: 'Скачать' },
};

function resolveWallpaperLang(): WallLang {
  const cfg = window.SALES_RUNTIME_CONFIG?.wallpaper?.language;
  if (cfg === 'ru') return 'ru';
  if (cfg === 'zh') return 'zh';
  if (typeof navigator !== 'undefined') {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
  }
  return 'zh';
}

function t(key: string): string {
  const lang = resolveWallpaperLang();
  const entry = wallI18n[key];
  return entry ? entry[lang] : key;
}

type WallpaperAuthMethod = 'public' | 'header' | 'vpn';

interface WallpaperUpdateInfo {
  version: string;
  url: string;
  size?: number;
}

interface WallpaperUpdateCheck {
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
    || localStorage.getItem(WALLPAPER_API_HOST_KEY)
    || '',
  ));
  return configuredHost || resolveApiHost();
}

function resolveWallpaperVpnApiHost() {
  return normalizeHost(String(window.SALES_RUNTIME_CONFIG?.wallpaper?.vpnApiHost || ''));
}

function readWallpaperToken() {
  return String(window.SALES_RUNTIME_CONFIG?.wallpaperToken || '').trim();
}

function localApiHeaders(json = false) {
  const headers: Record<string, string> = {};
  const nonce = String(window.SALES_RUNTIME_CONFIG?.localApiNonce || '').trim();
  if (json) headers['Content-Type'] = 'application/json';
  if (nonce) headers['X-Sales-Wallpaper-Nonce'] = nonce;
  return headers;
}

async function waitForWallpaperKeyFile() {
  try {
    await window.SALES_WALLPAPER_KEY_READY;
  } catch {}
}

function resolveRefreshIntervalMs() {
  const seconds = Number(window.SALES_RUNTIME_CONFIG?.wallpaper?.refreshSeconds);
  if (!Number.isFinite(seconds) || seconds < MIN_REFRESH_INTERVAL_MS / 1000) return DEFAULT_REFRESH_INTERVAL_MS;
  return seconds * 1000;
}

function resolveRefreshAtLocalTime() {
  const text = String(window.SALES_RUNTIME_CONFIG?.wallpaper?.refreshAtLocalTime || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function nextRefreshDelayMs() {
  const daily = resolveRefreshAtLocalTime();
  if (!daily) return resolveRefreshIntervalMs();

  const now = new Date();
  const next = new Date(now);
  next.setHours(daily.hour, daily.minute, 0, 0);
  if (next.getTime() <= now.getTime() + 5000) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(MIN_REFRESH_INTERVAL_MS, next.getTime() - now.getTime());
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

function computeWallpaperScale() {
  const scale = Math.min(window.innerWidth / WALLPAPER_BASE_W, window.innerHeight / WALLPAPER_BASE_H);
  return Math.min(WALLPAPER_SCALE_MAX, Math.max(WALLPAPER_SCALE_MIN, scale));
}

interface HudLayout {
  hudTopScale: number;
  hudTopOffsetX: number;
  hudTopOffsetY: number;
  hudSalesScale: number;
  hudSalesOffsetX: number;
  hudSalesOffsetY: number;
}

type HudTarget = 'top' | 'sales';
type HudDragKind = 'move' | 'scale';

const DEFAULT_HUD_LAYOUT: HudLayout = {
  hudTopScale: 1,
  hudTopOffsetX: 0,
  hudTopOffsetY: 0,
  hudSalesScale: 1,
  hudSalesOffsetX: 0,
  hudSalesOffsetY: 0,
};

function numericConfig(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampScale(value: number) {
  return Math.min(1.5, Math.max(0.5, value));
}

function roundLayoutNumber(value: number) {
  return Math.round(value * 100) / 100;
}

function readHudLayout(hud?: Partial<HudLayout>): HudLayout {
  return {
    hudTopScale: clampScale(numericConfig(hud?.hudTopScale, DEFAULT_HUD_LAYOUT.hudTopScale)),
    hudTopOffsetX: numericConfig(hud?.hudTopOffsetX, DEFAULT_HUD_LAYOUT.hudTopOffsetX),
    hudTopOffsetY: numericConfig(hud?.hudTopOffsetY, DEFAULT_HUD_LAYOUT.hudTopOffsetY),
    hudSalesScale: clampScale(numericConfig(hud?.hudSalesScale, DEFAULT_HUD_LAYOUT.hudSalesScale)),
    hudSalesOffsetX: numericConfig(hud?.hudSalesOffsetX, DEFAULT_HUD_LAYOUT.hudSalesOffsetX),
    hudSalesOffsetY: numericConfig(hud?.hudSalesOffsetY, DEFAULT_HUD_LAYOUT.hudSalesOffsetY),
  };
}

function hudTransform(target: HudTarget, layout: HudLayout) {
  if (target === 'top') {
    return `translateX(-50%) translate(${layout.hudTopOffsetX}px, ${layout.hudTopOffsetY}px) scale(${layout.hudTopScale})`;
  }
  return `translate(${layout.hudSalesOffsetX}px, ${layout.hudSalesOffsetY}px) scale(${layout.hudSalesScale})`;
}

function hudLayoutPayload(layout: HudLayout) {
  return {
    hudTopScale: roundLayoutNumber(layout.hudTopScale),
    hudTopOffsetX: roundLayoutNumber(layout.hudTopOffsetX),
    hudTopOffsetY: roundLayoutNumber(layout.hudTopOffsetY),
    hudSalesScale: roundLayoutNumber(layout.hudSalesScale),
    hudSalesOffsetX: roundLayoutNumber(layout.hudSalesOffsetX),
    hudSalesOffsetY: roundLayoutNumber(layout.hudSalesOffsetY),
  };
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
    depot.statusLabel || '',
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
    summary.inventoryAlertCount ?? '',
    summary.inventoryCriticalCount ?? '',
    summary.inventoryWarningCount ?? '',
    payload.salesSummary?.yearVolumeLiters ?? '',
    payload.salesSummary?.yearTons ?? '',
    payload.salesSummary?.yearAmount ?? '',
    payload.salesSummary?.yearAmountCny ?? '',
    payload.salesSummary?.yearAvgCnyKgs ?? '',
    payload.salesSummary?.monthVolumeLiters ?? '',
    payload.salesSummary?.monthTons ?? '',
    payload.salesSummary?.monthAmount ?? '',
    payload.salesSummary?.monthAmountCny ?? '',
    payload.salesSummary?.monthAvgCnyKgs ?? '',
    payload.salesSummary?.yearEnd ?? '',
    payload.salesSummary?.monthEnd ?? '',
    payload.exchangeSummary?.date ?? '',
    payload.exchangeSummary?.usdKgs ?? '',
    payload.exchangeSummary?.cnyKgs ?? '',
    payload.exchangeSummary?.source ?? '',
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
          statusLabel: item.statusLabel,
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
            statusLabel: item.statusLabel,
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
  const headers = (method === 'header' || method === 'vpn') && wallpaperToken
    ? { 'X-Wallpaper-Token': wallpaperToken }
    : undefined;
  const response = await axios.get(`${apiHost}/api/wallpaper/map`, {
    params,
    headers,
    timeout: 15000,
  });
  const payload = normalizeWallpaperPayload(response.data);
  updateWallpaperAuthStatus({
    method,
    sensitiveData: Boolean(payload.sensitiveData),
    fallbackReason: '',
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
    if (vpnApiHost && vpnApiHost !== currentApiHost) {
      return requestWallpaperPayload(wallpaperToken, 'vpn', vpnApiHost);
    }
    return headerPayload;
  } catch (error: any) {
    updateWallpaperAuthStatus({
      method: 'header',
      sensitiveData: false,
      fallbackReason: error?.message || 'header_failed',
      error: error?.message || 'header_failed',
    });
    if (vpnApiHost && vpnApiHost !== currentApiHost) {
      return requestWallpaperPayload(wallpaperToken, 'vpn', vpnApiHost);
    }
    return requestWallpaperPayload('', 'public', currentApiHost);
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

function resolveWallpaperCurrentVersion() {
  return String(window.SALES_RUNTIME_CONFIG?.wallpaper?.packageVersion || '0.0.0').trim() || '0.0.0';
}

function isWallpaperEngineRuntime() {
  return window.SALES_RUNTIME_CONFIG?.wallpaper?.packageId === 'kg.example.sales.wallpaper.engine';
}

async function fetchWallpaperUpdateCheck(): Promise<WallpaperUpdateCheck> {
  await waitForWallpaperKeyFile();
  const wallpaperConfig = window.SALES_RUNTIME_CONFIG?.wallpaper || {};
  const currentVersion = resolveWallpaperCurrentVersion();
  const manifestUrl = wallpaperConfig.updateManifestUrl || `${resolveWallpaperApiHost() || API_HOST}/download/wallpaper-engine/latest.json`;
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
  const centerHudRef = useRef<HTMLElement>(null);
  const salesHudRef = useRef<HTMLElement>(null);
  const hudLayoutRef = useRef<HudLayout>(DEFAULT_HUD_LAYOUT);
  const editModeRef = useRef(false);
  const dragActiveRef = useRef(false);
  const previewTimerRef = useRef<number | undefined>(undefined);
  const [payload, setPayload] = useState<WallpaperPayload | null>(() => readCache());
  const [mode, setMode] = useState<'loading' | 'live' | 'cached' | 'error'>(() => (readCache() ? 'cached' : 'loading'));
  const [updateInfo, setUpdateInfo] = useState<WallpaperUpdateInfo | null>(null);
  const engineRuntime = isWallpaperEngineRuntime();
  const lang = resolveWallpaperLang();
  const wallpaperConfig = window.SALES_RUNTIME_CONFIG?.wallpaper || {};
  const hud = wallpaperConfig.hud || {};
  const mapConfig = wallpaperConfig.map || {};
  const [hudLayout, setHudLayout] = useState<HudLayout>(() => readHudLayout(hud));
  const [editMode, setEditMode] = useState(false);
  const showSalesSummary = hud.showSalesSummary !== false;
  const showExchangeRates = hud.showExchangeRates !== false;
  const showYearVolume = hud.showYearVolume !== false;
  const showYearTons = hud.showYearTons !== false;
  const showYearAmount = hud.showYearAmount !== false;
  const showMonthVolume = hud.showMonthVolume !== false;
  const showMonthTons = hud.showMonthTons !== false;
  const showMonthAmount = hud.showMonthAmount !== false;
  const showUsdKgs = hud.showUsdKgs !== false;
  const showCnyKgs = hud.showCnyKgs !== false;
  const showInventoryAlerts = hud.showInventoryAlerts !== false;
  const layerOptions = {
    showActiveStations: hud.showActiveStations !== false,
    showClosedStations: hud.showClosedStations !== false,
    showDepotMarkers: hud.showDepotMarkers !== false,
    showInventoryAlertOnly: Boolean(hud.showInventoryAlertOnly),
  };
  const fitCenterX = numericConfig(mapConfig.fitCenterX, -1.16);
  const fitCenterY = numericConfig(mapConfig.fitCenterY, -0.45);
  const fitCenterZ = numericConfig(mapConfig.fitCenterZ, 2.48);

  useEffect(() => {
    hudLayoutRef.current = hudLayout;
  }, [hudLayout]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  const postHudPreview = useCallback((layout: HudLayout) => {
    if (!engineRuntime) return;
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = window.setTimeout(() => {
      void fetch('/api/wallpaper/settings/preview', {
        method: 'POST',
        headers: localApiHeaders(true),
        body: JSON.stringify(hudLayoutPayload(layout)),
      }).catch(() => {});
    }, 300);
  }, [engineRuntime]);

  const applyEditMode = useCallback((enabled: boolean) => {
    editModeRef.current = enabled;
    setEditMode(enabled);
  }, []);

  const startHudDrag = useCallback((event: React.PointerEvent<HTMLElement>, target: HudTarget, kind: HudDragKind) => {
    if (!editModeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragActiveRef.current = true;

    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = hudLayoutRef.current;
    const source = event.currentTarget;
    try {
      source.setPointerCapture(event.pointerId);
    } catch {}

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const next: HudLayout = { ...startLayout };
      if (kind === 'move') {
        if (target === 'top') {
          next.hudTopOffsetX = roundLayoutNumber(startLayout.hudTopOffsetX + dx);
          next.hudTopOffsetY = roundLayoutNumber(startLayout.hudTopOffsetY + dy);
        } else {
          next.hudSalesOffsetX = roundLayoutNumber(startLayout.hudSalesOffsetX + dx);
          next.hudSalesOffsetY = roundLayoutNumber(startLayout.hudSalesOffsetY + dy);
        }
      } else {
        const delta = (dx + dy) / 400;
        if (target === 'top') {
          next.hudTopScale = roundLayoutNumber(clampScale(startLayout.hudTopScale + delta));
        } else {
          next.hudSalesScale = roundLayoutNumber(clampScale(startLayout.hudSalesScale + delta));
        }
      }
      hudLayoutRef.current = next;
      setHudLayout(next);
      window.setTimeout(() => mapRef.current?.resize?.(), 0);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragActiveRef.current = false;
      postHudPreview(hudLayoutRef.current);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [postHudPreview]);

  useEffect(() => {
    applyRuntimeSafeArea();
  }, []);

  useEffect(() => () => {
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
  }, []);

  useEffect(() => {
    window.__wallpaperSetEditMode = applyEditMode;
    return () => {
      delete window.__wallpaperSetEditMode;
    };
  }, [applyEditMode]);

  useEffect(() => {
    if (!engineRuntime) return undefined;
    let cancelled = false;
    const syncSettings = async () => {
      try {
        const response = await fetch('/api/wallpaper/settings', { cache: 'no-store' });
        if (!response.ok) return;
        const settings = await response.json();
        if (cancelled) return;
        const nextEditMode = Boolean(settings.editMode);
        const wasEditing = editModeRef.current;
        const nextLayout = readHudLayout(settings);
        if (nextEditMode !== wasEditing) {
          applyEditMode(nextEditMode);
          if (!nextEditMode && wasEditing) {
            hudLayoutRef.current = nextLayout;
            setHudLayout(nextLayout);
            window.setTimeout(() => mapRef.current?.resize?.(), 80);
            return;
          }
        }
        if (nextEditMode && !dragActiveRef.current) {
          hudLayoutRef.current = nextLayout;
          setHudLayout(nextLayout);
        }
      } catch {}
    };

    void syncSettings();
    const timer = window.setInterval(syncSettings, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyEditMode, engineRuntime]);

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
    } catch {
      const cached = readCache();
      if (cached) {
        setPayload(cached);
        setMode('cached');
      } else {
        setPayload(fallbackPayloadFromBusinessPoints());
        setMode('cached');
      }
    }
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      void refresh();
    };
    let timer: number | undefined;
    const scheduleNextRefresh = () => {
      timer = window.setTimeout(() => {
        void refresh().finally(scheduleNextRefresh);
      }, nextRefreshDelayMs());
    };

    refresh();
    window.addEventListener('sales-wallpaper-refresh', handleRefresh);
    scheduleNextRefresh();
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('sales-wallpaper-refresh', handleRefresh);
    };
  }, [refresh]);

  const checkForUpdates = useCallback(async () => {
    try {
      const next = await fetchWallpaperUpdateCheck();
      setUpdateInfo(next.status === 'available' && next.url
        ? { version: next.latestVersion || '', url: next.url, size: next.size }
        : null);
    } catch {
      setUpdateInfo(null);
    }
  }, []);

  useEffect(() => {
    if (engineRuntime) return undefined;
    void checkForUpdates();
    const timer = window.setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [checkForUpdates, engineRuntime]);

  const applyWallpaperLayout = useCallback(() => {
    const center = centerHudRef.current;
    const sales = salesHudRef.current;
    const scale = computeWallpaperScale();
    if (center) center.style.zoom = String(scale);
    if (sales) sales.style.zoom = String(scale);
    const map = mapRef.current;
    if (!map) return;
    if (sales) {
      const sr = sales.getBoundingClientRect();
      map.options.pointerIgnoreBottom = Math.max(88, Math.round(window.innerHeight - sr.top + 4));
    } else {
      map.options.pointerIgnoreBottom = pointerIgnoreBottom();
    }
    map.resize();
  }, []);

  useEffect(() => {
    applyWallpaperLayout();
    const onResize = () => window.setTimeout(applyWallpaperLayout, 60);
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(() => applyWallpaperLayout());
    if (containerRef.current) ro.observe(containerRef.current);
    if (centerHudRef.current) ro.observe(centerHudRef.current);
    if (salesHudRef.current) ro.observe(salesHudRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, [applyWallpaperLayout]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    applyWallpaperLayout();
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
      fitOnResize: true,
      fitWorldWidth: 72.7,
      fitCenterX,
      fitCenterY,
      fitCenterZ,
      flipTooltip: true,
      tooltipAvoidSelectors: ['.wallpaper-center', '.wallpaper-sales'],
    }).then((instance) => {
      if (cancelled) {
        instance?.destroy?.();
        return;
      }
      mapRef.current = instance;
      applyWallpaperLayout();
      if (latestPayloadRef.current) {
        mapVersionRef.current = mapDataVersion(latestPayloadRef.current);
        mapRef.current?.updateLayers?.(mapLayers(latestPayloadRef.current, layerOptions));
      }
      window.wallpaperAPI?.ready?.();

      // Resize after mount, DPI settle, and fonts load
      const scheduleResize = (delay: number) => window.setTimeout(() => mapRef.current?.resize?.(), delay);
      scheduleResize(120);
      scheduleResize(600);
      scheduleResize(1200);

      // Listen for resolution / DPI changes
      const dprMq = window.matchMedia('(resolution: 1dppx)');
      const onDprChange = () => scheduleResize(400);
      dprMq.addEventListener('change', onDprChange);

      if (!cancelled) {
        (mapRef as any).__dprCleanup = () => dprMq.removeEventListener('change', onDprChange);
      }
    }).catch(() => {
      setMode('error');
    });

    return () => {
      cancelled = true;
      (mapRef as any).__dprCleanup?.();
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, [applyWallpaperLayout, fitCenterX, fitCenterY, fitCenterZ]);

  useEffect(() => {
    latestPayloadRef.current = payload;
    const nextVersion = mapDataVersion(payload);
    if (!payload || !mapRef.current || nextVersion === mapVersionRef.current) return;
    mapVersionRef.current = nextVersion;
    mapRef.current.updateLayers?.(mapLayers(payload, layerOptions));
    window.setTimeout(() => mapRef.current?.resize?.(), 80);
  }, [payload]);

  const summary = payload?.summary || {};
  const statusText = mode === 'live' ? t('statusLive') : mode === 'cached' ? t('statusCached') : mode === 'loading' ? t('statusLoading') : t('statusError');
  const keyStatus = window.SALES_WALLPAPER_KEY_STATUS || {};
  const salesSummary = payload?.salesSummary || {};
  const hasSalesSummary = Boolean(payload?.sensitiveData && payload?.salesSummary);
  const exchangeSummary = payload?.exchangeSummary || {};
  const hasExchangeSummary = Boolean(payload?.sensitiveData && exchangeSummary.available);
  const keyState = keyStatus.state || 'missing';
  const criticalAlerts = Number(summary.inventoryCriticalCount ?? 0);
  const warningAlerts = Number(summary.inventoryWarningCount ?? 0);
  const totalAlerts = Number(summary.inventoryAlertCount ?? criticalAlerts + warningAlerts);
  const dataModeText = payload?.sensitiveData
    ? t('dataFull')
    : keyState === 'loaded'
      ? t('dataUnauthorized')
      : keyState === 'invalid'
        ? t('dataInvalidKey')
        : t('dataNoKey');
  const shellClassName = `wallpaper-shell${editMode ? ' wallpaper-edit-mode' : ''}`;
  const topHudStyle: CSSProperties = {
    transform: hudTransform('top', hudLayout),
  };
  const salesHudStyle: CSSProperties = {
    transform: hudTransform('sales', hudLayout),
  };

  return (
    <main className={shellClassName}>
      <div className="wallpaper-map" ref={containerRef} />
      <section
        className="wallpaper-hud wallpaper-center"
        ref={centerHudRef}
        aria-label="运营概览"
        style={topHudStyle}
        onPointerDown={(event) => startHudDrag(event, 'top', 'move')}
      >
        <div className="wallpaper-heading">
          <div>
            <div className="wallpaper-title">{t('appTitle')}</div>
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
            <span>{t('totalStations')}</span>
          </div>
          <div>
            <b>{summary.activeStationCount ?? 0}</b>
            <span>{t('activeStations')}</span>
          </div>
          <div>
            <b>{summary.closedStationCount ?? 0}</b>
            <span>{t('closedStations')}</span>
          </div>
          <div>
            <b>{summary.depotCount ?? 0}</b>
            <span>{t('depots')}</span>
          </div>
          <div className="wallpaper-metric-inventory">
            <b>{summary.inventoryLiters == null ? '--' : formatLiters(summary.inventoryLiters, lang)}</b>
            <span>{t('stationInventory')}</span>
          </div>
          {showInventoryAlerts && (
            <div className={`wallpaper-metric-alert${criticalAlerts > 0 ? ' is-critical' : totalAlerts > 0 ? ' is-warning' : ''}`}>
              <b>{summary.inventoryAlertCount == null ? '--' : `${criticalAlerts}/${warningAlerts}`}</b>
              <span>{t('inventoryAlert')}</span>
            </div>
          )}
        </div>
        {editMode && (
          <div
            className="wallpaper-hud-grip"
            onPointerDown={(event) => startHudDrag(event, 'top', 'scale')}
          />
        )}
      </section>

      {showSalesSummary || showExchangeRates ? (
        <section
          className="wallpaper-sales wallpaper-hud"
          ref={salesHudRef}
          aria-label="销售汇总"
          style={salesHudStyle}
          onPointerDown={(event) => startHudDrag(event, 'sales', 'move')}
        >
          {showSalesSummary && (
            <>
              <div className="wallpaper-sales-head">
                <strong>{t('salesTitle')}</strong>
                <span>{hasSalesSummary ? salesSummary.monthEnd || salesSummary.yearEnd || t('actualOperation') : dataModeText}</span>
              </div>
              <div className="wallpaper-sales-grid">
                {(showYearVolume || showYearTons) && (
                  <div className="wallpaper-sales-combo">
                    <span>{t('yearVolumeLabel')}</span>
                    {showYearVolume && <b>{hasSalesSummary ? formatLiters(salesSummary.yearVolumeLiters, lang) : '--'}</b>}
                    {showYearTons && <small>{hasSalesSummary ? formatTons(salesSummary.yearTons, lang) : '--'}</small>}
                  </div>
                )}
                {showYearAmount && (
                  <div className="wallpaper-sales-combo">
                    <span>{t('yearAmount')}</span>
                    <b>{hasSalesSummary ? formatSom(salesSummary.yearAmount, lang) : '--'}</b>
                    <small>{hasSalesSummary ? formatCny(salesSummary.yearAmountCny, lang) : '--'}</small>
                  </div>
                )}
                {(showMonthVolume || showMonthTons) && (
                  <div className="wallpaper-sales-combo">
                    <span>{t('monthVolumeLabel')}</span>
                    {showMonthVolume && <b>{hasSalesSummary ? formatLiters(salesSummary.monthVolumeLiters, lang) : '--'}</b>}
                    {showMonthTons && <small>{hasSalesSummary ? formatTons(salesSummary.monthTons, lang) : '--'}</small>}
                  </div>
                )}
                {showMonthAmount && (
                  <div className="wallpaper-sales-combo">
                    <span>{t('monthAmount')}</span>
                    <b>{hasSalesSummary ? formatSom(salesSummary.monthAmount, lang) : '--'}</b>
                    <small>{hasSalesSummary ? formatCny(salesSummary.monthAmountCny, lang) : '--'}</small>
                  </div>
                )}
              </div>
            </>
          )}
          {showExchangeRates && (
            <>
              <div className="wallpaper-exchange-grid">
                {showUsdKgs && (
                  <div>
                    <span>{t('exchangeUsdKgs')}</span>
                    <b>{hasExchangeSummary ? formatRate(exchangeSummary.usdKgs, lang) : '--'}</b>
                  </div>
                )}
                {showCnyKgs && (
                  <div>
                    <span>{t('exchangeCnyKgs')}</span>
                    <b>{hasExchangeSummary ? formatRate(exchangeSummary.cnyKgs, lang) : '--'}</b>
                  </div>
                )}
              </div>
              <div className="wallpaper-exchange-meta">
                {hasExchangeSummary
                  ? `${formatClock(exchangeSummary.date || '', lang)}${exchangeSummary.source ? ` · ${exchangeSummary.source}` : ''}`
                  : dataModeText}
              </div>
            </>
          )}
          {editMode && (
            <div
              className="wallpaper-hud-grip"
              onPointerDown={(event) => startHudDrag(event, 'sales', 'scale')}
            />
          )}
        </section>
      ) : null}

      {!engineRuntime && updateInfo && (
        <a className="wallpaper-update" href={updateInfo.url} target="_blank" rel="noreferrer">
          <strong>{t('updateBanner')}</strong>
          <span>{t('updateDownload')} {updateInfo.version}</span>
        </a>
      )}
    </main>
  );
}
