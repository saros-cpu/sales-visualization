const EARTH_RADIUS_M = 6378137;
const MAX_MERCATOR_LAT = 85.05112878;

export const KGZ_MAP_PROJECTION = Object.freeze({
  centerLng: 74,
  centerLat: 41.5,
  scale: 8,
  type: 'local-web-mercator'
});

function clampLatitude(lat) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

function mercatorMeters(lng, lat) {
  const safeLat = clampLatitude(lat);
  const lngRad = (lng * Math.PI) / 180;
  const latRad = (safeLat * Math.PI) / 180;
  return {
    x: EARTH_RADIUS_M * lngRad,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + latRad / 2))
  };
}

export function geoToWorld(lng, lat, options = KGZ_MAP_PROJECTION) {
  const center = mercatorMeters(options.centerLng, options.centerLat);
  const point = mercatorMeters(lng, lat);
  const metersPerLatDegreeAtCenter =
    (EARTH_RADIUS_M * Math.PI) / 180 / Math.cos((options.centerLat * Math.PI) / 180);
  const unitsPerMeter = options.scale / metersPerLatDegreeAtCenter;

  return {
    x: (point.x - center.x) * unitsPerMeter,
    z: -(point.y - center.y) * unitsPerMeter
  };
}

export function projectLngLatTuple(coord, options = KGZ_MAP_PROJECTION) {
  return geoToWorld(coord[0], coord[1], options);
}
