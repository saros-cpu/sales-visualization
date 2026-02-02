import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULTS = {
  basePath: './data/',
  precisionCountriesFile: 'precision_countries.geojson',
  radius: 10,
  autoRotateSpeed: 0.03,
  showRoads: true,
  focusLng: 74.6,
  focusLat: 41.3,
  framePadding: 1.07,
  frameRadiusScale: 1.06,
  manualMinDistanceScale: 1.35
};

const DEG2RAD = Math.PI / 180;

const POINT_PALETTE = {
  depot: 0x22d3ee,
  station: 0x34d399,
  headquarters: 0xef4444,
  export_customer: 0xa78bfa,
  oil_source: 0xfb923c,
  default: 0xf8fafc
};

const POINT_SIZE = {
  station: 0.035,
  depot: 0.05,
  headquarters: 0.075,
  export_customer: 0.033,
  oil_source: 0.033,
  default: 0.04
};

const HIGHLIGHT_COLOR = {
  KGZ: 0xef4444,
  default: 0x38bdf8
};

const BOUNDARY_INDEX_CELL_DEGREES = 0.5;

const COUNTRY_RU = {
  '中国': 'Китай',
  '俄罗斯': 'Россия',
  '哈萨克斯坦': 'Казахстан',
  '吉尔吉斯斯坦': 'Кыргызстан',
  '乌兹别克斯坦': 'Узбекистан',
  '塔吉克斯坦': 'Таджикистан',
  '土耳其': 'Турция',
  '格鲁吉亚': 'Грузия',
  '白俄罗斯': 'Беларусь',
  '阿富汗': 'Афганистан'
};

const REGION_RU = {
  'REG-01': 'CTY-01',
  'REG-06': 'CTY-04',
  'REG-07': 'CTY-05',
  'REG-02': 'CTY-03',
  'REG-03': 'CTY-18 область',
  'REG-04': 'CTY-02',
  'REG-05': 'CTY-16 область'
};

function latLngToVec3(lng, lat, radius) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function dropClosing(ring) {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) {
      return ring.slice(0, -1);
    }
  }
  return ring;
}

function polygonToFillGeometry(polygon, radius) {
  const outer = dropClosing(polygon[0] || []);
  if (outer.length < 3) return null;
  const contour = outer.map(([lng, lat]) => new THREE.Vector2(lng, lat));
  const holeRings = polygon.slice(1).map((hole) => dropClosing(hole).map(([lng, lat]) => new THREE.Vector2(lng, lat)));
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holeRings);
  } catch {
    return null;
  }
  const flat = [...contour, ...holeRings.flat()];
  const vertices = flat.map((p) => latLngToVec3(p.x, p.y, radius));
  const positions = [];
  for (const face of faces) {
    for (const idx of face) {
      const v = vertices[idx];
      if (!v) continue;
      positions.push(v.x, v.y, v.z);
    }
  }
  if (!positions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function isValidLngLat(coord) {
  return Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1]);
}

function forEachPolygonSegment(polygon, callback) {
  for (const ring of polygon) {
    // 限制每个环的点数，防止栈溢出（保留 5000 点足够高精度）
    const limitedRing = ring.length > 5000 ? ring.slice(0, 5000) : ring;
    for (let i = 0; i < limitedRing.length - 1; i++) {
      const from = limitedRing[i];
      const to = limitedRing[i + 1];
      if (isValidLngLat(from) && isValidLngLat(to)) callback(from, to);
    }
  }
}

function segmentBounds(from, to, padding = 0) {
  return {
    minLng: Math.min(from[0], to[0]) - padding,
    maxLng: Math.max(from[0], to[0]) + padding,
    minLat: Math.min(from[1], to[1]) - padding,
    maxLat: Math.max(from[1], to[1]) + padding
  };
}

function visitSegmentCells(bounds, cellSize, callback) {
  const minX = Math.floor((bounds.minLng + 180) / cellSize);
  const maxX = Math.floor((bounds.maxLng + 180) / cellSize);
  const minY = Math.floor((bounds.minLat + 90) / cellSize);
  const maxY = Math.floor((bounds.maxLat + 90) / cellSize);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (callback(`${x}:${y}`) === false) return false;
    }
  }
  return true;
}

function pointToSegmentDistanceSq(point, from, to, lngScale) {
  const px = point[0] * lngScale;
  const py = point[1];
  const ax = from[0] * lngScale;
  const ay = from[1];
  const bx = to[0] * lngScale;
  const by = to[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return ex * ex + ey * ey;
}

function segmentDistanceSq(a, b, c, d) {
  const lngScale = Math.max(0.25, Math.cos(((a[1] + b[1] + c[1] + d[1]) / 4) * DEG2RAD));
  const midAB = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const midCD = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
  return Math.min(
    pointToSegmentDistanceSq(a, c, d, lngScale),
    pointToSegmentDistanceSq(b, c, d, lngScale),
    pointToSegmentDistanceSq(c, a, b, lngScale),
    pointToSegmentDistanceSq(d, a, b, lngScale),
    pointToSegmentDistanceSq(midAB, c, d, lngScale),
    pointToSegmentDistanceSq(midCD, a, b, lngScale)
  );
}

function createBoundarySegmentIndex(geojson = null, cellSize = BOUNDARY_INDEX_CELL_DEGREES) {
  const grid = new Map();
  let nextId = 0;

  const addSegment = (from, to) => {
    if (!isValidLngLat(from) || !isValidLngLat(to)) return;
    const segment = { id: nextId++, from, to, bounds: segmentBounds(from, to) };
    visitSegmentCells(segment.bounds, cellSize, (key) => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(segment);
    });
  };

  const hasNearbySegment = (from, to, thresholdDegrees) => {
    if (!thresholdDegrees || !grid.size) return false;
    if (Math.abs(from[0] - to[0]) > 30 || Math.abs(from[1] - to[1]) > 30) return false;
    const thresholdSq = thresholdDegrees * thresholdDegrees;
    const bounds = segmentBounds(from, to, thresholdDegrees);
    const seen = new Set();
    let found = false;
    visitSegmentCells(bounds, cellSize, (key) => {
      const bucket = grid.get(key);
      if (!bucket) return true;
      for (const segment of bucket) {
        if (seen.has(segment.id)) continue;
        seen.add(segment.id);
        if (
          segment.bounds.maxLng < bounds.minLng ||
          segment.bounds.minLng > bounds.maxLng ||
          segment.bounds.maxLat < bounds.minLat ||
          segment.bounds.minLat > bounds.maxLat
        ) {
          continue;
        }
        if (segmentDistanceSq(from, to, segment.from, segment.to) <= thresholdSq) {
          found = true;
          return false;
        }
      }
      return true;
    });
    return found;
  };

  if (geojson) {
    for (const feature of geojson.features || []) {
      for (const polygon of featurePolygons(feature)) {
        forEachPolygonSegment(polygon, addSegment);
      }
    }
  }

  return { addSegment, hasNearbySegment };
}

function polygonToLinePositions(polygon, radius, options = {}) {
  const positions = [];
  forEachPolygonSegment(polygon, (from, to) => {
    if (options.shouldSkipSegment?.(from, to)) return;
    const a = latLngToVec3(from[0], from[1], radius);
    const b = latLngToVec3(to[0], to[1], radius);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    options.onKeepSegment?.(from, to);
  });
  return positions;
}

function featurePolygons(feature) {
  const geometry = feature.geometry;
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function featureIso3(feature) {
  return feature?.properties?.ISO_A3 || feature?.properties?.iso_a3 || feature?.properties?.iso3 || feature?.properties?.ADM0_A3;
}

function featureIsoSet(geojson) {
  return new Set((geojson?.features || []).map(featureIso3).filter((iso) => iso && iso !== '-99'));
}

function haversineKm(lng1, lat1, lng2, lat2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

function makeTextSprite(text, options = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fontSize = options.fontSize || 26;
  // 更完整的中文字体回退链，确保中文能渲染
  const font = `${options.weight || 600} ${fontSize}px "Microsoft YaHei", "微软雅黑", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Source Han Sans SC", "Source Han Sans CN", "Heiti SC", "STHeiti", "SimHei", "黑体", Arial, sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const textW = Math.ceil(measure.measureText(text).width);
  const width = textW + 24;
  const height = fontSize + 14;
  const canvas = document.createElement('canvas');
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(3, 8, 20, 0.85)';
  ctx.fillStyle = options.color || 'rgba(240, 249, 255, 0.98)';
  // 确保文本正确渲染
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = options.scale || 0.5;
  sprite.scale.set(scale * (width / height), scale, 1);
  return sprite;
}

export class GlobeMap {
  static async mount(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`GlobeMap target not found: ${target}`);
    const instance = new GlobeMap(el, options);
    await instance.init();
    return instance;
  }

  constructor(container, options = {}) {
    this.container = container;
    this.options = { ...DEFAULTS, ...options };
    this.language = String(this.options.language || 'zh').toLowerCase();
    this.showRoads = this.options.showRoads !== false;
    this.radius = this.options.radius;
    this.pointMeshes = [];
    this.highlightShells = [];
    this.hoveredPoint = null;
    this.frame = null;
    this.needsRender = true;
    this.autoRotate = false;
    this.userAdjustedCamera = false;
    this.startedAt = performance.now();
    this.lastTick = this.startedAt;
    this.clock = new THREE.Timer();
    this.clock.connect?.(document);
    this.focusDirection = latLngToVec3(this.options.focusLng, this.options.focusLat, 1).normalize();
  }

  async init() {
    this.container.classList.add('kgz-map-root');
    this.container.innerHTML = '';
    this.createDom();
    this.createScene();
    this.buildGlobe();
    this.buildGraticule();
    this.buildStars();

    const [world, precisionCountries, countries, points] = await Promise.all([
      this.loadJson('world_countries.geojson').catch(() => null),
      this.loadJson(this.options.precisionCountriesFile).catch(() => null),
      this.loadJson('business_countries.geojson').catch(() => null),
      this.loadJson('business_points.json').catch(() => null)
    ]);

    if (!world && !countries && !points) {
      throw new Error('地球视图资源加载失败，请检查地图资源路径');
    }

    if (precisionCountries) {
      const precisionIsoSet = featureIsoSet(precisionCountries);
      const precisionBoundaryIndex = createBoundarySegmentIndex(precisionCountries);
      if (world) {
        this.buildWorldOutline(world, {
          excludeIso3: precisionIsoSet,
          excludeNearIndex: precisionBoundaryIndex,
          excludeNearThreshold: 0.18
        });
      }
      this.buildWorldOutline(precisionCountries, {
        dedupeSharedBoundaries: true,
        dedupeNearThreshold: 0.08
      });
    } else if (world) {
      this.buildWorldOutline(world);
    }
    if (countries || world) this.buildCountries(countries || world);
    if (points) this.buildPoints(points);

    this.bindEvents();
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;
    this.animate();
    this.hideLoading();
    window.__globe3d = this;
  }

  createDom() {
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'kgz-map-canvas';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'kgz-map-tooltip';
    this.loading = document.createElement('div');
    this.loading.className = 'kgz-map-loading';
    this.loading.textContent = this.isRu() ? 'Загрузка глобуса...' : '加载地球视图...';
    this.container.append(this.canvasWrap, this.tooltip, this.loading);
  }

  isRu() {
    return this.language.startsWith('ru');
  }

  getPointName(point) {
    return this.isRu() && point.nameRu ? point.nameRu : (point.name || point.nameRu || '');
  }

  getPlaceName(point) {
    const raw = point.country || point.region || '';
    if (!this.isRu()) return raw || point.nameRu || '';
    return COUNTRY_RU[raw] || REGION_RU[raw] || raw || point.nameRu || '';
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    this.camera.position.copy(this.focusDirection.clone().multiplyScalar(this.getFrameFitDistance(1)));
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.canvasWrap.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = false;
    this.controls.minDistance = this.getManualMinDistance();
    this.controls.maxDistance = this.radius * 6;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.userAdjustedCamera = true;
    });
    this.controls.addEventListener('end', () => { this.interacting = false; });

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.globeGroup = new THREE.Group();
    this.scene.add(this.globeGroup);
    this.worldGroup = new THREE.Group();
    this.countryGroup = new THREE.Group();
    this.highlightGroup = new THREE.Group();
    this.kgzGroup = new THREE.Group();
    this.pointGroup = new THREE.Group();
    this.arcGroup = new THREE.Group();
    this.globeGroup.add(this.worldGroup, this.countryGroup, this.highlightGroup, this.kgzGroup, this.pointGroup, this.arcGroup);

    this.scene.add(new THREE.HemisphereLight(0xb7d6ff, 0x1a2440, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(30, 40, 30);
    this.scene.add(key);
  }

  getFrameFitDistance(aspect = 1) {
    const verticalHalfFov = THREE.MathUtils.degToRad(this.camera?.fov || 42) / 2;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.3, aspect));
    const limitingHalfFov = Math.max(0.01, Math.min(verticalHalfFov, horizontalHalfFov));
    const visualRadius = this.radius * (this.options.frameRadiusScale || 1);
    const padding = this.options.framePadding || 1;
    return visualRadius * padding / Math.sin(limitingHalfFov);
  }

  getManualMinDistance() {
    return this.radius * (this.options.manualMinDistanceScale || 1.35);
  }

  async loadJson(file) {
    const fileBase = typeof window !== 'undefined' && window.location?.protocol === 'file:'
      ? new URL('assets/kgz-map/data/', window.location.href).href
      : null;
    const bases = [...new Set([this.options.basePath, fileBase, '/assets/kgz-map/data/', '/kgz-map/data/'].filter(Boolean))];
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

  async _loadRoads() {
    try {
      return await this.loadJson('roads.json');
    } catch {
      return null;
    }
  }

  buildGlobe() {
    const geometry = new THREE.SphereGeometry(this.radius, 128, 128);
    const material = new THREE.MeshPhongMaterial({
      color: 0x0f172a,
      emissive: 0x0b1b34,
      emissiveIntensity: 0.5,
      shininess: 12,
      transparent: false
    });
    this.sphere = new THREE.Mesh(geometry, material);
    this.sphere.renderOrder = -20;
    this.globeGroup.add(this.sphere);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 1.02, 80, 80),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.06, side: THREE.BackSide })
    );
    this.globeGroup.add(atmosphere);
  }

  buildGraticule() {
    const positions = [];
    const r = this.radius * 1.001;
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lng = -180; lng < 180; lng += 4) {
        const a = latLngToVec3(lng, lat, r);
        const b = latLngToVec3(lng + 4, lat, r);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    for (let lng = -180; lng < 180; lng += 30) {
      for (let lat = -80; lat < 80; lat += 4) {
        const a = latLngToVec3(lng, lat, r);
        const b = latLngToVec3(lng, lat + 4, r);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.12 });
    this.globeGroup.add(new THREE.LineSegments(geometry, material));
  }

  buildStars() {
    const count = 2000;
    const positions = [];
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(this.radius * (18 + Math.random() * 20));
      positions.push(v.x, v.y, v.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xdbeafe, size: 0.35, transparent: true, opacity: 0.7, sizeAttenuation: true });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  buildWorldOutline(geojson, options = {}) {
    const positions = [];
    const BOUNDARY_RADIUS = this.radius * (options.radiusScale ?? 1.008);  // 增加偏移避免 z-fighting
    const excludeIso3 = options.excludeIso3 || new Set();
    const excludeNearIndex = options.excludeNearIndex || null;
    const excludeNearThreshold = options.excludeNearThreshold || 0;
    const dedupeIndex = options.dedupeSharedBoundaries ? createBoundarySegmentIndex() : null;
    const dedupeNearThreshold = options.dedupeNearThreshold || 0;
    for (const feature of geojson.features || []) {
      const iso = featureIso3(feature);
      if (excludeIso3.has(iso)) continue;
      const keptSegments = [];
      const polygons = featurePolygons(feature);
      const shouldSkipSegment = (from, to) => {
        if (excludeNearIndex?.hasNearbySegment(from, to, excludeNearThreshold)) return true;
        if (dedupeIndex?.hasNearbySegment(from, to, dedupeNearThreshold)) return true;
        return false;
      };
      for (const polygon of polygons) {
        const ringPositions = polygonToLinePositions(polygon, BOUNDARY_RADIUS, {
          shouldSkipSegment,
          onKeepSegment: (from, to) => keptSegments.push([from, to])
        });
        positions.push(...ringPositions);
      }
      if (dedupeIndex) {
        for (const [from, to] of keptSegments) dedupeIndex.addSegment(from, to);
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // 主边界线：不透明，稍微亮一点的颜色
    const lineMaterial = new THREE.LineBasicMaterial({ color: options.color ?? 0x9ac8e0, transparent: true, opacity: options.opacity ?? 0.9, depthWrite: true, depthTest: true });
    const lines = new THREE.LineSegments(geometry, lineMaterial);
    lines.renderOrder = options.renderOrder ?? -10;
    this.worldGroup.add(lines);
    // 微光层
    const glowOpacity = options.glowOpacity ?? 0;
    if (glowOpacity <= 0) return;
    const glowGeom = new THREE.BufferGeometry();
    glowGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const glowMaterial = new THREE.LineBasicMaterial({ color: options.glowColor ?? 0x6ab0d8, transparent: true, opacity: glowOpacity, depthWrite: true, depthTest: true });
    const glowLines = new THREE.LineSegments(glowGeom, glowMaterial);
    glowLines.renderOrder = options.renderOrder ?? -10;
    this.worldGroup.add(glowLines);
  }

  buildCountries(geojson) {
    // 只标注业务相关的 10 个国家
    const businessISO3 = new Set(['AFG', 'BLR', 'CHN', 'GEO', 'KAZ', 'KGZ', 'RUS', 'TJK', 'TUR', 'UZB']);
    for (const feature of geojson.features || []) {
      const iso = featureIso3(feature);
      if (!businessISO3.has(iso)) continue;
      const name = this.isRu()
        ? (feature.properties?.name_ru || feature.properties?.name_en || iso)
        : (feature.properties?.name_zh || feature.properties?.name_en || iso);
      // 计算几何中心作为标签位置
      let center = [74, 41.5];
      if (feature.geometry) {
        const coords = this.getGeometryCentroid(feature.geometry);
        if (coords) center = coords;
      }
      const pos = latLngToVec3(center[0], center[1], this.radius * 1.01);
      // 根据面积缩放字号
      let area = 0;
      if (feature.geometry) area = this.getGeometryArea(feature.geometry);
      const areaScale = Math.min(Math.max(Math.log10(area + 1) / 6, 0), 1);
      const minFontSize = 10, maxFontSize = 16;
      const fontSize = Math.round(minFontSize + (maxFontSize - minFontSize) * areaScale);
      const label = makeTextSprite(name, { color: 'rgba(240, 249, 255, 0.8)', fontSize, scale: 0.25 });
      label.position.copy(pos);
      label.renderOrder = 105;
      this.countryGroup.add(label);
    }
  }

  // 简单的球面面积估算（单位：平方公里）
  getGeometryArea(geometry) {
    if (!geometry || !geometry.coordinates) return 0;
    let totalArea = 0;
    const R = 6371; // 地球半径 km
    const processRing = (ring) => {
      if (ring.length < 3) return;
      // 使用球面多边形面积公式 (Girard's theorem 简化版)
      // 近似：将经纬度投影到平面计算面积
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [lng1, lat1] = ring[i];
        const [lng2, lat2] = ring[i + 1];
        area += (lng2 - lng1) * Math.sin(lat1 * Math.PI / 180);
      }
      area = Math.abs(area) * R * R * Math.PI / 180;
      totalArea += area;
    };
    if (geometry.type === 'Polygon') {
      processRing(geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        processRing(poly[0]);
      }
    }
    return totalArea;
  }

  getGeometryCentroid(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let sumX = 0, sumY = 0, count = 0;
    const processRing = (ring) => {
      for (const [lng, lat] of ring) {
        sumX += lng;
        sumY += lat;
        count++;
      }
    };
    if (geometry.type === 'Polygon') {
      processRing(geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        processRing(poly[0]);
      }
    }
    if (count === 0) return null;
    return [sumX / count, sumY / count];
  }

  buildKgzRegions(geojson) {
    for (const feature of geojson.features || []) {
      const props = feature.properties || {};
      const color = new THREE.Color(props.color_hex || '#38bdf8');
      const polygons = featurePolygons(feature);
      for (const polygon of polygons) {
        const linePositions = polygonToLinePositions(polygon, this.radius * 1.008);
        if (linePositions.length) {
          const lineGeom = new THREE.BufferGeometry();
          lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
          this.kgzGroup.add(new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.85, depthWrite: false })));
          const glowGeom = new THREE.BufferGeometry();
          glowGeom.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
          this.kgzGroup.add(new THREE.LineSegments(glowGeom, new THREE.LineBasicMaterial({ color: 0x9fe7ff, transparent: true, opacity: 0.35, depthWrite: false })));
        }
      }
    }
  }

  buildKgzLakes(geojson) {
    for (const feature of geojson.features || []) {
      const polygons = featurePolygons(feature);
      for (const polygon of polygons) {
        const fill = polygonToFillGeometry(polygon, this.radius * 1.007);
        if (fill) {
          const mat = new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
          this.kgzGroup.add(new THREE.Mesh(fill, mat));
        }
      }
    }
  }

  buildKgzRoads(geojson) {
    const MAJOR = {
      motorway: { color: 0xf8fafc, opacity: 0.95 },
      motorway_link: { color: 0xf8fafc, opacity: 0.8 },
      trunk: { color: 0xf8fafc, opacity: 0.85 },
      trunk_link: { color: 0xf8fafc, opacity: 0.7 },
      primary: { color: 0xbfe3ff, opacity: 0.7 },
      primary_link: { color: 0xbfe3ff, opacity: 0.55 }
    };
    const r = this.radius * 1.004;
    for (const [type, style] of Object.entries(MAJOR)) {
      const features = (geojson.features || []).filter((f) => (f.properties?.highway || '') === type);
      if (!features.length) continue;
      const positions = [];
      for (const feature of features) {
        const coords = feature.geometry?.coordinates || [];
        for (let i = 0; i < coords.length - 1; i++) {
          const a = latLngToVec3(coords[i][0], coords[i][1], r);
          const b = latLngToVec3(coords[i + 1][0], coords[i + 1][1], r);
          positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity, depthWrite: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.renderOrder = 110;
      this.kgzGroup.add(lines);
    }
  }

  buildPoints(data) {
    const localKeep = [...(data.depots || [])].filter((p) => p.type === 'headquarters');
    const all = [
      ...(data.oil_sources || []),
      ...(data.export_customers || []),
      ...localKeep
    ];
    const hq = all.find((p) => p.type === 'headquarters');
    const centerDir = (hq ? latLngToVec3(hq.lng, hq.lat, 1) : latLngToVec3(74, 41.5, 1)).normalize();
    let labelIndex = 0;

    for (const point of all) {
      if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
      const color = new THREE.Color(POINT_PALETTE[point.type] || POINT_PALETTE.default);
      const size = point.size || POINT_SIZE[point.type] || POINT_SIZE.default;
      const geometry = new THREE.SphereGeometry(size, 16, 12);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: point.opacity ?? 0.95, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(latLngToVec3(point.lng, point.lat, this.radius * 1.012));
      mesh.renderOrder = 130;
      mesh.userData = { type: 'business-point', point, baseColor: color.clone() };
      this.pointGroup.add(mesh);
      this.pointMeshes.push(mesh);

      if (point.type === 'export_customer' || point.type === 'oil_source') {
        const isExport = point.type === 'export_customer';
        const labelColor = isExport ? 'rgba(216, 196, 255, 0.98)' : 'rgba(255, 214, 170, 0.98)';
        const lineColor = isExport ? 0xa78bfa : 0xfb923c;
        const km = hq ? haversineKm(hq.lng, hq.lat, point.lng, point.lat) : null;
        const pointName = this.getPointName(point);
        const text = km != null ? `${pointName}  ${km}km` : pointName;
        const dir = mesh.position.clone().normalize();
        const away = dir.clone().sub(centerDir.clone().multiplyScalar(dir.dot(centerDir)));
        if (away.lengthSq() < 1e-6) away.copy(dir);
        away.normalize();
        const perp = new THREE.Vector3().crossVectors(dir, away).normalize();
        const idx = labelIndex++;
        const along = this.radius * 0.14;
        const side = ((idx % 3) - 1) * this.radius * 0.08;
        const labelPos = mesh.position.clone().add(away.multiplyScalar(along)).add(perp.multiplyScalar(side)).setLength(this.radius * 1.055);
        const label = makeTextSprite(text, { color: labelColor, fontSize: 22, scale: 0.3 });
        label.position.copy(labelPos);
        label.renderOrder = 131;
        this.pointGroup.add(label);

        const leaderGeom = new THREE.BufferGeometry().setFromPoints([mesh.position.clone(), labelPos]);
        const leaderMat = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false });
        const leader = new THREE.Line(leaderGeom, leaderMat);
        leader.renderOrder = 129;
        this.pointGroup.add(leader);
      }
    }

    if (hq) {
      const targets = all.filter((p) => p.type === 'export_customer' || p.type === 'oil_source');
      this.buildArcs(hq, targets);
    }
  }

  buildArcs(hq, targets) {
    const hqPos = latLngToVec3(hq.lng, hq.lat, this.radius * 1.012);
    for (const target of targets) {
      if (!Number.isFinite(target.lng) || !Number.isFinite(target.lat)) continue;
      const isExport = target.type === 'export_customer';
      const color = isExport ? 0xa78bfa : 0xfb923c;
      const tPos = latLngToVec3(target.lng, target.lat, this.radius * 1.012);
      const geometry = new THREE.BufferGeometry().setFromPoints([hqPos, tPos]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 124;
      this.arcGroup.add(line);
    }
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
    const hit = this.raycaster.intersectObjects(this.pointMeshes, false)[0];
    if (hit) {
      if (this.hoveredPoint !== hit.object) {
        this.clearHover();
        this.hoveredPoint = hit.object;
        this.hoveredPoint.material.color.set(0xffffff);
        this.hoveredPoint.material.opacity = 1;
      }
      const p = hit.object.userData.point;
      const isHQ = p.type === 'headquarters';
      const sub = isHQ
        ? (this.isRu() ? 'Кыргызстан, CTY-01' : '吉尔吉斯斯坦REG-01')
        : this.getPlaceName(p);
      this.tooltip.innerHTML = `<strong>${this.getPointName(p)}</strong><span>${sub}</span>`;
      this.tooltip.style.transform = `translate(${event.offsetX + 16}px, ${event.offsetY + 16}px)`;
      this.tooltip.classList.add('visible');
      this.requestRender();
      return;
    }
    this.clearHover();
  }

  clearHover() {
    if (this.hoveredPoint) {
      const orig = this.hoveredPoint.userData.baseColor;
      if (orig) this.hoveredPoint.material.color.copy(orig);
      this.hoveredPoint.material.opacity = 0.95;
      this.hoveredPoint = null;
    }
    this.tooltip.classList.remove('visible');
    this.requestRender();
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const fitDistance = this.getFrameFitDistance(this.camera.aspect);
    this.controls.minDistance = this.getManualMinDistance();
    const currentOffset = this.camera.position.clone().sub(this.controls.target);
    const currentDistance = currentOffset.length();
    if (!this.userAdjustedCamera && currentDistance < fitDistance) {
      const direction = currentDistance > 0.001 ? currentOffset.normalize() : this.focusDirection.clone();
      this.camera.position.copy(this.controls.target.clone().add(direction.multiplyScalar(fitDistance)));
      this.controls.update();
    }
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  animate() {
    this.frame = requestAnimationFrame(() => this.animate());
    const now = performance.now();
    let delta = Math.max(0.001, (now - this.lastTick) / 1000);
    let elapsed = (now - this.startedAt) / 1000;
    this.lastTick = now;
    try {
      this.clock.update?.();
      delta = this.clock.getDelta?.() ?? delta;
      elapsed = this.clock.getElapsed?.() ?? elapsed;
    } catch {
      // Keep rendering with the browser clock if Three's timer is unavailable.
    }
    const spinning = this.autoRotate && !this.interacting && !this.hoveredPoint;
    if (spinning) {
      this.globeGroup.rotation.y += this.options.autoRotateSpeed * delta;
      this.needsRender = true;
    }
    const pulse = Math.sin(elapsed * 0.9) * 0.03 + 0.09;
    for (const shell of this.highlightShells) {
      shell.material.opacity = pulse;
    }
    if (this.highlightShells.length) this.needsRender = true;
    const controlsChanged = this.controls.update();
    if (this.needsRender || controlsChanged) {
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
    this.clock.disconnect?.();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of materials) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    if (window.__globe3d === this) delete window.__globe3d;
    this.container.innerHTML = '';
  }
}

window.GlobeMap = GlobeMap;
