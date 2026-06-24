import { Kgz3DMap } from './Kgz3DMap.js?v=20260801-hover-hit';

const BASE_OPTIONS = {
  basePath: '/assets/kgz-map/data/',
  showRoads: true,
  showRoadPanel: false,
  showLakeLabels: true,
  showCities: true,
  showRegionLabels: false,
  showLegend: false
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

async function mountWithFallback(target, options, fallback) {
  try {
    return await Kgz3DMap.mount(target, options);
  } catch (error) {
    if (typeof fallback === 'function') {
      fallback(error);
    } else {
      showFallbackMessage(target, error);
    }
    return null;
  }
}

export function mountHomeMap(target = '#mapChart', layers = {}, options = {}) {
  return mountWithFallback(
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
      wholesaleCustomers: layers.wholesaleCustomers || [],
      points: layers.points || []
    });
    return map;
  });
}

export function mountRetailMap(target = '#mapChart', layers = {}, options = {}) {
  return mountWithFallback(
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

export function resizeKgzMap(map) {
  map?.resize?.();
}

window.KgzMapEntry = {
  mountHomeMap,
  mountRetailMap,
  resizeKgzMap
};
