export function finiteMetric(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function sortRankingRows<T>(
  rows: readonly T[] | null | undefined,
  valueOf: (row: T) => unknown,
  limit?: number,
): T[] {
  const sorted = [...(rows ?? [])].sort((left, right) => finiteMetric(valueOf(right)) - finiteMetric(valueOf(left)));
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export function rankingValues<T>(rows: readonly T[], valueOf: (row: T) => unknown): number[] {
  return rows.map((row) => finiteMetric(valueOf(row)));
}
