import { useEffect, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { mountGlobeMap } from '@/lib/kgz-map/kgz-map-entry';
import { API_HOST } from '@/api/http';

interface GlobeMapProps {
  height?: string;
}

function resolveKgzDataPath() {
  return new URL('/assets/kgz-map/data/', API_HOST).href;
}

export default function GlobeMap({ height = 'calc(100vh - 112px)' }: GlobeMapProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mapInstance: any = null;
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const basePath = resolveKgzDataPath();
        const instance = await mountGlobeMap(el, { basePath, showRoads: false, language: i18n.language });
        if (cancelled) {
          instance?.destroy?.();
          return;
        }
        mapInstance = instance;
        if (!instance) {
          throw new Error(t('map.initFailed'));
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || t('map.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (mapInstance?.destroy) mapInstance.destroy();
    };
  }, [t, i18n.language]);

  return (
    <div style={{ position: 'relative', width: '100%', height, background: '#111', borderRadius: 8, overflow: 'hidden' }}>
      {loading && <Spin style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10 }} />}
      {error && <Alert type="error" message={error} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, minWidth: 300 }} />}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
