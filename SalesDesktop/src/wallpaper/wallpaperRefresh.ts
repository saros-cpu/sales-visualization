export interface RefreshTime {
  hour: number;
  minute: number;
}

export const DAILY_REFRESH_STATE_KEY = 'sales-wallpaper-last-daily-refresh-v1';

export function parseRefreshAtLocalTime(value: unknown): RefreshTime | null {
  const text = String(value || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isDailyRefreshDue(now: Date, refreshAt: RefreshTime | null) {
  if (!refreshAt) return false;
  const due = new Date(now);
  due.setHours(refreshAt.hour, refreshAt.minute, 0, 0);
  return now.getTime() >= due.getTime();
}

export function shouldRunDailyRefreshCatchUp(now: Date, refreshAt: RefreshTime | null, lastSuccessDate: string | null) {
  return isDailyRefreshDue(now, refreshAt) && lastSuccessDate !== localDateKey(now);
}

export function nextRefreshDelayMs(
  now: Date,
  refreshAt: RefreshTime | null,
  fallbackIntervalMs: number,
  minDelayMs: number,
) {
  if (!refreshAt) return fallbackIntervalMs;
  const next = new Date(now);
  next.setHours(refreshAt.hour, refreshAt.minute, 0, 0);
  if (next.getTime() <= now.getTime() + 5000) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(minDelayMs, next.getTime() - now.getTime());
}
