import { useEffect, useRef, useState } from 'react';
import { Spin, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import client from '@/api/client';
import { mountHomeMap } from '@/lib/kgz-map/kgz-map-entry';

export default function KgzMap() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mapInstance: any = null;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      try {
        const res = await client.get('/map/stations');
        const data = res.data?.data || res.data;
        const stations = (data.stations || []).map((s: any) => ({ ...s, type: 'station', size: 0.28 }));
        const depots = (data.depots || []).map((d: any) => ({ ...d, type: 'depot', size: 0.55 }));
        const customers = (data.customers || []).map((c: any) => ({ ...c, type: 'wholesale_customer', size: 0.35 }));

        mapInstance = await mountHomeMap(el, { depots, stations, customers }, {
          basePath: '/kgz-map/data/',
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
