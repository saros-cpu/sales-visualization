import { Kgz3DMap } from './Kgz3DMap.js';
import { GlobeMap } from './GlobeMap.js';

const BASE_OPTIONS = {
  basePath: '/kgz-map/data/',
  showRoads: true,
  showRoadPanel: false,
  showLakeLabels: true,
  showCities: true,
  showRegionLabels: false,
  showLegend: false
};

const GLOBE_OPTIONS = {
  basePath: '/kgz-map/data/',
  radius: 10,
  showRoads: false
};

function normalizeTarget(target) {
  return typeof target === 'string' ? document.querySelector(target) : target;
}

function showFallbackMessage(target, error) {
  const el = normalizeTarget(target);
  if (!el) return;
  el.innerHTML = '<div class="kgz-map-fallback">地图资源加载失败，已切换到备用地图。</div>';
  console.error('[Kgz3DMap] load failed:', error);
}

async function mountWithFallback(MapClass, target, options, fallback) {
  const el = normalizeTarget(target);
  try {
    el?.__kgzMapInstance?.destroy?.();
    const map = await MapClass.mount(target, options);
    if (el) el.__kgzMapInstance = map;
    return map;
  } catch (error) {
    console.error('[Kgz3DMap] mount failed:', error);
    if (options.throwOnError) throw error;
    if (typeof fallback === 'function') {
      fallback(error);
    } else {
      showFallbackMessage(target, error);
    }
    if (el?.__kgzMapInstance) delete el.__kgzMapInstance;
    return null;
  }
}

export function mountHomeMap(target = '#mapChart', layers = {}, options = {}) {
  return mountWithFallback(
    Kgz3DMap,
    target,
    {
      ...BASE_OPTIONS,
      mode: 'home',
      ...options
    },
    options.fallback
  ).then((map) => {
    map?.updateLayers({
      depots: layers.depots || [],
      stations: layers.stations || [],
      wholesaleCustomers: layers.customers || layers.wholesaleCustomers || [],
      points: layers.points || []
    });
    return map;
  });
}

export function mountRetailMap(target = '#mapChart', layers = {}, options = {}) {
  return mountWithFallback(
    Kgz3DMap,
    target,
    {
      ...BASE_OPTIONS,
      mode: 'retail',
      ...options
    },
    options.fallback
  ).then((map) => {
    map?.updateLayers({
      depots: layers.depots || [],
      stations: layers.stations || [],
      points: layers.points || []
    });
    return map;
  });
}

export function mountGlobeMap(target = '#mapChart', options = {}) {
  return mountWithFallback(
    GlobeMap,
    target,
    {
      ...GLOBE_OPTIONS,
      ...options
    },
    options.fallback
  ).then((map) => map);
}

export function resizeKgzMap(map) {
  map?.resize?.();
}

window.KgzMapEntry = {
  mountHomeMap,
  mountRetailMap,
  mountGlobeMap,
  resizeKgzMap
};
