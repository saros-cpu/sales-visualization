import { describe, expect, it } from 'vitest';
import {
  alertStations,
  formatLiters,
  formatSom,
  mapLayers,
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
        { name: 'DemoDepotNorth', region: 'REG-08', lng: 0, lat: 0, status: 'normal' },
        { name: 'DemoDepotSouth', region: 'REG-07', lng: 0, lat: 0, status: 'normal' },
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
  });

  it('formats large liter values compactly', () => {
    expect(formatLiters(123456)).toBe('12.3 万L');
  });

  it('formats som values compactly', () => {
    expect(formatSom(12345678)).toBe('1,234.6 万索姆');
  });
});
