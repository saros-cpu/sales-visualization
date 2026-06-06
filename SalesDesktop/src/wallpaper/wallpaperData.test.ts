import { describe, expect, it } from 'vitest';
import {
  alertStations,
  formatLiters,
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
      depots: [{ name: 'D', status: 'normal' }],
    };
    expect(alertStations(payload)).toHaveLength(1);
    expect(mapLayers(payload).stations[0].size).toBeGreaterThan(0.28);
    expect(stationStatusText('closed')).toBe('停业');
  });

  it('formats large liter values compactly', () => {
    expect(formatLiters(123456)).toBe('12.3 万L');
  });
});
