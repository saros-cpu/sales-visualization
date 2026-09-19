import { describe, expect, it } from 'vitest';
import {
  alertStations,
  formatLiters,
  formatRate,
  formatSom,
  formatCny,
  formatTons,
  mapLayers,
  normalizeStatusLabel,
  normalizeWallpaperPayload,
  stationStatusText,
  topInventoryStations,
} from './wallpaperData';

describe('wallpaperData', () => {
  it('normalizes wrapped API payloads', () => {
    const payload = normalizeWallpaperPayload({ code: 0, data: { stations: [{ shopKey: 1 }], depots: null } });
    expect(payload.stations).toHaveLength(1);
    expect(payload.depots).toEqual([]);
  });

  it('sorts top inventory stations descending', () => {
    const rows = topInventoryStations({
      stations: [
        { shopKey: 1, name: 'A', short: 'A', region: '', inventory: 10 },
        { shopKey: 2, name: 'B', short: 'B', region: '', inventory: 35 },
      ],
    });
    expect(rows.map((item) => item.shopKey)).toEqual([2, 1]);
  });

  it('extracts non-normal stations and map layer sizes', () => {
    const payload = {
      stations: [{ shopKey: 1, name: 'A', short: 'A', region: '', status: 'closed' }],
      depots: [
        { name: 'STN-63', region: 'REG-07', lng: 0, lat: 0, status: 'normal' },
        { name: 'STN-65', region: 'REG-08', lng: 0, lat: 0, status: 'normal' },
      ],
    };
    expect(alertStations(payload)).toHaveLength(1);
    expect(mapLayers(payload).stations[0].size).toBeGreaterThan(0.28);
    expect(mapLayers(payload).depots).toHaveLength(3);
    expect(mapLayers(payload).depots.map((item) => item.name)).toContain('STN-61');
    expect(mapLayers(payload).depots.every((item) => item.pinLine)).toBe(true);
    expect(mapLayers(payload).depots[0].y).toBeGreaterThan(2.5);
    expect(mapLayers(payload).depots[0].showLabel).toBe(false);
    expect(stationStatusText('closed')).toBe('停业');
    expect(stationStatusText('normal', 'normal')).toBe('在营');
    expect(normalizeStatusLabel('closed', '装修中', '装修停业')).toBe('装修');
    expect(mapLayers({
      stations: [{ shopKey: 3, name: 'C', short: 'C', region: '', status: 'normal', statusLabel: 'normal' }],
      depots: [],
    }).stations[0].statusLabel).toBe('在营');
  });

  it('keeps depots unique after a rename when API and core fallback disagree on names', () => {
    const payload = {
      stations: [],
      depots: [
        { name: 'STN-61', code: 'D-0X', short: 'S-62', region: 'REG-01', lng: 0, lat: 0, type: 'headquarters', status: 'normal' },
        { name: 'STN-63', code: 'D-0X', short: 'S-64', region: 'REG-07', lng: 0, lat: 0, status: 'normal' },
        { name: 'STN-65', code: 'D-0X', short: 'S-66', region: 'REG-08', lng: 0, lat: 0, status: 'closed' },
      ],
    };
    const names = mapLayers(payload).depots.map((item) => item.name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain('DemoDepotSouth');
    expect(names).not.toContain('DemoDepotNorth');
  });

  it('keeps depots unique when the API omits codes but carries matching coordinates', () => {
    const payload = {
      stations: [],
      depots: [
        { name: '（服务端新名）', region: 'REG-07', lng: 0, lat: 0, status: 'normal' },
      ],
    };
    const names = mapLayers(payload).depots.map((item) => item.name);
    expect(names).toContain('（服务端新名）');
    expect(new Set(names).size).toBe(names.length);
  });

  it('filters wallpaper map markers by display settings', () => {
    const payload = {
      sensitiveData: true,
      stations: [
        { shopKey: 1, name: 'A', short: 'A', region: '', status: 'normal' },
        { shopKey: 2, name: 'B', short: 'B', region: '', status: 'closed' },
        { shopKey: 3, name: 'C', short: 'C', region: '', status: 'normal', inventoryAlerts: [{}] },
      ],
      depots: [{ name: 'STN-61', region: 'REG-01', status: 'normal' }],
    };
    expect(mapLayers(payload, { showClosedStations: false }).stations.map((item) => item.shopKey)).toEqual([1, 3]);
    expect(mapLayers(payload, { showInventoryAlertOnly: true }).stations.map((item) => item.shopKey)).toEqual([3]);
    expect(mapLayers(payload, { showDepotMarkers: false }).depots).toHaveLength(0);
  });

  it('formats large liter values compactly', () => {
    expect(formatLiters(123456)).toBe('12.3 万L');
  });

  it('formats som values compactly', () => {
    expect(formatSom(12345678)).toBe('1,234.6 万索姆');
  });

  it('formats tons values', () => {
    expect(formatTons(123.456)).toBe('123.5 吨');
  });

  it('formats cny values compactly', () => {
    expect(formatCny(12345678)).toBe('1,234.6 万元');
    expect(formatCny(null)).toBe('--');
  });

  it('formats exchange rates with four decimals', () => {
    expect(formatRate(89.12345)).toBe('89.1235');
    expect(formatRate(null)).toBe('--');
  });
});
