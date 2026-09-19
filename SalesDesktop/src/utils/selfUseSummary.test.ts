import { describe, expect, it } from 'vitest';
import { summarizeSelfUseRecords } from './selfUseSummary';

describe('summarizeSelfUseRecords', () => {
  it('sums only the rows currently shown', () => {
    const rows = [
      { volume: 10.5, mass: 7500, amount: 500 },
      { volume: 20, mass: 14000, amount: 1000 },
      { volume: 30, mass: 21000, amount: 1500 },
    ];
    const filtered = rows.filter((row) => row.volume > 15);
    expect(summarizeSelfUseRecords(filtered)).toEqual({
      totalRecords: 2,
      totalVolume: 50,
      totalWeightKg: 35000,
      totalTons: 35,
      totalAmount: 2500,
    });
  });

  it('falls back to weightKg when mass is absent', () => {
    const summary = summarizeSelfUseRecords([{ volume: 1, weightKg: 720, amount: 50 }]);
    expect(summary.totalWeightKg).toBe(720);
    expect(summary.totalTons).toBe(0.72);
  });

  it('returns zeros for an empty result set', () => {
    expect(summarizeSelfUseRecords([])).toEqual({
      totalRecords: 0,
      totalVolume: 0,
      totalWeightKg: 0,
      totalTons: 0,
      totalAmount: 0,
    });
  });

  it('ignores blank values instead of producing NaN', () => {
    const summary = summarizeSelfUseRecords([{ volume: null, mass: undefined, amount: 'x' }, null]);
    expect(summary.totalVolume).toBe(0);
    expect(summary.totalAmount).toBe(0);
    expect(summary.totalRecords).toBe(2);
  });
});
