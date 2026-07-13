import { describe, expect, it } from 'vitest';
import { fallbackRetailYears, normalizeRetailYears } from './retailPeriod';

describe('retail period helpers', () => {
  it('keeps available years at or after 2023 in descending order', () => {
    expect(normalizeRetailYears([2022, '2024', 2026, 2024, 'x'], 2026)).toEqual([2026, 2024]);
  });

  it('falls back to every year from the current year back to 2023', () => {
    expect(fallbackRetailYears(2027)).toEqual([2027, 2026, 2025, 2024, 2023]);
    expect(normalizeRetailYears([], 2022)).toEqual([2023]);
  });
});
