import client from './client';

export interface AssistantResponse {
  ok: boolean;
  question: string;
  periodLabel?: string;
  answer: string;
  sourceAnswer?: string;
  tables?: Array<{ title: string; columns: string[]; rows: any[][] }>;
  agent?: {
    mode: string;
    provider: string;
    model?: string;
    llmUsed: boolean;
    status: string;
    error?: string;
    durationMs?: number;
    canModifyCode: boolean;
    canModifyFiles: boolean;
    canModifyBusinessData: boolean;
  };
}

export async function askAssistant(question: string, language: string) {
  const res = await client.post('/assistant/query', { question, language, useLlm: true });
  return res.data as AssistantResponse;
}

export async function getAssistantStatus() {
  const res = await client.get('/assistant/status');
  return res.data;
}
