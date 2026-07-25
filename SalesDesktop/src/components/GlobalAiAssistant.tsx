import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Space, Typography, Tag, Spin, Empty, Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  assistantCellSpan,
  assistantCellText,
  buildAssistantConversationContext,
  buildAssistantPageContext,
  createAssistantSessionId,
  isAssistantTotalRow,
  isClearAssistantCommand,
  shouldSkipAssistantCell,
  tableToCsv,
} from '@shared/assistant-ui';
import {
  askAssistant,
  sendAssistantFeedback,
  AssistantChart,
  AssistantConversationContext,
  AssistantPlan,
  AssistantTable,
} from '@/api/assistant';

const { Paragraph } = Typography;

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
    sources?: string[];
  };
  querySpec?: Record<string, any>;
  reportGuidance?: Record<string, any>;
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

function buildPageContext(location: ReturnType<typeof useLocation>): AssistantConversationContext['pageContext'] {
  return buildAssistantPageContext(location);
}

function buildConversationContext(
  messages: MessageItem[],
  sessionId: string,
  pageContext: AssistantConversationContext['pageContext'],
): AssistantConversationContext {
  return buildAssistantConversationContext({
    messages,
    sessionId,
    pageContext,
    maxMessages: 8,
  }) as AssistantConversationContext;
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
            <tr key={rowIndex} className={isAssistantTotalRow(row) ? 'global-ai-total-row' : undefined}>
              {(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => (
                shouldSkipAssistantCell(cell) ? null : (
                  <td
                    key={cellIndex}
                    rowSpan={assistantCellSpan(cell, 'rowSpan')}
                    colSpan={assistantCellSpan(cell, 'colSpan')}
                  >
                    {assistantCellText(cell)}
                  </td>
                )
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
        querySpec: data.querySpec,
        reportGuidance: data.reportGuidance,
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
          <div className="global-ai-messages">
            {messages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.empty')} />
            ) : messages.map((item, index) => {
              const clarificationOptions = item.clarification?.options || [];
              const showClarificationOptions = index === latestClarificationIndex && !loading && clarificationOptions.length > 0;
              const hasAssistantTables = item.role === 'assistant' && Boolean(item.tables?.length);
              const showAssistantActions = item.role === 'assistant';
              return (
                <div key={index} className={`global-ai-message ${item.role}`}>
                  {item.content && (item.role !== 'assistant' || !hasAssistantTables) && (
                    <Paragraph className="global-ai-summary">{item.content}</Paragraph>
                  )}
                  {item.tables?.map((table, tableIndex) => (
                    <TableResult key={tableIndex} table={table} />
                  ))}
                  {showAssistantActions && <FeedbackBar item={item} question={messages[index - 1]?.role === 'user' ? messages[index - 1]?.content : undefined} />}
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
              if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
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
