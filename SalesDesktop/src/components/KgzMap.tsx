import { useEffect, useRef, useState } from 'react';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Spin, Alert, Button, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { getMapStations, getStationMapDetails } from '@/api/retail';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';
import { localizeMapPoint } from '@shared/map-labels';
import '@/lib/kgz-map/kgz-map.css';
import { useAuth } from '@/contexts/AuthContext';
import { mapRoleVisibleTypes } from '@/config/mapRoles';

interface KgzMapProps {
  height?: string;
}

function resolveKgzDataPath() {
  if (window.location.protocol === 'file:') {
    return new URL('kgz-map/data/', window.location.href).href;
  }
  return new URL('/kgz-map/data/', window.location.origin).href;
}

const CORE_DEPOTS = [
  { name: 'STN-61', short: 'Главная нефтебаза', region: 'REG-01', lng: 0, lat: 0, type: 'headquarters', status: 'normal' },
  { name: 'DemoDepotNorth', short: 'Север DemoDepot', region: 'REG-08', lng: 0, lat: 0, type: 'depot', status: 'closed', closedReason: '装修停业' },
  { name: 'DemoDepotSouth', short: 'Юж DemoDepot', region: 'REG-07', lng: 0, lat: 0, type: 'depot', status: 'normal' },
];

const ZERO_INVENTORY_STATION_KEYS = new Set([11, 12, 21]);

function mapZeroInventoryDetail(detail: any, shopKey: any) {
  if (!ZERO_INVENTORY_STATION_KEYS.has(Number(shopKey))) return detail || {};
  const rows = (detail?.inventoryByResource || []).map((row: any) => {
    const capacity = Number(row?.capacity || 0);
    return {
      ...row,
      inventory: 0,
      fillPercent: row?.fillPercent !== undefined || capacity > 0 ? 0 : row?.fillPercent,
      fillStatus: capacity > 0 ? 'critical' : (row?.fillStatus || 'unknown'),
    };
  });
  const capacity = Number(detail?.inventoryCapacity || 0);
  return {
    ...(detail || {}),
    inventory: 0,
    inventoryByResource: rows,
    inventoryFillPercent: capacity > 0 ? 0 : detail?.inventoryFillPercent,
    inventoryFillStatus: capacity > 0 ? 'critical' : (detail?.inventoryFillStatus || 'unknown'),
    inventoryZeroedByMapRule: true,
    inventoryZeroReason: detail?.closedReason || '停业，库存清零',
  };
}

function depotKey(depot: any) {
  const name = String(depot?.name || depot?.label || '');
  if (depot?.type === 'headquarters' || name.includes('总部') || name.includes('公司总部')) return 'hq';
  if (name.includes('北方')) return 'north';
  if (name.includes('南方')) return 'south';
  return name;
}

function ensureCoreDepots(depots: any[] = []) {
  const list = Array.isArray(depots) ? [...depots] : [];
  const keys = new Set(list.map(depotKey));
  for (const depot of CORE_DEPOTS) {
    if (!keys.has(depotKey(depot))) list.push(depot);
  }
  return list;
}

function normalizeDepotMarker(depot: any) {
  const rawName = String(depot?.name || depot?.nameRu || '');
  const isHeadquarters = depot?.type === 'headquarters' || rawName.includes('总部') || rawName.includes('公司总部');
  const name = rawName === '公司总部' ? 'STN-61' : rawName;
  return {
    ...depot,
    type: 'depot',
    depotType: isHeadquarters ? 'headquarters' : 'branch',
    name,
    label: name,
    short: depot?.short || depot?.nameRu || '',
    status: depot?.status || 'normal',
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
    labelSubtitle: depot?.short || depot?.region || '',
  };
}

export default function KgzMap({ height = 'calc(100vh - 112px)' }: KgzMapProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const mapDataRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const resizeMap = () => {
    window.setTimeout(() => mapInstanceRef.current?.resize?.(), 60);
    window.setTimeout(() => mapInstanceRef.current?.resize?.(), 240);
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === frameRef.current);
      resizeMap();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement === frameRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const toggleFullscreen = async () => {
    const frame = frameRef.current;
    if (!frame || !document.fullscreenEnabled) return;
    if (document.fullscreenElement === frame) {
      await document.exitFullscreen();
    } else {
      await frame.requestFullscreen();
    }
  };

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const [mapRes, detailRes] = await Promise.all([
          getMapStations(),
          getStationMapDetails().catch(() => null),
        ]);
        const data = mapRes?.data || mapRes;
        const detailPayload = detailRes || {};
        const details = detailPayload.items || [];
        const detailMap = new Map(details.map((d: any) => [Number(d.shopKey), d]));

        const visibleTypes = mapRoleVisibleTypes(user?.role);

        const allStations = (data.stations || []).map((s: any) => {
          const detail: any = mapZeroInventoryDetail(detailMap.get(Number(s.shopKey)) || {}, s.shopKey);
          const status = s.status || (ZERO_INVENTORY_STATION_KEYS.has(Number(s.shopKey)) ? 'closed' : 'normal');
          const closedReason = s.closedReason || detail.closedReason || (ZERO_INVENTORY_STATION_KEYS.has(Number(s.shopKey)) ? '停业，库存清零' : '');
          return {
            ...s, type: 'station', size: status === 'closed' ? 0.36 : 0.28,
            status,
            closedReason,
            color: status === 'closed' ? '#ef4444' : s.color,
            inventory: Number(detail.inventory || 0),
            inventoryCapacity: Number(detail.inventoryCapacity || 0),
            inventoryFillPercent: detail.inventoryFillPercent,
            inventoryFillStatus: detail.inventoryFillStatus,
            inventoryAlert: detail.inventoryAlert,
            inventoryAlerts: detail.inventoryAlerts || [],
            inventoryByResource: detail.inventoryByResource || [],
            inventoryAsOf: detail.inventoryAsOf || '',
            priceAsOf: detail.priceAsOf || '',
            statusLabel: detail.statusLabel || (status === 'closed' ? '停业' : '在营'),
            statusType: detail.statusType || status,
            statusNote: detail.statusNote || '',
            snapshotGeneratedAt: detail.snapshotGeneratedAt || detailPayload.snapshotGeneratedAt || '',
            inventoryZeroedByMapRule: Boolean(detail.inventoryZeroedByMapRule),
            inventoryZeroReason: detail.inventoryZeroReason || '',
          };
        });
        const mapLang = i18n.language?.startsWith('ru') ? 'ru' : 'zh';
        const stations = visibleTypes.includes('station') ? allStations.map((p) => localizeMapPoint(p, mapLang)) : [];
        const allDepots = ensureCoreDepots(data.depots || []).map(normalizeDepotMarker);
        const depots = visibleTypes.includes('depot') ? allDepots.map((p) => localizeMapPoint(p, mapLang)) : [];
        const allCustomers = (data.customers || []).map((c: any) => ({ ...c, type: 'wholesale_customer', size: 0.35 }));
        const customers = visibleTypes.includes('customer') ? allCustomers : [];

        mapDataRef.current = { allStations, allDepots, allCustomers, visibleTypes };

        const basePath = resolveKgzDataPath();
        const instance = await mountHomeMap(el, { depots, stations, customers }, {
          basePath,
          showRoadPanel: false, showLakeLabels: true, showCities: true,
          showRegionLabels: false, showLegend: false,
          lang: mapLang,
          initialCamera: {
            cameraX: -0.08,
            cameraY: 30.54,
            cameraZ: 45.81,
            targetX: -0.08,
            targetY: -0.45,
            targetZ: 2.48,
          },
        });
        if (cancelled) {
          instance?.destroy?.();
          return;
        }
        mapInstanceRef.current = instance;
        if (!mapInstanceRef.current) {
          throw new Error(t('map.initFailed'));
        }
        resizeMap();
      } catch (e: any) {
        if (!cancelled) setError(e.message || t('map.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstanceRef.current?.destroy) mapInstanceRef.current.destroy();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = mapInstanceRef.current;
    const data = mapDataRef.current;
    if (!instance || !data) return;
    const lang = i18n.language?.startsWith('ru') ? 'ru' : 'zh';
    const { allStations, allDepots, allCustomers, visibleTypes } = data;
    const stations = visibleTypes.includes('station') ? allStations.map((p: any) => localizeMapPoint(p, lang)) : [];
    const depots = visibleTypes.includes('depot') ? allDepots.map((p: any) => localizeMapPoint(p, lang)) : [];
    const customers = visibleTypes.includes('customer') ? allCustomers : [];
    instance.setLang(lang);
    instance.updateLayers({ depots, stations, customers });
  }, [i18n.language]);

  return (
    <div ref={frameRef} className="sales-map-frame" style={{ position: 'relative', width: '100%', height, background: '#111', borderRadius: 8, overflow: 'hidden' }}>
      {document.fullscreenEnabled && !fullscreen && (
        <Tooltip title={fullscreen ? '退出全屏' : '全屏'}>
          <Button
            aria-label={fullscreen ? '退出全屏' : '全屏'}
            className="sales-map-fullscreen-button"
            icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            size="small"
            onClick={toggleFullscreen}
          />
        </Tooltip>
      )}
      {loading && <Spin style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10 }} />}
      {error && <Alert type="error" message={error} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, minWidth: 300 }} />}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
