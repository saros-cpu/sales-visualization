export const API_PREFIX: Readonly<{ core: '/api'; v2: '/api/v2' }>;

export function buildQuery(params?: Record<string, unknown>): string;
export function withQuery(path: string, params?: Record<string, unknown>): string;
export function yearMonth(year: number | string, month: number | string): string;
export function retailDailyFilename(period: string, generatedAt?: Date): string;

export const ApiPaths: any;
export const ReportCatalog: any;
