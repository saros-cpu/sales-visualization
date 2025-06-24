import { useEffect, useRef, useState } from 'react';
import { Spin, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import client from '@/api/client';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';
import { useAuth } from '@/contexts/AuthContext';
import { mapRoleVisibleTypes } from '@/config/mapRoles';

export default function KgzMap() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mapInstance: any = null;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      try {
        const token = localStorage.getItem('accessToken') || '';
        const detailHeaders: Record<string, string> = {};
        if (token) detailHeaders['Authorization'] = `Bearer ${token}`;
        const [mapRes, detailRes] = await Promise.all([
          client.get('/map/stations'),
          axios.get('http://198.51.100.10:8080/api/station-map-details', { headers: detailHeaders }).catch(() => null),
        ]);
        const data = mapRes.data?.data || mapRes.data;
        const details = detailRes?.data?.items || [];
        const detailMap = new Map(details.map((d: any) => [Number(d.shopKey), d]));

        const visibleTypes = mapRoleVisibleTypes(user?.role);

        const allStations = (data.stations || []).map((s: any) => {
          const detail: any = detailMap.get(Number(s.shopKey)) || {};
          return {
            ...s, type: 'station', size: 0.28,
            inventory: Number(detail.inventory || 0),
            inventoryByResource: detail.inventoryByResource || [],
            inventoryAsOf: detail.inventoryAsOf || '',
          };
        });
        const stations = visibleTypes.includes('station') ? allStations : [];
        const allDepots = (data.depots || []).map((d: any) => ({ ...d, type: 'depot', size: 0.55 }));
        const depots = visibleTypes.includes('depot') ? allDepots : [];
        const allCustomers = (data.customers || []).map((c: any) => ({ ...c, type: 'wholesale_customer', size: 0.35 }));
        const customers = visibleTypes.includes('customer') ? allCustomers : [];

        const basePath = typeof window.updater !== 'undefined'
          ? 'http://198.51.100.10:8080/kgz-map/data/'
          : '/kgz-map/data/';
        mapInstance = await mountHomeMap(el, { depots, stations, customers }, {
          basePath,
          showRoadPanel: false, showLakeLabels: true, showCities: true,
          showRegionLabels: false, showLegend: false,
          initialCamera: { cameraX: -2.35, cameraY: 24.77, cameraZ: 38.2, targetX: -2.35, targetY: 0.33, targetZ: 3.95 },
        });
        if (!mapInstance) {
          throw new Error(t('map.initFailed'));
        }
      } catch (e: any) {
        setError(e.message || t('map.loadFailed'));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (mapInstance?.destroy) mapInstance.destroy();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 112px)', background: '#111', borderRadius: 8, overflow: 'hidden' }}>
      {loading && <Spin style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10 }} />}
      {error && <Alert type="error" message={error} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, minWidth: 300 }} />}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
