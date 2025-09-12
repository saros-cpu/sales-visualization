import axios from 'axios';
import client from './client';
import { API_HOST } from './http';

export interface AssistantTable {
  title?: string;
  columns?: string[];
  rows?: any[][];
}

export interface AssistantResponse {
  ok: boolean;
  question: string;
  periodLabel?: string;
  answer: string;
  sourceAnswer?: string;
  tables?: AssistantTable[];
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
  try {
    const res = await client.post('/assistant/query', { question, language, useLlm: true });
    return res.data as AssistantResponse;
  } catch (err: any) {
    const status = err?.response?.status;
    const message = String(err?.message || '');
    if (status !== 404 && !message.includes('404')) throw err;
    const token = localStorage.getItem('accessToken');
    const legacy = await axios.post(
      `${API_HOST}/api/data-assistant/query`,
      { question, language },
      {
        timeout: 30000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    const payload = legacy.data as AssistantResponse;
    return {
      ...payload,
      sourceAnswer: payload.answer,
      agent: {
        mode: 'read_only',
        provider: 'web-data-assistant',
        model: 'legacy-rule-engine',
        llmUsed: false,
        status: 'legacy_fallback',
        canModifyCode: false,
        canModifyFiles: false,
        canModifyBusinessData: false,
      },
    };
  }
}

export async function getAssistantStatus() {
  try {
    const res = await client.get('/assistant/status');
    return res.data;
  } catch (err: any) {
    const status = err?.response?.status;
    const message = String(err?.message || '');
    if (status !== 404 && !message.includes('404')) throw err;
    return {
      configured: true,
      provider: 'web-data-assistant',
      model: 'legacy-rule-engine',
      freeOnly: true,
      legacyFallback: true,
    };
  }
}
