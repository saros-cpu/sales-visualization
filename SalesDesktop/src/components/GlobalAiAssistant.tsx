import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Space, Typography, Tag, Spin, Empty, Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  askAssistant,
  getAssistantQualityDashboard,
  getAssistantStatus,
  getAssistantTools,
  sendAssistantFeedback,
  AssistantChart,
  AssistantConversationContext,
  AssistantPlan,
  AssistantTable,
} from '@/api/assistant';

const { Text, Paragraph } = Typography;

interface MessageItem {
  role: 'user' | 'assistant';
  content: string;
  tables?: AssistantTable[];
  charts?: AssistantChart[];
  llmUsed?: boolean;
  periodLabel?: string;
  assistantPlan?: AssistantPlan;
  needsClarification?: boolean;
  clarification?: AssistantPlan['clarification'];
  quality?: {
    status?: string;
    score?: number;
  };
  diagnostics?: {
    status?: string;
    warnings?: string[];
    insights?: string[];
    nextChecks?: string[];
  };
  freshness?: {
    status?: string;
    warnings?: string[];
  };
  conversationMemory?: Record<string, any>;
  agent?: {
    callId?: number;
    status?: string;
  };
  knowledgeReferences?: Array<{
    id?: string;
    title?: string;
    source?: string;
  }>;
}

interface AssistantOpsState {
  loading?: boolean;
  provider?: string;
  model?: string;
  configured?: boolean;
  total7d?: number;
  ok7d?: number;
  avgQualityScore?: number;
  toolsCount?: number;
  issueCount?: number;
  feedbackBad30d?: number;
}

function isTotalRow(row: any[]) {
  return /合计|平均|итого|средн/i.test(String(row?.[0] ?? ''));
}

function createAssistantSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isClearAssistantCommand(value: string) {
  return /^(清空|清除|清屏|重置|删除)(问答|对话|聊天|记录|上下文)?$|^(clear|reset|delete)\s+(chat|conversation|history|context)$|^(очисти|сбрось|удали)\s+(чат|диалог|историю|контекст)$/i.test(value.trim());
}

function compactAssistantPlan(plan?: AssistantPlan): AssistantPlan | undefined {
  if (!plan) return undefined;
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
    subPlans: plan.subPlans?.slice(0, 5).map(compactAssistantPlan).filter(Boolean) as AssistantPlan[] | undefined,
    needsClarification: plan.needsClarification,
    clarification: plan.clarification,
    clarificationResolved: plan.clarificationResolved,
    explicit: plan.explicit,
    visual: plan.visual,
    contextUsed: plan.contextUsed,
  };
}

function buildPageContext(location: ReturnType<typeof useLocation>): AssistantConversationContext['pageContext'] {
  const params = Object.fromEntries(new URLSearchParams(location.search).entries());
  const segments = location.pathname.split('/').filter(Boolean);
  return {
    path: location.pathname,
    search: location.search,
    hash: window.location.hash,
    module: segments[0] || '',
    page: segments[1] || (segments[0] || 'home'),
    title: document.title,
    searchParams: params,
  };
}

function buildConversationContext(
  messages: MessageItem[],
  sessionId: string,
  pageContext: AssistantConversationContext['pageContext'],
): AssistantConversationContext {
  const lastAssistant = [...messages].reverse().find(item => item.role === 'assistant' && item.assistantPlan);
  return {
    sessionId,
    pageContext,
    lastAssistantPlan: compactAssistantPlan(lastAssistant?.assistantPlan),
    recentMessages: messages.slice(-8).map(item => ({
      role: item.role,
      content: item.content.slice(0, 500),
      periodLabel: item.periodLabel,
      assistantPlan: compactAssistantPlan(item.assistantPlan),
      chartHints: (item.charts || []).slice(0, 3).map(chart => ({
        title: chart.title,
        type: chart.type,
        xAxis: (chart.xAxis || []).slice(0, 12),
      })),
      tableHints: (item.tables || []).slice(0, 2).map(table => ({
        title: table.title,
        columns: (table.columns || []).slice(0, 8),
        firstRows: (table.rows || []).slice(0, 3),
      })),
    })),
  };
}

function tableToCsv(table: AssistantTable) {
  const rows = [table.columns || [], ...(table.rows || [])];
  return rows.map(row => row.map(cell => {
    const text = String(cell ?? '').replace(/"/g, '""');
    return /[",\n]/.test(text) ? `"${text}"` : text;
  }).join(',')).join('\n');
}

function TableResult({ table }: { table: AssistantTable }) {
  const columns = table.columns || [];
  const rows = table.rows || [];

  if (!columns.length && !rows.length) return null;

  const copyTable = async () => {
    await navigator.clipboard?.writeText(tableToCsv(table));
    message.success('已复制表格');
  };
  const downloadCsv = () => {
    const blob = new Blob([`\ufeff${tableToCsv(table)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${table.title || 'assistant-table'}.csv`.replace(/[\\/:*?"<>|]/g, '_');
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="global-ai-table">
      <div className="global-ai-table-head">
        {table.title && <div className="global-ai-table-title">{table.title}</div>}
        <Space size={4}>
          <Tooltip title="复制表格">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyTable} />
          </Tooltip>
          <Tooltip title="下载 CSV">
            <Button size="small" type="text" icon={<DownloadOutlined />} onClick={downloadCsv} />
          </Tooltip>
        </Space>
      </div>
      <table>
        {columns.length > 0 && (
          <thead>
            <tr>
              {columns.map((col, index) => (
                <th key={`${col}-${index}`}>{col}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={isTotalRow(row) ? 'global-ai-total-row' : undefined}>
              {(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => (
                <td key={cellIndex}>{cell ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlanMeta({ plan }: { plan?: AssistantPlan }) {
  if (!plan) return null;
  const period = plan.period;
  const tool = plan.tool;
  const comparison = plan.comparison?.period;
  const selfCheck = plan.selfCheck;
  const selfCheckColor = selfCheck?.status === 'fail' ? 'red' : selfCheck?.status === 'warn' ? 'orange' : 'cyan';
  const selfCheckLabel = selfCheck?.status === 'fail' ? '自检未通过' : selfCheck?.status === 'warn' ? '自检有假设' : '自检通过';
  return (
    <div className="global-ai-plan-meta">
      {period?.label && <Tag>{period.label}</Tag>}
      {plan.metric && <Tag color="blue">{plan.metric}</Tag>}
      {plan.dimensions?.map(item => <Tag key={item}>{item}</Tag>)}
      {tool?.description && <Tag color="green">{tool.description}</Tag>}
      {comparison?.label && <Tag color="purple">对比：{comparison.label}</Tag>}
      {plan.subPlans?.length ? <Tag color="gold">拆解 {plan.subPlans.length} 个子问题</Tag> : null}
      {selfCheck?.status && (
        <Tooltip title={(selfCheck.risks || []).join('；') || `score ${selfCheck.score ?? '-'}`}>
          <Tag color={selfCheckColor}>{selfCheckLabel}</Tag>
        </Tooltip>
      )}
    </div>
  );
}

function ResponseMeta({ item }: { item: MessageItem }) {
  const quality = item.quality;
  const diagnostics = item.diagnostics;
  const freshness = item.freshness;
  const refs = item.knowledgeReferences || [];
  if (!quality?.status && !diagnostics?.warnings?.length && !diagnostics?.nextChecks?.length && !freshness?.status && refs.length === 0) return null;
  const qualityColor = quality?.status === 'fail' ? 'red' : quality?.status === 'warn' ? 'orange' : quality?.status === 'blocked' ? 'volcano' : 'cyan';
  const freshnessColor = freshness?.status === 'partial' ? 'orange' : freshness?.status === 'complete' ? 'green' : 'default';
  return (
    <div className="global-ai-plan-meta">
      {quality?.status && <Tag color={qualityColor}>质量 {quality.score ?? '-'} / {quality.status}</Tag>}
      {freshness?.status && <Tag color={freshnessColor}>数据 {freshness.status}</Tag>}
      {(diagnostics?.warnings || []).slice(0, 2).map(item => <Tag color="orange" key={item}>{item}</Tag>)}
      {(diagnostics?.insights || []).slice(0, 2).map(item => <Tag color="cyan" key={item}>{item}</Tag>)}
      {(diagnostics?.nextChecks || []).slice(0, 3).map(item => <Tag color="geekblue" key={item}>排查：{item}</Tag>)}
      {(freshness?.warnings || []).slice(0, 2).map(item => <Tag color="gold" key={item}>{item}</Tag>)}
      {refs.map(ref => (
        <Tooltip key={ref.id || ref.title} title={ref.source || ref.title}>
          <Tag color="purple">{ref.id} {ref.title}</Tag>
        </Tooltip>
      ))}
    </div>
  );
}

function FeedbackBar({ item, question }: { item: MessageItem; question?: string }) {
  if (item.role !== 'assistant') return null;
  const submitFeedback = async (rating: 'correct' | 'wrong' | 'scope_error') => {
    try {
      await sendAssistantFeedback({
        callId: item.agent?.callId,
        rating,
        question,
        answer: item.content,
        assistantPlan: item.assistantPlan,
        quality: item.quality,
        agent: item.agent as any,
      });
      message.success('已记录反馈');
    } catch (err: any) {
      message.error(err?.message || '反馈提交失败');
    }
  };
  return (
    <Space size={6} className="global-ai-plan-meta">
      <Button size="small" type="text" onClick={() => submitFeedback('correct')}>正确</Button>
      <Button size="small" type="text" onClick={() => submitFeedback('wrong')}>不准</Button>
      <Button size="small" type="text" onClick={() => submitFeedback('scope_error')}>口径问题</Button>
    </Space>
  );
}

function AssistantOpsBar({ state }: { state: AssistantOpsState }) {
  if (!state.provider && state.toolsCount === undefined && state.avgQualityScore === undefined && !state.loading) return null;
  const qualityColor = (state.avgQualityScore ?? 1) < 0.75 ? 'orange' : 'green';
  return (
    <div className="global-ai-ops-bar">
      <Tag color={state.configured === false ? 'red' : 'blue'}>
        {state.provider || 'assistant'}{state.model ? ` / ${state.model}` : ''}
      </Tag>
      {state.toolsCount !== undefined && <Tag color="cyan">工具 {state.toolsCount}</Tag>}
      {state.total7d !== undefined && <Tag>7天 {state.ok7d ?? 0}/{state.total7d}</Tag>}
      {state.avgQualityScore !== undefined && <Tag color={qualityColor}>质量 {state.avgQualityScore.toFixed(2)}</Tag>}
      {state.issueCount !== undefined && state.issueCount > 0 && <Tag color="orange">待复盘 {state.issueCount}</Tag>}
      {state.feedbackBad30d !== undefined && state.feedbackBad30d > 0 && <Tag color="volcano">负反馈 {state.feedbackBad30d}</Tag>}
      {state.loading && <Tag>同步中</Tag>}
    </div>
  );
}

export default function GlobalAiAssistant() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [opsState, setOpsState] = useState<AssistantOpsState>({});
  const [sessionId] = useState(createAssistantSessionId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading, open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setOpsState(prev => ({ ...prev, loading: true }));
    Promise.allSettled([
      getAssistantStatus(),
      getAssistantTools(),
      getAssistantQualityDashboard(),
    ]).then(([statusResult, toolsResult, dashboardResult]) => {
      if (cancelled) return;
      const status = (statusResult.status === 'fulfilled' ? statusResult.value : {}) as Record<string, any>;
      const tools = (toolsResult.status === 'fulfilled' ? toolsResult.value : {}) as Record<string, any>;
      const dashboard = (dashboardResult.status === 'fulfilled' ? dashboardResult.value : {}) as Record<string, any>;
      const feedbackBad30d = Array.isArray(dashboard.feedback)
        ? dashboard.feedback
            .filter((item: any) => ['wrong', 'unclear', 'scope_error', 'format_error'].includes(String(item.rating)))
            .reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)
        : undefined;
      setOpsState({
        loading: false,
        provider: status.provider,
        model: status.model,
        configured: status.configured,
        total7d: status.total7d,
        ok7d: status.ok7d,
        avgQualityScore: typeof status.avgQualityScore === 'number' ? status.avgQualityScore : undefined,
        toolsCount: typeof tools.count === 'number' ? tools.count : Array.isArray(tools.items) ? tools.items.length : undefined,
        issueCount: Array.isArray(dashboard.recentIssues) ? dashboard.recentIssues.length : undefined,
        feedbackBad30d,
      });
    }).catch(() => {
      if (!cancelled) setOpsState(prev => ({ ...prev, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const submit = async (manualQuestion?: string) => {
    const text = (typeof manualQuestion === 'string' ? manualQuestion : question).trim();
    if (!text || loading) return;
    if (isClearAssistantCommand(text)) {
      setMessages([]);
      setQuestion('');
      message.success('已清空问答');
      return;
    }
    const conversationContext = buildConversationContext(messages, sessionId, buildPageContext(location));
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setQuestion('');
    setLoading(true);
    try {
      const data = await askAssistant(text, i18n.language === 'ru' ? 'ru' : 'zh', {
        sessionId,
        conversationContext,
      });
      if (data.uiCommand?.type === 'clearConversation') {
        setMessages([]);
        message.success('已清空问答');
        return;
      }
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer,
        tables: data.tables || [],
        charts: data.charts || [],
        llmUsed: Boolean(data.agent?.llmUsed),
        periodLabel: data.periodLabel,
        assistantPlan: data.assistantPlan,
        needsClarification: Boolean(data.needsClarification || data.assistantPlan?.needsClarification),
        clarification: data.clarification || data.assistantPlan?.clarification,
        quality: data.quality,
        diagnostics: data.diagnostics,
        freshness: data.freshness,
        conversationMemory: data.conversationMemory,
        knowledgeReferences: data.knowledgeReferences,
        agent: data.agent,
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: err?.message || t('ai.queryFailed') }]);
    } finally {
      setLoading(false);
    }
  };

  const latestClarificationIndex = messages.reduce((last, item, index) => (
    item.role === 'assistant' && item.needsClarification && item.clarification?.options?.length ? index : last
  ), -1);

  return (
    <>
      <Button
        type="primary"
        shape="circle"
        icon={<RobotOutlined />}
        className="global-ai-button"
        onClick={() => setOpen(true)}
      />
      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>{t('ai.title')}</span>
            <Tag color="blue">{t('ai.readOnly')}</Tag>
          </Space>
        }
        open={open}
        onClose={() => setOpen(false)}
        width="min(760px, calc(100vw - 28px))"
        className="global-ai-drawer"
        rootClassName="global-ai-drawer-root"
      >
        <div className="global-ai-panel">
          <Text type="secondary" className="global-ai-hint">{t('ai.readOnlyHint')}</Text>
          <AssistantOpsBar state={opsState} />
          <div className="global-ai-messages">
            {messages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.empty')} />
            ) : messages.map((item, index) => {
              const clarificationOptions = item.clarification?.options || [];
              const showClarificationOptions = index === latestClarificationIndex && !loading && clarificationOptions.length > 0;
              const hasAssistantTables = item.role === 'assistant' && Boolean(item.tables?.length);
              const showAssistantDetails = item.role === 'assistant' && !hasAssistantTables;
              return (
                <div key={index} className={`global-ai-message ${item.role}`}>
			                  {item.content && (item.role !== 'assistant' || !hasAssistantTables) && (
			                    <Paragraph className="global-ai-summary">{item.content}</Paragraph>
			                  )}
			                  {showAssistantDetails && <PlanMeta plan={item.assistantPlan} />}
			                  {showAssistantDetails && <ResponseMeta item={item} />}
			                  {showAssistantDetails && <FeedbackBar item={item} question={messages[index - 1]?.role === 'user' ? messages[index - 1]?.content : undefined} />}
			                  {item.tables?.map((table, tableIndex) => (
                    <TableResult key={tableIndex} table={table} />
                  ))}
                  {showClarificationOptions && (
                    <div className="global-ai-clarification-options">
                      {clarificationOptions.map(option => (
                        <Button
                          key={option}
                          size="small"
                          onClick={() => submit(option)}
                          disabled={loading}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {loading && <div className="global-ai-message assistant"><Spin size="small" /> {t('ai.thinking')}</div>}
            <div ref={messagesEndRef} />
          </div>
          <Input.TextArea
            value={question}
            rows={3}
            placeholder={t('ai.placeholder')}
            onChange={(event) => setQuestion(event.target.value)}
            onPressEnter={(event) => {
              if (event.ctrlKey || event.metaKey) submit();
            }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={() => submit()} loading={loading} block>
            {t('ai.ask')}
          </Button>
        </div>
      </Drawer>
    </>
  );
}
