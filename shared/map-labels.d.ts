export const STATUS_LABELS: {
  zh: Record<string, string>;
  ru: Record<string, string>;
};

export function statusKey(
  status?: string | null,
  statusLabel?: string | null,
  closedReason?: string | null,
): string;

export function statusLabelFor(
  key: string | null | undefined,
  lang?: string,
  fallback?: string,
): string;

export function localizeMapPoint(point: any, lang?: string): any;
