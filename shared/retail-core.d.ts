export const RETAIL_DATA_START_YEAR: 2023;

export function numericMetric(value: unknown): number;
export const metricNumber: typeof numericMetric;
export function fallbackRetailYears(currentYear?: number): number[];
export function normalizeRetailYears(values?: Array<number | string> | null, currentYear?: number): number[];
export function normalizeRetailMonthOptions<T extends string | { month?: string }>(items?: T[] | null): Array<T extends string ? { month: string } : T & { month: string }>;
export function latestRetailMonthForYear(items: unknown[] | null | undefined, year: number | string): string | null;
export function preferredRetailMonth(items: unknown[] | null | undefined, preferred?: string | null, fallback?: string): string;
export function defaultRetailMonth(today?: Date): string;
export function retailTonsOf(item: unknown): number;
export function retailCnyAmountOf(item: unknown): number | null;
export function formatRetailLitersKpi(value: unknown, language?: string): string;
export function formatRetailLitersKpiParts(value: unknown, language?: string): { value: string; unit: string };
export function formatRetailSomKpi(value: unknown, language?: string): string;
export function formatRetailSomKpiParts(value: unknown, language?: string): { value: string; unit: string };
export function formatRetailCnyKpi(value: unknown, language?: string): string;
export function formatRetailTonsKpi(value: unknown, language?: string): string;
export function formatRetailTons(value: unknown, digits?: number, language?: string): string;
export function splitRetailStationName(name?: unknown, short?: unknown): { primary: string; secondary: string; title: string };
export function sortRankingRows<T>(rows: T[] | null | undefined, valueOf: (row: T) => unknown, limit?: number): T[];
export function summarizeSelfUseRecords(records: unknown[] | null | undefined): {
  totalRecords: number;
  totalVolume: number;
  totalWeightKg: number;
  totalTons: number;
  totalAmount: number;
};
