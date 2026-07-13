export const RETAIL_DATA_START_YEAR = 2023;

export function fallbackRetailYears(currentYear = new Date().getFullYear()) {
  const latestYear = Math.max(currentYear, RETAIL_DATA_START_YEAR);
  return Array.from(
    { length: latestYear - RETAIL_DATA_START_YEAR + 1 },
    (_, index) => latestYear - index,
  );
}

export function normalizeRetailYears(values?: Array<number | string> | null, currentYear = new Date().getFullYear()) {
  const years = Array.from(new Set(
    (values || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= RETAIL_DATA_START_YEAR),
  )).sort((a, b) => b - a);
  return years.length ? years : fallbackRetailYears(currentYear);
}

export function defaultRetailMonth() {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
}
