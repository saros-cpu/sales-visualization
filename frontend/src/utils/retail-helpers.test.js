import { describe, expect, it } from 'vitest';
import { metricNumber, sortRankingRows } from './retail-helpers';

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
});
