import { useState, useRef } from 'react';
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
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

async function queryAssistant(question) {
  const token = localStorage.getItem('accessToken');
  if (token) {
    const res = await fetch('/api/v2/assistant/query', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question, language: 'zh', useLlm: true }),
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

  return post('/api/data-assistant/query?_=' + Date.now(), { question });
}

export default function DataAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  async function submitQuestion(question) {
    if (!question?.trim()) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError('');
    setAnswer(null);

    try {
      const data = await queryAssistant(question.trim());
      setAnswer(data);
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
            ) : answer?.tables?.length ? (
              <>
                {answer?.answer && answer?.agent?.llmUsed && (
                  <div className="data-assistant-summary">{answer.answer}</div>
                )}
                {answer.tables.map((table, i) => <TableResult key={i} table={table} />)}
              </>
            ) : (
              answer?.answer || '选择快捷问题或直接输入经营问题，结果会优先以表格显示。'
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
