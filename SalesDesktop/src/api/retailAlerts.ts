import client from './client';

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
  const res = await client.get('/retail/alert-insights', { params: { ym, refresh: refresh ? 1 : undefined, lang: language } });
  return res.data as RetailAlertInsight;
}
