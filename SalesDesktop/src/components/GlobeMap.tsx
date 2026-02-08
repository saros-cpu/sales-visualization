import { useEffect, useRef, useState } from 'react';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Alert, Button, Spin, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { mountGlobeMap } from '@/lib/kgz-map/kgz-map-entry';

interface GlobeMapProps {
  height?: string;
}

function resolveKgzDataPath() {
  if (window.location.protocol === 'file:') {
    return new URL('kgz-map/data/', window.location.href).href;
  }
  return new URL('/kgz-map/data/', window.location.origin).href;
}

export default function GlobeMap({ height = 'calc(100vh - 112px)' }: GlobeMapProps) {
  const { t, i18n } = useTranslation();
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
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
        const basePath = resolveKgzDataPath();
        const instance = await mountGlobeMap(el, { basePath, showRoads: false, language: i18n.language, throwOnError: true });
        if (cancelled) {
          instance?.destroy?.();
          return;
        }
        mapInstanceRef.current = instance;
        if (!instance) {
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
  }, [t, i18n.language]);

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
