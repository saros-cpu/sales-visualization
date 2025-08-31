import { useState } from 'react';
import { Button, Drawer, Input, Space, Typography, Tag, Spin, Empty } from 'antd';
import { RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { askAssistant, AssistantResponse } from '@/api/assistant';

const { Text, Paragraph } = Typography;

interface MessageItem {
  role: 'user' | 'assistant';
  content: string;
  meta?: AssistantResponse['agent'];
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
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, meta: data.agent }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: err?.message || t('ai.queryFailed'), meta: { status: 'failed', llmUsed: false } as any }]);
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
        width={420}
        className="global-ai-drawer"
      >
        <div className="global-ai-panel">
          <Text type="secondary" className="global-ai-hint">{t('ai.readOnlyHint')}</Text>
          <div className="global-ai-messages">
            {messages.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('ai.empty')} />
            ) : messages.map((item, index) => (
              <div key={index} className={`global-ai-message ${item.role}`}>
                <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 6 }}>{item.content}</Paragraph>
                {item.meta && (
                  <Space size={6} wrap>
                    <Tag>{item.meta.provider || 'openrouter'}</Tag>
                    <Tag color={item.meta.status === 'ok' ? 'green' : item.meta.status === 'failed' ? 'red' : 'default'}>
                      {item.meta.status}
                    </Tag>
                    {item.meta.model && <Tag>{item.meta.model}</Tag>}
                  </Space>
                )}
              </div>
            ))}
            {loading && <div className="global-ai-message assistant"><Spin size="small" /> {t('ai.thinking')}</div>}
          </div>
          <Input.TextArea
            value={question}
            rows={4}
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
