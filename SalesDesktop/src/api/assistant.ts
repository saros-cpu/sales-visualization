import client from './client';
import { API_HOST } from './http';

export interface AssistantTable {
  title?: string;
  columns?: string[];
  rows?: any[][];
}

export interface AssistantChartSeries {
  name?: string;
  type?: 'bar' | 'line' | string;
  unit?: string;
  data?: number[];
}

export interface AssistantChart {
  title?: string;
  type?: 'bar' | 'line' | 'mixed' | 'pie' | string;
  xAxis?: string[];
  series?: AssistantChartSeries[];
  data?: Array<{ name?: string; value?: number }>;
  unit?: string;
  summary?: string;
  source?: string;
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
  visual?: {
    requested?: boolean;
    preferredType?: string;
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
    chartHints?: Array<{ title?: string; type?: string; xAxis?: string[] }>;
    tableHints?: Array<{ title?: string; columns?: string[]; firstRows?: any[][] }>;
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
  charts?: AssistantChart[];
  assistantPlan?: AssistantPlan;
  querySpec?: Record<string, any>;
  permission?: { allowed?: boolean; required?: string[]; role?: string } | null;
  chartGuidance?: Record<string, any>;
  diagnostics?: { status?: string; warnings?: string[]; insights?: string[]; nextChecks?: string[] };
  freshness?: { status?: string; periodLabel?: string; warnings?: string[]; sources?: string[] };
  conversationMemory?: Record<string, any>;
  quality?: {
    status?: 'pass' | 'warn' | 'fail' | 'blocked' | string;
    score?: number;
    checks?: Array<{ code?: string; status?: string; detail?: string }>;
  };
  knowledgeReferences?: Array<{
    id?: string;
    articleId?: number;
    title?: string;
    source?: string;
    moduleKey?: string;
    updatedAt?: string;
    snippet?: string;
  }>;
  uiCommand?: {
    type?: string;
    [key: string]: any;
  };
  needsClarification?: boolean;
  clarification?: AssistantPlan['clarification'];
  agent?: {
    callId?: number;
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

export async function sendAssistantFeedback(payload: {
  callId?: number;
  rating: 'correct' | 'useful' | 'wrong' | 'unclear' | 'scope_error' | 'format_error';
  reason?: string;
  comment?: string;
  question?: string;
  answer?: string;
  assistantPlan?: AssistantPlan;
  quality?: AssistantResponse['quality'];
  agent?: AssistantResponse['agent'];
}) {
  const res = await client.post('/assistant/feedback', payload);
  return res.data;
}

export async function getAssistantTools() {
  const res = await client.get('/assistant/tools');
  return res.data as { items: Array<Record<string, any>>; count: number };
}

export async function getAssistantQualityDashboard() {
  const res = await client.get('/assistant/quality-dashboard');
  return res.data as Record<string, any>;
}

export type AssistantStreamEvent = 'started' | 'planned' | 'completed' | 'error' | 'final';

export async function streamAssistant(
  question: string,
  language: string,
  options: AskAssistantOptions = {},
  onEvent: (event: AssistantStreamEvent, data: any) => void,
) {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API_HOST}/api/v2/assistant/query/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      question,
      language,
      sessionId: options.sessionId,
      conversationContext: options.conversationContext,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`assistant_stream_failed_${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushBlock = (block: string) => {
    const event = (block.match(/^event:\s*(.+)$/m)?.[1] || 'completed') as AssistantStreamEvent;
    const dataText = block.match(/^data:\s*(.*)$/m)?.[1] || '{}';
    try {
      onEvent(event, JSON.parse(dataText));
    } catch {
      onEvent('error', { message: 'assistant_stream_parse_failed', raw: dataText });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (part.trim()) flushBlock(part);
    }
    if (done) break;
  }
  if (buffer.trim()) flushBlock(buffer);
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
  const res = await client.post('/assistant/query', body);
  return res.data as AssistantResponse;
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
      model: 'business-rule-engine',
      freeOnly: true,
      ruleEngineFallback: true,
    };
  }
}
