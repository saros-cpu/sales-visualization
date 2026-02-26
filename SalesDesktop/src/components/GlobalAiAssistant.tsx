import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Space, Typography, Tag, Spin, Empty, Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { askAssistant, AssistantConversationContext, AssistantPlan, AssistantTable } from '@/api/assistant';

const { Text, Paragraph } = Typography;

interface MessageItem {
  role: 'user' | 'assistant';
  content: string;
  tables?: AssistantTable[];
  llmUsed?: boolean;
  periodLabel?: string;
  assistantPlan?: AssistantPlan;
  needsClarification?: boolean;
  clarification?: AssistantPlan['clarification'];
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
    subPlans: plan.subPlans?.slice(0, 5).map(compactAssistantPlan).filter(Boolean) as AssistantPlan[] | undefined,
    needsClarification: plan.needsClarification,
    clarification: plan.clarification,
    clarificationResolved: plan.clarificationResolved,
    explicit: plan.explicit,
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
  return (
    <div className="global-ai-plan-meta">
      {period?.label && <Tag>{period.label}</Tag>}
      {plan.metric && <Tag color="blue">{plan.metric}</Tag>}
      {plan.dimensions?.map(item => <Tag key={item}>{item}</Tag>)}
      {tool?.description && <Tag color="green">{tool.description}</Tag>}
      {comparison?.label && <Tag color="purple">对比：{comparison.label}</Tag>}
      {plan.subPlans?.length ? <Tag color="gold">拆解 {plan.subPlans.length} 个子问题</Tag> : null}
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
  const [sessionId] = useState(createAssistantSessionId);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, loading, open]);

  const submit = async (manualQuestion?: string) => {
    const text = (typeof manualQuestion === 'string' ? manualQuestion : question).trim();
    if (!text || loading) return;
    const conversationContext = buildConversationContext(messages, sessionId, buildPageContext(location));
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setQuestion('');
    setLoading(true);
    try {
      const data = await askAssistant(text, i18n.language === 'ru' ? 'ru' : 'zh', {
        sessionId,
        conversationContext,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer,
        tables: data.tables || [],
        llmUsed: Boolean(data.agent?.llmUsed),
        periodLabel: data.periodLabel,
        assistantPlan: data.assistantPlan,
        needsClarification: Boolean(data.needsClarification || data.assistantPlan?.needsClarification),
        clarification: data.clarification || data.assistantPlan?.clarification,
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
          <div className="global-ai-messages">
            {messages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.empty')} />
            ) : messages.map((item, index) => {
              const clarificationOptions = item.clarification?.options || [];
              const showClarificationOptions = index === latestClarificationIndex && !loading && clarificationOptions.length > 0;
              return (
                <div key={index} className={`global-ai-message ${item.role}`}>
	                  {item.content && (!item.tables?.length || item.llmUsed) && (
	                    <Paragraph className="global-ai-summary">{item.content}</Paragraph>
	                  )}
                  {item.role === 'assistant' && <PlanMeta plan={item.assistantPlan} />}
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
