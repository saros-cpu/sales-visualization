import { describe, expect, it } from 'vitest';
import { formatRetailTons, retailTonsOf } from './retailMetrics';

describe('retail metric helpers', () => {
  it('prefers explicit retail tons over mass fallback', () => {
    expect(retailTonsOf({ totalTons: 12.345, mass: 999999 })).toBe(12.345);
    expect(retailTonsOf({ tons: 6.789, mass: 999999 })).toBe(6.789);
    expect(retailTonsOf({ latestMonthTons: 3.21, latestMonthMass: 999999 })).toBe(3.21);
  });

  it('falls back to true mass fields only when tons are absent', () => {
    expect(retailTonsOf({ totalWeightKg: 1234 })).toBe(1.234);
    expect(retailTonsOf({ mass: 2345 })).toBe(2.345);
    expect(retailTonsOf({ latestMonthMass: 3456 })).toBe(3.456);
  });

  it('formats retail tons with three decimals by default', () => {
    expect(formatRetailTons(1.2)).toMatch(/^1[.,]200$/);
  });
});
