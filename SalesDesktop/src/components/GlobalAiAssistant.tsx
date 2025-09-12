import { useState } from 'react';
import { Button, Drawer, Input, Space, Typography, Tag, Spin, Empty } from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { askAssistant, AssistantTable } from '@/api/assistant';

const { Text, Paragraph } = Typography;

interface MessageItem {
  role: 'user' | 'assistant';
  content: string;
  tables?: AssistantTable[];
  llmUsed?: boolean;
}

function isTotalRow(row: any[]) {
  return /合计|平均|итого|средн/i.test(String(row?.[0] ?? ''));
}

function TableResult({ table }: { table: AssistantTable }) {
  const columns = table.columns || [];
  const rows = table.rows || [];

  if (!columns.length && !rows.length) return null;

  return (
    <section className="global-ai-table">
      {table.title && <div className="global-ai-table-title">{table.title}</div>}
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

export default function GlobalAiAssistant() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<MessageItem[]>([]);

  const submit = async () => {
    const text = question.trim();
    if (!text || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setQuestion('');
    setLoading(true);
    try {
      const data = await askAssistant(text, i18n.language === 'ru' ? 'ru' : 'zh');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.answer,
        tables: data.tables || [],
        llmUsed: Boolean(data.agent?.llmUsed),
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: err?.message || t('ai.queryFailed') }]);
    } finally {
      setLoading(false);
    }
  };

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
            ) : messages.map((item, index) => (
              <div key={index} className={`global-ai-message ${item.role}`}>
                {item.content && (!item.tables?.length || item.llmUsed) && (
                  <Paragraph className="global-ai-summary">{item.content}</Paragraph>
                )}
                {item.tables?.map((table, tableIndex) => (
                  <TableResult key={tableIndex} table={table} />
                ))}
              </div>
            ))}
            {loading && <div className="global-ai-message assistant"><Spin size="small" /> {t('ai.thinking')}</div>}
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
          <Button type="primary" icon={<SendOutlined />} onClick={submit} loading={loading} block>
            {t('ai.ask')}
          </Button>
        </div>
      </Drawer>
    </>
  );
}
