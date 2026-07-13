import { describe, expect, it } from 'vitest';
import {
  isDailyRefreshDue,
  localDateKey,
  nextRefreshDelayMs,
  parseRefreshAtLocalTime,
  shouldRunDailyRefreshCatchUp,
} from './wallpaperRefresh';

describe('wallpaperRefresh', () => {
  it('parses configured local refresh time', () => {
    expect(parseRefreshAtLocalTime('09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseRefreshAtLocalTime('9:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseRefreshAtLocalTime('24:00')).toBeNull();
    expect(parseRefreshAtLocalTime('bad')).toBeNull();
  });

  it('detects daily catch-up after the configured time', () => {
    const refreshAt = parseRefreshAtLocalTime('09:00');
    const before = new Date(2026, 7, 8, 8, 59, 0);
    const after = new Date(2026, 7, 8, 9, 1, 0);

    expect(isDailyRefreshDue(before, refreshAt)).toBe(false);
    expect(isDailyRefreshDue(after, refreshAt)).toBe(true);
    expect(shouldRunDailyRefreshCatchUp(after, refreshAt, null)).toBe(true);
    expect(shouldRunDailyRefreshCatchUp(after, refreshAt, localDateKey(after))).toBe(false);
  });

  it('schedules the next daily refresh without very short loops', () => {
    const refreshAt = parseRefreshAtLocalTime('09:00');
    const now = new Date(2026, 7, 8, 8, 55, 0);
    const nearDue = new Date(2026, 7, 8, 8, 59, 58);
    const minDelayMs = 5 * 60_000;

    expect(nextRefreshDelayMs(now, refreshAt, 123, minDelayMs)).toBe(5 * 60_000);
    expect(nextRefreshDelayMs(nearDue, refreshAt, 123, minDelayMs)).toBeGreaterThan(23 * 60 * 60_000);
    expect(nextRefreshDelayMs(now, null, 123, minDelayMs)).toBe(123);
  });
});
