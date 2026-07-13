import { describe, expect, it } from 'vitest';
import { metricNumber, normalizeRetailYears, sortRankingRows, splitStationName } from './retail-helpers';

describe('retail ranking helpers', () => {
  it('keeps ranking rows descending without mutating the source', () => {
    const source = [
      { name: 'third', value: 1 },
      { name: 'first', value: 9 },
      { name: 'second', value: 5 },
    ];

    expect(sortRankingRows(source, row => row.value).map(row => row.name)).toEqual(['first', 'second', 'third']);
    expect(source.map(row => row.name)).toEqual(['third', 'first', 'second']);
  });

  it('treats invalid ranking values as zero', () => {
    expect(metricNumber('12.5')).toBe(12.5);
    expect(metricNumber(Number.NaN)).toBe(0);
  });

  it('normalizes retail years from available data and filters years before 2023', () => {
    expect(normalizeRetailYears([2022, '2023', 2026, 2023, 'bad'], 2026)).toEqual([2026, 2023]);
  });

  it('falls back to 2023 through current year when no retail years are available', () => {
    expect(normalizeRetailYears([], 2027)).toEqual([2027, 2026, 2025, 2024, 2023]);
  });

  it('splits bilingual station names into Chinese and Russian display lines', () => {
    expect(splitStationName('\u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1 / \u5361\u5317')).toEqual({
      primary: '\u5361\u5317',
      secondary: '\u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1',
      title: '\u5361\u5317 / \u041a\u0430\u0440\u0430-\u0431\u0430\u043b\u0442\u0430 1',
    });
  });
});
