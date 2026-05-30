import { describe, expect, it } from 'vitest';
import { finiteMetric, rankingValues, sortRankingRows } from './rankingCharts';

describe('ranking chart helpers', () => {
  it('sorts ranking rows from highest to lowest and applies limits', () => {
    const rows = [
      { name: 'low', value: 3 },
      { name: 'high', value: 10 },
      { name: 'mid', value: 6 },
    ];

    expect(sortRankingRows(rows, (row) => row.value, 2).map((row) => row.name)).toEqual(['high', 'mid']);
    expect(rows.map((row) => row.name)).toEqual(['low', 'high', 'mid']);
  });

  it('normalizes non-finite ranking values to zero', () => {
    expect(finiteMetric('')).toBe(0);
    expect(finiteMetric('9.5')).toBe(9.5);
    expect(rankingValues([{ value: Number.NaN }, { value: 2 }], (row) => row.value)).toEqual([0, 2]);
  });
});
