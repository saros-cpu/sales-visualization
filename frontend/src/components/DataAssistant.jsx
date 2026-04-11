import { useRef, useState } from 'react';
import { post } from '../api/client';

const SUGGESTIONS = [
  { label: '本月零售', question: '本月零售销量' },
  { label: '月趋势', question: '本月每日销量趋势' },
  { label: '年KPI', question: '2026年KPI' },
  { label: '月批发', question: '本月批发分类统计' },
  { label: '批发客户', question: '本月批发客户排行' },
  { label: '合计', question: '本月合并统计' },
  { label: '同比', question: '本月同比环比' },
  { label: '油品占比', question: '本月油品占比' },
  { label: '零售价', question: '本月零售价格' },
  { label: '停业站点', question: '当前停业站点' },
  { label: '今日汇率', question: '今日汇率' },
  { label: '市场观察', question: '市场观察' },
  { label: '密度', question: '当前密度' },
];

function isTotalRow(row) {
  return /合计|平均/.test(String((row || [])[0] ?? ''));
}

function createAssistantSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `web-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function compactAssistantPlan(plan) {
  if (!plan || typeof plan !== 'object') return undefined;
  return {
    domain: plan.domain,
    intent: plan.intent,
    route: plan.route,
    metric: plan.metric,
    dimensions: plan.dimensions,
    entities: plan.entities,
    period: plan.period,
    tool: plan.tool,
    businessTerms: plan.businessTerms,
    comparison: plan.comparison,
    executionHints: plan.executionHints,
    assumptions: plan.assumptions,
    selfCheck: plan.selfCheck,
    subPlans: Array.isArray(plan.subPlans) ? plan.subPlans.slice(0, 5).map(compactAssistantPlan).filter(Boolean) : undefined,
    needsClarification: plan.needsClarification,
    clarification: plan.clarification,
    clarificationResolved: plan.clarificationResolved,
    explicit: plan.explicit,
    visual: plan.visual,
    contextUsed: plan.contextUsed,
  };
}

function buildPageContext() {
  const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
  const segments = window.location.pathname.split('/').filter(Boolean);
  return {
    path: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    module: segments[0] || '',
    page: segments[1] || (segments[0] || 'home'),
    title: document.title,
    searchParams: params,
  };
}

function buildConversationContext(sessionId, previousQuestion, previousAnswer) {
  const previousPlan = compactAssistantPlan(previousAnswer?.assistantPlan);
  return {
    sessionId,
    pageContext: buildPageContext(),
    lastAssistantPlan: previousPlan,
    recentMessages: [
      previousQuestion ? { role: 'user', content: previousQuestion.slice(0, 500) } : null,
      previousAnswer?.answer ? {
        role: 'assistant',
        content: String(previousAnswer.answer).slice(0, 500),
        periodLabel: previousAnswer.periodLabel,
        assistantPlan: previousPlan,
      } : null,
    ].filter(Boolean),
  };
}

function TableResult({ table }) {
  return (
    <section className="data-assistant-table">
      <div className="data-assistant-table-title">{table.title || '明细'}</div>
      <table>
        <thead>
          <tr>
            {(table.columns || []).map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(table.rows || []).map((row, ri) => (
            <tr key={ri} className={isTotalRow(row) ? 'data-assistant-total-row' : ''}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlanMeta({ plan }) {
  if (!plan) return null;
  return (
    <div className="data-assistant-plan-meta">
      {plan.period?.label && <span>{plan.period.label}</span>}
      {plan.metric && <span>{plan.metric}</span>}
      {plan.tool?.description && <span>{plan.tool.description}</span>}
      {plan.comparison?.period?.label && <span>对比：{plan.comparison.period.label}</span>}
      {Array.isArray(plan.subPlans) && plan.subPlans.length > 0 && <span>拆解 {plan.subPlans.length} 个子问题</span>}
      {plan.selfCheck?.status && <span>{plan.selfCheck.status === 'fail' ? '自检未通过' : plan.selfCheck.status === 'warn' ? '自检有假设' : '自检通过'}</span>}
    </div>
  );
}

function ResponseMeta({ answer }) {
  const quality = answer?.quality || {};
  const diagnostics = answer?.diagnostics || {};
  const freshness = answer?.freshness || {};
  const refs = Array.isArray(answer?.knowledgeReferences) ? answer.knowledgeReferences : [];
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings.slice(0, 2) : [];
  const insights = Array.isArray(diagnostics.insights) ? diagnostics.insights.slice(0, 2) : [];
  const nextChecks = Array.isArray(diagnostics.nextChecks) ? diagnostics.nextChecks.slice(0, 3) : [];
  const freshnessWarnings = Array.isArray(freshness.warnings) ? freshness.warnings.slice(0, 2) : [];
  if (!quality.status && warnings.length === 0 && insights.length === 0 && nextChecks.length === 0 && !freshness.status && refs.length === 0) return null;
  return (
    <div className="data-assistant-plan-meta">
      {quality.status && <span>质量 {quality.score ?? '-'} / {quality.status}</span>}
      {freshness.status && <span>数据 {freshness.status}</span>}
      {warnings.map(item => <span key={item}>{item}</span>)}
      {insights.map(item => <span key={item}>{item}</span>)}
      {nextChecks.map(item => <span key={item}>排查：{item}</span>)}
      {freshnessWarnings.map(item => <span key={item}>{item}</span>)}
      {refs.map(ref => <span key={ref.id || ref.title}>{ref.id} {ref.title}</span>)}
    </div>
  );
}

async function queryAssistant(question, conversationContext) {
  const body = {
    question,
    language: 'zh',
    useLlm: true,
    sessionId: conversationContext?.sessionId,
    conversationContext,
  };
  const token = localStorage.getItem('accessToken');
  if (token) {
    const res = await fetch('/api/v2/assistant/query', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const body = await res.json();
      return body.data ?? body;
    }
    if (res.status !== 401 && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || body.error || 'AI 查询失败');
    }
  }

  return post('/api/data-assistant/query?_=' + Date.now(), body);
}

export default function DataAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const sessionIdRef = useRef(createAssistantSessionId());
  const lastQuestionRef = useRef('');
  const clarificationOptions = Array.isArray(answer?.clarification?.options) ? answer.clarification.options : [];
  const showClarificationOptions = !loading && !error && clarificationOptions.length > 0;
  const hasTableAnswer = Array.isArray(answer?.tables) && answer.tables.length > 0;

  async function submitQuestion(question) {
    if (!question?.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setAnswer(null);

    try {
      const text = question.trim();
      const context = buildConversationContext(sessionIdRef.current, lastQuestionRef.current, answer);
      const data = await queryAssistant(text, context);
      setAnswer(data);
      lastQuestionRef.current = text;
    } catch (err) {
      setError(err.name === 'AbortError' ? '查询超时，请稍后重试。' : '查询失败：' + err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="dataAssistantWidget">
      <button className="data-assistant-fab" onClick={() => setOpen(!open)}>
        经营助手
      </button>
      <section className={`data-assistant-panel ${open ? 'open' : ''}`}>
        <div className="data-assistant-head">
          <span>经营数据助手</span>
          <small>快照优先 · 表格展示</small>
        </div>
        <div className="data-assistant-body">
          <div className="data-assistant-hint">
            优先读取快照数据。支持零售/批发/外运/汇率/密度/合同/客户/市场观察/站点状态/趋势/KPI/同比环比/油品占比。
          </div>
          <textarea
            placeholder="例如：5月零售销量、本月每日趋势、同比环比、停业站点、油品占比、年度KPI"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                submitQuestion(input);
              }
            }}
          />
          <div className="data-assistant-suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s.label} onClick={() => { setInput(s.question); submitQuestion(s.question); }}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="data-assistant-actions">
            <button className="data-assistant-close" onClick={() => setOpen(false)}>
              收起
            </button>
            <button className="data-assistant-submit" onClick={() => submitQuestion(input)}>
              查询
            </button>
          </div>
          <div className="data-assistant-answer">
            {loading ? (
              '正在查询...'
            ) : error ? (
              <span style={{ color: '#ef5350' }}>{error}</span>
            ) : hasTableAnswer ? (
              <>
			                  {(answer.tables || []).map((table, i) => <TableResult key={i} table={table} />)}
              </>
            ) : (
	              <>
	                <PlanMeta plan={answer?.assistantPlan} />
	                <ResponseMeta answer={answer} />
	                {answer?.answer || '选择快捷问题或直接输入经营问题，结果会优先以表格显示。'}
	              </>
            )}
            {showClarificationOptions && (
              <div className="data-assistant-clarification-options">
                {clarificationOptions.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => { setInput(option); submitQuestion(option); }}
                    disabled={loading}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
