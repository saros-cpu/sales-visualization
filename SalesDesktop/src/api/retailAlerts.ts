import client from './client';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface RetailAlertInsight {
  insightDate: string;
  periodKey: string;
  language?: string;
  trendAnomalies: Array<Record<string, any>>;
  suggestions: string[];
  sourceSummary: Record<string, any>;
  aiStatus: string;
  generatedAt: string;
}

export async function getRetailAlertInsights(ym: string, refresh = false, language = 'zh') {
  const res = await client.get(v2(ApiPaths.retail.alertInsights()), { params: { ym, refresh: refresh ? 1 : undefined, lang: language } });
  return res.data as RetailAlertInsight;
}
