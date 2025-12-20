import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULTS = {
  basePath: './data/',
  showRoads: true,
  showRoadPanel: true,
  showLakeLabels: true,
  showCities: true,
  showRegionLabels: true,
  showLegend: true,
  viewOffsetX: 0,
  viewOffsetZ: 0,
  mode: 'standalone'
};

const ROAD_STYLE = {
  motorway: { color: 0xf8fafc, y: 1.04, opacity: 0.94, label: '高速 / motorway' },
  motorway_link: { color: 0xf8fafc, y: 1.02, opacity: 0.76, label: '高速连接线' },
  trunk: { color: 0xf8fafc, y: 1, opacity: 0.82, label: '主干公路 / trunk' },
  primary: { color: 0xf8fafc, y: 0.98, opacity: 0.62, label: '一级公路 / primary' },
  trunk_link: { color: 0xf8fafc, y: 0.99, opacity: 0.56, label: '主干连接线' },
  primary_link: { color: 0xf8fafc, y: 0.98, opacity: 0.48, label: '一级连接线' },
  unclassified: { color: 0xf8fafc, y: 0.97, opacity: 0.28, label: '未分类道路' },
  track: { color: 0xf8fafc, y: 0.96, opacity: 0.2, label: '湖区便道' }
};

const ROAD_SURFACE_Y = {
  motorway: 0.735,
  motorway_link: 0.732,
  trunk: 0.73,
  trunk_link: 0.728,
  primary: 0.726,
  primary_link: 0.724,
  secondary: 0.722,
  secondary_link: 0.721,
  tertiary: 0.72,
  tertiary_link: 0.719,
  unclassified: 0.719,
  track: 0.718
};

const ROAD_OPACITY = {
  city_main: 0.86,
  secondary: 0.42,
  secondary_link: 0.34,
  tertiary: 0.3,
  tertiary_link: 0.24,
  unclassified: 0.28,
  track: 0.2
};

const LAKE_SURFACE_Y = 0.718;
const CENTER_LNG = 74;
const CENTER_LAT = 41.5;
const SCALE = 8;
const REGION_ORDER = [
  'KGZ.8_1',
  'KGZ.9_1',
  'KGZ.2_1',
  'KGZ.5_1',
  'KGZ.7_1',
  'KGZ.3_1',
  'KGZ.4_1',
  'KGZ.6_1',
  'KGZ.1_1'
];

function geoToWorld(lng, lat) {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return {
    x: (lng - CENTER_LNG) * SCALE * cosLat,
    z: -(lat - CENTER_LAT) * SCALE
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDateTimeText(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const cleaned = text.replace('T', ' ').replace(/\.\d+/, '').replace(/([+-]\d{2}:?\d{2}|Z)$/i, '').trim();
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
  if (!match) return cleaned.slice(0, 16);
  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}

function hasTimePart(value) {
  return /\d{1,2}:\d{2}/.test(String(value || ''));
}

function stationTimeRows(point) {
  if (point.type !== 'station') return '';
  const dataAsOf = formatDateTimeText(point.inventoryAsOf);
  const snapshotGeneratedAt = formatDateTimeText(point.snapshotGeneratedAt);
  const dataRow = dataAsOf && !hasTimePart(dataAsOf)
    ? `<span class="kgz-map-tooltip-muted">数据日期：${escapeHtml(dataAsOf)}</span>`
    : '';
  const snapshotRow = snapshotGeneratedAt
    ? `<span class="kgz-map-tooltip-muted">快照时间：${escapeHtml(snapshotGeneratedAt)}</span>`
    : dataAsOf
      ? `<span class="kgz-map-tooltip-muted">快照时间：${escapeHtml(dataAsOf)}</span>`
    : '';
  return `${dataRow}${snapshotRow}`;
}

function fuelDetailRows(point) {
  const rows = Array.isArray(point.inventoryByResource) ? point.inventoryByResource : [];
  if (!rows.length) return '';
  return `<div class="kgz-map-tooltip-section">
    <b>库存 / 零售价</b>
    ${rows.slice(0, 6).map((item) => {
      const price = item.price == null ? '—' : `${formatNumber(item.price, 2)} 索姆/L`;
      return `<em><span>${escapeHtml(item.name)}</span><span>${formatNumber(item.inventory, 2)} L · ${price}</span></em>`;
    }).join('')}
  </div>`;
}

function cleanRing(ring) {
  const points = ring.map(([lng, lat]) => {
    const p = geoToWorld(lng, lat);
    return new THREE.Vector2(p.x, -p.z);
  });
  if (points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-8) {
    points.pop();
  }
  return points;
}

function ensureOrientation(points, clockwise) {
  const isClockwise = THREE.ShapeUtils.isClockWise(points);
  return isClockwise === clockwise ? points : points.slice().reverse();
}

function polygonTCTY-30apes(polygon) {
  if (!polygon?.[0]?.length) return [];
  const outer = ensureOrientation(cleanRing(polygon[0]), true);
  if (outer.length < 3) return [];
  const shape = new THREE.Shape(outer);
  for (const hole of polygon.slice(1)) {
    const holePoints = ensureOrientation(cleanRing(hole), false);
    if (holePoints.length >= 3) shape.holes.push(new THREE.Path(holePoints));
  }
  return [shape];
}

function featureTCTY-30apes(feature) {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return polygonTCTY-30apes(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap(polygonTCTY-30apes);
  return [];
}

function makeTextSprite(title, subtitle) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 280;
  const height = 88;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(5, 12, 28, 0.72)';
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, 8, 10, width - 16, height - 20, 8);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 18px system-ui, Microsoft YaHei, sans-serif';
  ctx.fillText(title || '', width / 2, 34);
  ctx.fillStyle = '#b6c7d8';
  ctx.font = '13px system-ui, Segoe UI, sans-serif';
  ctx.fillText(subtitle || '', width / 2, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(7.2, 2.25, 1);
  return sprite;
}

function makeLakeLabelSprite(title, scaleX = 3.5) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 220;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = '700 26px Microsoft YaHei, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(5, 15, 30, 0.78)';
  ctx.fillStyle = 'rgba(235, 250, 255, 0.96)';
  ctx.strokeText(title, width / 2, height / 2);
  ctx.fillText(title, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleX, scaleX * 0.28, 1);
  sprite.renderOrder = 122;
  return sprite;
}

function makePointLabelSprite(title, subtitle = '', options = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = 210;
  const height = subtitle ? 66 : 46;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.background || 'rgba(4, 12, 28, 0.82)';
  ctx.strokeStyle = options.border || 'rgba(226, 232, 240, 0.34)';
  ctx.lineWidth = 1;
  roundRect(ctx, 5, 5, width - 10, height - 10, 8);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = options.color || '#f8fafc';
  ctx.font = '700 17px Microsoft YaHei, Arial, sans-serif';
  ctx.fillText(title || '', width / 2, subtitle ? 26 : height / 2);
  if (subtitle) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px Microsoft YaHei, Arial, sans-serif';
    ctx.fillText(subtitle, width / 2, 47);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  const scale = options.scale || 2.35;
  sprite.scale.set(scale, scale * (height / width), 1);
  sprite.renderOrder = 150;
  return sprite;
}

function ringArea(points) {
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return area / 2;
}

function ringCentroid(points) {
  let areaFactor = 0;
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const cross = points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    areaFactor += cross;
    lng += (points[i][0] + points[i + 1][0]) * cross;
    lat += (points[i][1] + points[i + 1][1]) * cross;
  }
  if (Math.abs(areaFactor) < 1e-8) {
    const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }
  return [lng / (3 * areaFactor), lat / (3 * areaFactor)];
}

function featureLargestRing(feature) {
  const geometry = feature.geometry;
  if (!geometry) return null;
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let bestRing = null;
  let bestArea = 0;
  for (const polygon of polygons) {
    const ring = polygon?.[0];
    if (!ring?.length) continue;
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      bestRing = ring;
    }
  }
  return bestRing;
}

function featureLabelCenter(feature) {
  const bestRing = featureLargestRing(feature);
  return bestRing ? ringCentroid(bestRing) : null;
}

function lakeLabelScale(feature) {
  const ring = featureLargestRing(feature);
  if (!ring) return 1.2;
  const points = ring.map(([lng, lat]) => geoToWorld(lng, lat));
  const spanX = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
  const spanZ = Math.max(...points.map((point) => point.z)) - Math.min(...points.map((point) => point.z));
  return THREE.MathUtils.clamp(Math.max(spanX, spanZ) * 0.78, 1.42, 3.5);
}

function makeCitySprite(city) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = city.rank === 1 ? 132 : 108;
  const height = city.rank === 1 ? 34 : 28;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  const dotX = 9;
  ctx.beginPath();
  ctx.arc(dotX, height / 2, city.rank === 1 ? 3.4 : 2.6, 0, Math.PI * 2);
  ctx.fillStyle = city.rank === 1 ? 'rgba(248,250,252,0.92)' : 'rgba(219,234,254,0.78)';
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${city.rank === 1 ? 700 : 600} ${city.rank === 1 ? 12 : 10}px system-ui, Microsoft YaHei, sans-serif`;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(3, 7, 18, 0.86)';
  ctx.fillStyle = city.rank === 1 ? 'rgba(255,255,255,0.96)' : 'rgba(220,232,244,0.78)';
  ctx.strokeText(city.name_zh, 18, height / 2);
  ctx.fillText(city.name_zh, 18, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(city.rank === 1 ? 3.4 : 2.6, city.rank === 1 ? 0.88 : 0.68, 1);
  sprite.renderOrder = 120;
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function buildRoadMesh(features, type) {
  const style = ROAD_STYLE[type] || ROAD_STYLE.primary;
  const roadY = ROAD_SURFACE_Y[type] || ROAD_SURFACE_Y.primary;
  const vertices = [];

  for (const feature of features) {
    const coords = feature.geometry?.coordinates || [];
    if (coords.length < 2) continue;
    const pts = coords.map(([lng, lat]) => {
      const p = geoToWorld(lng, lat);
      return new THREE.Vector3(p.x, roadY, p.z);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  if (!vertices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const material = new THREE.LineBasicMaterial({
    color: style.color,
    transparent: true,
    opacity: ROAD_OPACITY[type] ?? style.opacity,
    depthTest: false,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.userData = { roadType: type };
  lines.renderOrder = 100;
  return lines;
}

function groupsForRef(groups, ref) {
  let count = 0;
  for (const features of groups.values()) {
    for (const feature of features) {
      const refs = String(feature.properties?.ref || '').split(';').map((item) => item.trim());
      if (refs.includes(ref)) count += 1;
    }
  }
  return count;
}

export class Kgz3DMap {
  static async mount(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`Kgz3DMap target not found: ${target}`);
    const instance = new Kgz3DMap(el, { ...DEFAULTS, ...options });
    await instance.init();
    return instance;
  }

  constructor(container, options) {
    this.container = container;
    this.options = options;
    this.regionMeshes = [];
    this.pointMeshes = [];
    this.regionById = new Map();
    this.hoveredRegion = null;
    this.hoveredPoint = null;
    this.frame = null;
    this.needsRender = true;
    this.clock = new THREE.Clock();
  }

  async init() {
    this.container.classList.add('kgz-map-root');
    this.container.innerHTML = '';
    this.createDom();
    this.createScene();
    const [regions, roads, lakes, cities, majorRoads] = await Promise.all([
      this.loadJson('kgz_regions.json'),
      this.options.showRoads ? this.loadJson('roads.json').catch(() => null) : null,
      this.loadJson('lakes.json').catch(() => null),
      this.loadJson('major_cities.json').catch(() => []),
      this.loadJson('major_roads.json').catch(() => [])
    ]);
    this.buildRegions(regions);
    if (lakes) this.buildLakes(lakes);
    if (roads) this.buildRoads(roads, majorRoads);
    if (this.options.showRoads) {
      const cityMainRoads = await this.loadJson('city_main_roads.json').catch(() => null);
      if (cityMainRoads) this.buildCityMainRoads(cityMainRoads);
    }
    if (this.options.showCities) this.buildCities(cities);
    this.bindEvents();
    this.resize();
    if (this.options.initialCamera) {
      const ic = this.options.initialCamera;
      this.camera.position.set(ic.cameraX, ic.cameraY, ic.cameraZ);
      this.controls.target.set(ic.targetX, ic.targetY, ic.targetZ);
      this.controls.update();
    } else {
      this.fitCamera();
    }
    this.renderer.render(this.scene, this.camera);
    this.animate();
    this.hideLoading();
  }

  createDom() {
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'kgz-map-canvas';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'kgz-map-tooltip';
    this.loading = document.createElement('div');
    this.loading.className = 'kgz-map-loading';
    this.loading.textContent = '加载 3D 地图...';
    this.container.append(this.canvasWrap, this.tooltip, this.loading);
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = null;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    this.camera.position.set(0, 34, 42);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvasWrap.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 105;
    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.addEventListener('change', () => this.requestRender());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.regionGroup = new THREE.Group();
    this.roadGroup = new THREE.Group();
    this.labelGroup = new THREE.Group();
    this.lakeGroup = new THREE.Group();
    this.pointGroup = new THREE.Group();
    this.scene.add(this.regionGroup, this.lakeGroup, this.roadGroup, this.labelGroup, this.pointGroup);

    this.scene.add(new THREE.AmbientLight(0x8fb3ff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(20, 36, 18);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x60a5fa, 0.38);
    fill.position.set(-22, 14, -18);
    this.scene.add(fill);
  }

  async loadJson(file) {
    const fileBase = typeof window !== 'undefined' && window.location?.protocol === 'file:'
      ? new URL('kgz-map/data/', window.location.href).href
      : null;
    const bases = [...new Set([this.options.basePath, fileBase, '/kgz-map/data/', '/assets/kgz-map/data/'].filter(Boolean))];
    let lastError = null;
    for (const base of bases) {
      try {
        const response = await fetch(`${base}${file}`);
        if (!response.ok) throw new Error(`无法加载 ${file}`);
        return response.json();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`无法加载 ${file}`);
  }

  buildRegions(geojson) {
    geojson.features.forEach((feature) => {
      const shapes = featureTCTY-30apes(feature);
      const props = feature.properties || {};
      const color = new THREE.Color(props.color_hex || '#38bdf8');
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.03,
        transparent: true,
        opacity: 0.82,
        emissive: color,
        emissiveIntensity: 0.06
      });
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xc7f9ff,
        transparent: true,
        opacity: 0.38
      });
      for (const shape of shapes) {
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.68,
          bevelEnabled: true,
          bevelThickness: 0.035,
          bevelSize: 0.035,
          bevelSegments: 2
        });
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material.clone());
        mesh.userData = { type: 'region', feature, baseColor: color.clone(), baseEmissive: color.clone() };
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial.clone());
        const group = new THREE.Group();
        group.add(mesh, edges);
        this.regionGroup.add(group);
        this.regionMeshes.push(mesh);
        this.regionById.set(props.gid, mesh);
      }
      if (this.options.showRegionLabels) {
        const p = geoToWorld(props.center_lng, props.center_lat);
        const label = makeTextSprite(props.name_zh || props.name_en, props.name_ru || props.name_en);
        label.position.set(p.x, 1.75, p.z);
        this.labelGroup.add(label);
      }
    });
    this.buildLegend(geojson.features);
  }

  buildRoads(geojson, majorRoads = []) {
    const groups = new Map();
    for (const feature of geojson.features || []) {
      const type = feature.properties?.highway || 'primary';
      if (!groups.has(type)) groups.set(type, []);
      groups.get(type).push(feature);
    }
    for (const [type, features] of groups.entries()) {
      const mesh = buildRoadMesh(features, type);
      if (mesh) this.roadGroup.add(mesh);
    }
    if (this.options.showRoadPanel) this.buildRoadPanel(groups, majorRoads);
  }

  buildCityMainRoads(geojson) {
    const mesh = buildRoadMesh(geojson.features || [], 'city_main');
    if (mesh) {
      mesh.renderOrder = 102;
      this.roadGroup.add(mesh);
    }
  }

  buildLakes(geojson) {
    const lakeMaterial = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.62,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.75,
      depthTest: false
    });

    for (const feature of geojson.features || []) {
      const shapes = featureTCTY-30apes(feature);
      for (const shape of shapes) {
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, LAKE_SURFACE_Y, 0);
        const lake = new THREE.Mesh(geometry, lakeMaterial.clone());
        lake.renderOrder = 80;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial.clone());
        edges.renderOrder = 81;
        this.lakeGroup.add(lake, edges);
      }
      if (this.options.showLakeLabels) {
        const center = featureLabelCenter(feature);
        const name = feature.properties?.name_zh || feature.properties?.name_en;
        if (center && name) {
          const p = geoToWorld(center[0], center[1]);
          const label = makeLakeLabelSprite(name, lakeLabelScale(feature));
          label.position.set(p.x, LAKE_SURFACE_Y + 0.18, p.z);
          this.lakeGroup.add(label);
        }
      }
    }
  }

  buildRoadPanel(groups, majorRoads = []) {
    const panel = document.createElement('div');
    panel.className = 'kgz-road-panel';
    const corridorRows = majorRoads.map((road) => {
      return `<li title="${road.corridor}"><span>${road.ref} · ${road.name_zh}</span><strong>${road.length_km}km</strong></li>`;
    }).join('');
    const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
    panel.innerHTML = `<h3>道路信息</h3><p>当前显示 OSM 道路数据中的 ${total} 条路段，白色细线为逐段绘制。</p>${corridorRows ? `<h4>主要走向</h4><ul>${corridorRows}</ul>` : ''}`;
    this.container.appendChild(panel);
  }

  buildCities(cities) {
    this.cityGroup = new THREE.Group();
    for (const city of cities || []) {
      const p = geoToWorld(city.lng, city.lat);
      const sprite = makeCitySprite(city);
      sprite.position.set(p.x, city.rank === 1 ? 1.06 : 1.02, p.z);
      this.cityGroup.add(sprite);
    }
    this.scene.add(this.cityGroup);
  }

  setPoints(points = []) {
    this.pointGroup.clear();
    this.pointMeshes = [];
    const palette = {
      depot: 0x22d3ee,
      wholesale_customer: 0xfacc15,
      station: 0x34d399,
      default: 0xf8fafc
    };
    for (const point of points) {
      if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
      const p = geoToWorld(point.lng, point.lat);
      const color = point.color || palette[point.type] || palette.default;
      const pointSize = point.size || 0.08;
      const pointOpacity = point.opacity ?? 0.95;
      const geometry = new THREE.SphereGeometry(pointSize, 12, 8);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: pointOpacity,
        depthTest: false,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(p.x, point.y ?? 0.98, p.z);
      mesh.renderOrder = 130;
      mesh.userData = {
        type: 'business-point',
        point,
        baseColor: new THREE.Color(color),
        baseOpacity: pointOpacity,
        baseScale: pointSize,
        baseY: point.y ?? 0.98
      };
      this.pointGroup.add(mesh);
      this.pointMeshes.push(mesh);
      if (point.showLabel !== false) {
        const label = makePointLabelSprite(point.label || point.name, point.labelSubtitle || '', {
          color: point.labelColor || '#f8fafc',
          background: point.labelBackground,
          border: point.labelBorder,
          scale: point.labelScale
        });
        label.position.set(p.x, point.labelY ?? ((point.y ?? 0.98) + (point.size || 0.08) + 0.36), p.z);
        this.pointGroup.add(label);
      }
    }
    this.requestRender();
  }

  updateLayers(layers = {}) {
    const points = [
      ...(layers.depots || []),
      ...(layers.wholesaleCustomers || []),
      ...(layers.stations || []),
      ...(layers.points || [])
    ];
    this.setPoints(points);
  }

  buildLegend(features) {
    if (!this.options.showLegend) return;
    const legend = document.createElement('div');
    legend.className = 'kgz-map-legend';
    const sortedFeatures = [...features].sort((a, b) => {
      const aIndex = REGION_ORDER.indexOf(a.properties?.gid);
      const bIndex = REGION_ORDER.indexOf(b.properties?.gid);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    legend.innerHTML = sortedFeatures.map((feature) => {
      const p = feature.properties || {};
      return `<button type="button" data-region="${p.gid}">
        <strong>${p.name_zh || p.name_en}</strong>
        <small>${p.name_ru || p.name_en}</small>
      </button>`;
    }).join('');
    legend.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-region]');
      if (!button) return;
      this.focusRegion(button.dataset.region);
    });
    this.container.appendChild(legend);
  }

  focusRegion(gid) {
    const mesh = this.regionById.get(gid);
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    center.x += this.options.viewOffsetX || 0;
    center.z += this.options.viewOffsetZ || 0;
    this.controls.target.copy(center);
    this.camera.position.set(center.x, 22, center.z + 24);
    this.requestRender();
  }

  fitCamera() {
    const box = new THREE.Box3().setFromObject(this.regionGroup);
    const center = box.getCenter(new THREE.Vector3());
    center.x += this.options.viewOffsetX || 0;
    center.z += this.options.viewOffsetZ || 0;
    const size = box.getSize(new THREE.Vector3());
    const aspect = Math.max(0.1, this.camera.aspect || 1);
    const mapSpan = Math.max(size.z, size.x / aspect);
    const distanceFactor = aspect < 0.75 ? 2 : 1.65;
    const distance = THREE.MathUtils.clamp(mapSpan * distanceFactor, 46, 160);
    const height = THREE.MathUtils.clamp(distance * (aspect < 0.75 ? 1 : 0.72), 30, 72);
    this.controls.target.copy(center);
    this.camera.position.set(center.x, height, center.z + distance);
    this.controls.update();
    this.requestRender();
  }

  bindEvents() {
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerLeave = () => this.clearHover();
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  handlePointerMove(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pointHit = this.raycaster.intersectObjects(this.pointMeshes, false)[0];
    if (pointHit) {
      this.setPointHover(pointHit.object, event);
      return;
    }
    this.clearPointHover();
    const hit = this.raycaster.intersectObjects(this.regionMeshes, false)[0];
    if (!hit) {
      this.clearHover();
      return;
    }
    if (this.hoveredRegion !== hit.object) {
      this.clearRegionHover();
      this.hoveredRegion = hit.object;
      this.hoveredRegion.material.color.set(0x0ea5e9);
      this.hoveredRegion.material.emissive.set(0x38bdf8);
      this.hoveredRegion.material.emissiveIntensity = 0.35;
      this.hoveredRegion.material.opacity = 0.95;
    }
    const props = hit.object.userData.feature.properties;
    this.tooltip.innerHTML = `<strong>${escapeHtml(props.name_zh || props.name_en)}</strong><span>${escapeHtml(props.name_ru || props.name_en)}</span>`;
    this.tooltip.style.transform = `translate(${event.offsetX + 16}px, ${event.offsetY + 16}px)`;
    this.tooltip.classList.add('visible');
    this.renderer.domElement.style.cursor = 'default';
    this.requestRender();
  }

  clearHover() {
    this.clearPointHover();
    this.clearRegionHover();
    this.tooltip.classList.remove('visible');
    this.renderer.domElement.style.cursor = '';
    this.requestRender();
  }

  setPointHover(mesh, event) {
    this.clearRegionHover();
    if (this.hoveredPoint !== mesh) {
      this.clearPointHover();
      this.hoveredPoint = mesh;
      const point = mesh.userData.point || {};
      mesh.material.color.set(point.hoverColor || '#ffffff');
      mesh.material.opacity = 1;
      mesh.scale.setScalar(point.hoverScale || 1.68);
      mesh.position.y = (mesh.userData.baseY || 0.98) + (point.hoverLift || 0.08);
      mesh.renderOrder = 180;
    }
    const point = mesh.userData.point || {};
    const subtitle = point.labelSubtitle || point.short || point.type || '';
    const region = point.region ? `<span>${escapeHtml(point.region)}</span>` : '';
    const statusText = point.closedReason || (point.status === 'closed' ? '停业/维修' : '');
    const status = statusText ? `<span>${escapeHtml(statusText)}</span>` : '';
    const inventory = point.type === 'station'
      ? `<span>当前库存：${formatNumber(point.inventory || 0, 2)} L</span>`
      : '';
    const timeRows = stationTimeRows(point);
    this.tooltip.innerHTML = `<strong>${escapeHtml(point.label || point.name || '业务点位')}</strong>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}${region}${status}${inventory}${fuelDetailRows(point)}${timeRows}`;
    this.tooltip.style.transform = `translate(${event.offsetX + 16}px, ${event.offsetY + 16}px)`;
    this.tooltip.classList.add('visible');
    this.renderer.domElement.style.cursor = 'pointer';
    this.requestRender();
  }

  clearPointHover() {
    if (!this.hoveredPoint) return;
    const mesh = this.hoveredPoint;
    mesh.material.color.copy(mesh.userData.baseColor);
    mesh.material.opacity = mesh.userData.baseOpacity;
    mesh.scale.setScalar(1);
    mesh.position.y = mesh.userData.baseY;
    mesh.renderOrder = 130;
    this.hoveredPoint = null;
  }

  clearRegionHover() {
    if (!this.hoveredRegion) return;
    this.hoveredRegion.material.color.copy(this.hoveredRegion.userData.baseColor);
    this.hoveredRegion.material.emissive.copy(this.hoveredRegion.userData.baseEmissive || this.hoveredRegion.userData.baseColor);
    this.hoveredRegion.material.emissiveIntensity = 0.06;
    this.hoveredRegion.material.opacity = 0.82;
    this.hoveredRegion = null;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  animate() {
    this.frame = requestAnimationFrame(() => this.animate());
    const controlsChanged = this.controls.update();
    if (this.needsRender || controlsChanged || this.clock.getElapsedTime() < 2) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }

  hideLoading() {
    this.loading.classList.add('hidden');
    setTimeout(() => this.loading?.remove(), 260);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }

  /** Console helper: call __map3d.inspect() to see current camera & offset */
  inspect() {
    const cam = this.camera.position;
    const tgt = this.controls.target;
    const info = {
      viewOffsetX: this.options.viewOffsetX ?? 0,
      viewOffsetZ: this.options.viewOffsetZ ?? 0,
      cameraPosition: { x: +cam.x.toFixed(2), y: +cam.y.toFixed(2), z: +cam.z.toFixed(2) },
      controlsTarget: { x: +tgt.x.toFixed(2), y: +tgt.y.toFixed(2), z: +tgt.z.toFixed(2) },
      containerSize: `${this.container.offsetWidth}x${this.container.offsetHeight}px`,
    };
    console.table(info);
    return info;
  }

  /** Set viewOffsetX live and re-fit camera: __map3d.setOffsetX(-5) */
  setOffsetX(x) {
    this.options.viewOffsetX = x;
    this.fitCamera();
    console.log(`viewOffsetX set to ${x}, call __map3d.inspect() to verify`);
  }
}

window.Kgz3DMap = Kgz3DMap;
