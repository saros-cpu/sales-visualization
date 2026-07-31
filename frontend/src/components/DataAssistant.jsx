import { useRef, useState } from 'react';
import { ApiPaths } from '@shared/api-contracts';
import {
  assistantCellSpan,
  assistantCellText,
  buildAssistantConversationContext,
  buildAssistantPageContext,
  createAssistantSessionId,
  isAssistantTotalRow,
  isClearAssistantCommand,
  shouldSkipAssistantCell,
} from '@shared/assistant-ui';
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

function buildConversationContext(sessionId, previousQuestion, previousAnswer) {
  return buildAssistantConversationContext({
    sessionId,
    pageContext: buildAssistantPageContext(),
    messages: [
      previousQuestion ? { role: 'user', content: previousQuestion } : null,
      previousAnswer?.answer ? {
        role: 'assistant',
        content: String(previousAnswer.answer),
        periodLabel: previousAnswer.periodLabel,
        assistantPlan: previousAnswer.assistantPlan,
        tables: previousAnswer.tables,
        charts: previousAnswer.charts,
      } : null,
    ].filter(Boolean),
  });
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
            <tr key={ri} className={isAssistantTotalRow(row) ? 'data-assistant-total-row' : ''}>
              {row.map((cell, ci) => (
                shouldSkipAssistantCell(cell) ? null : (
                  <td
                    key={ci}
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

async function queryAssistant(question, conversationContext) {
  const body = {
    question,
    language: 'zh',
    useLlm: false,
    sessionId: conversationContext?.sessionId,
    conversationContext,
  };
  return post(ApiPaths.assistant.query, body);
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

  function handleButtonClick(event, action) {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  async function submitQuestion(question) {
    if (!question?.trim()) return;
    const text = question.trim();
    if (isClearAssistantCommand(text)) {
      if (abortRef.current) abortRef.current.abort();
      setInput('');
      setAnswer(null);
      setError('');
      setLoading(false);
      lastQuestionRef.current = '';
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setAnswer(null);

    try {
      const context = buildConversationContext(sessionIdRef.current, lastQuestionRef.current, answer);
      const data = await queryAssistant(text, context);
      if (data?.uiCommand?.type === 'clearConversation') {
        setInput('');
        setAnswer(null);
        lastQuestionRef.current = '';
        return;
      }
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
      <button type="button" className="data-assistant-fab" onClick={(e) => handleButtonClick(e, () => setOpen(!open))}>
        经营助手
      </button>
      <section className={`data-assistant-panel ${open ? 'open' : ''}`}>
        <div className="data-assistant-head">
          <span>经营数据助手</span>
        </div>
        <div className="data-assistant-body">
          <textarea
            placeholder="例如：5月零售销量、本月每日趋势、同比环比、停业站点、油品占比、年度KPI"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                submitQuestion(input);
              }
            }}
          />
          <div className="data-assistant-suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                type="button"
                key={s.label}
                onClick={(e) => handleButtonClick(e, () => { setInput(s.question); submitQuestion(s.question); })}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="data-assistant-actions">
            <button type="button" className="data-assistant-close" onClick={(e) => handleButtonClick(e, () => setOpen(false))}>
              收起
            </button>
            <button type="button" className="data-assistant-submit" onClick={(e) => handleButtonClick(e, () => submitQuestion(input))}>
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
                {answer?.answer || '选择快捷问题或直接输入经营问题，结果会优先以表格显示。'}
              </>
            )}
            {showClarificationOptions && (
              <div className="data-assistant-clarification-options">
                {clarificationOptions.map(option => (
	                  <button
	                    key={option}
	                    type="button"
	                    onClick={(e) => handleButtonClick(e, () => { setInput(option); submitQuestion(option); })}
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
