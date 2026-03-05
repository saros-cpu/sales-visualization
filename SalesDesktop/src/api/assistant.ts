import axios from 'axios';
import client from './client';
import { API_HOST } from './http';

export interface AssistantTable {
  title?: string;
  columns?: string[];
  rows?: any[][];
}

export interface AssistantPlan {
  normalizedQuestion?: string;
  domain?: string;
  intent?: string;
  route?: string;
  metric?: string;
  dimensions?: string[];
  entities?: Record<string, any>;
  period?: {
    label?: string;
    start?: string;
    endExclusive?: string;
    endInclusive?: string;
  };
  tool?: {
    name?: string;
    description?: string;
    readOnly?: boolean;
    dataSource?: string;
  };
  businessTerms?: Record<string, Record<string, string[]>>;
  comparison?: {
    type?: string;
    mode?: string;
    description?: string;
    period?: {
      label?: string;
      start?: string;
      endExclusive?: string;
      endInclusive?: string;
    };
  } | null;
  executionHints?: string[];
  assumptions?: string[];
  selfCheck?: {
    status?: 'pass' | 'warn' | 'fail' | string;
    score?: number;
    nextAction?: string;
    checks?: Array<{
      code?: string;
      label?: string;
      status?: 'pass' | 'warn' | 'fail' | string;
      severity?: string;
      detail?: string;
    }>;
    risks?: string[];
  };
  subPlans?: AssistantPlan[];
  needsClarification?: boolean;
  clarification?: {
    question?: string;
    missing?: string[];
    options?: string[];
  } | null;
  clarificationResolved?: {
    fromQuestion?: string;
    answer?: string;
    resolved?: string[];
  } | null;
  explicit?: {
    domain?: boolean;
    dimensions?: string[];
    metric?: boolean;
    period?: boolean;
  };
  contextUsed?: string[];
  confidence?: number;
  [key: string]: any;
}

export interface AssistantConversationContext {
  sessionId?: string;
  lastAssistantPlan?: AssistantPlan;
  pageContext?: {
    path?: string;
    search?: string;
    hash?: string;
    module?: string;
    page?: string;
    title?: string;
    searchParams?: Record<string, string>;
  };
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
    periodLabel?: string;
    assistantPlan?: AssistantPlan;
  }>;
  [key: string]: any;
}

export interface AssistantResponse {
  ok: boolean;
  question: string;
  periodLabel?: string;
  answer: string;
  sourceAnswer?: string;
  tables?: AssistantTable[];
  assistantPlan?: AssistantPlan;
  needsClarification?: boolean;
  clarification?: AssistantPlan['clarification'];
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

export interface AskAssistantOptions {
  sessionId?: string;
  conversationContext?: AssistantConversationContext;
}

export async function askAssistant(question: string, language: string, options: AskAssistantOptions = {}) {
  const body = {
    question,
    language,
    useLlm: true,
    sessionId: options.sessionId,
    conversationContext: options.conversationContext,
  };
  try {
    const res = await client.post('/assistant/query', body);
    return res.data as AssistantResponse;
  } catch (err: any) {
    const status = err?.response?.status;
    const message = String(err?.message || '');
    if (status !== 404 && !message.includes('404')) throw err;
    const token = localStorage.getItem('accessToken');
    const legacy = await axios.post(
      `${API_HOST}/api/data-assistant/query`,
      body,
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
