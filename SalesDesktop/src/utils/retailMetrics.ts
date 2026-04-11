export function numericMetric(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function retailTonsOf(item: unknown) {
  if (!item || typeof item !== 'object') return 0;
  const row = item as Record<string, unknown>;
  const tons = numericMetric(row.totalTons ?? row.tons ?? row.latestMonthTons ?? row.totalEndInventoryTons ?? row.endInventoryTons);
  if (tons > 0) return tons;
  const mass = numericMetric(row.totalWeightKg ?? row.mass ?? row.latestMonthMass);
  return mass > 0 ? mass / 1000 : 0;
}

export function formatRetailTons(value: unknown, digits = 3) {
  return numericMetric(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
