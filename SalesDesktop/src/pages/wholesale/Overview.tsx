import { useState } from 'react';
import { Row, Col, Space, Card, List, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import PeriodPicker from '@/components/ui/PeriodPicker';
import type { WholesaleClass } from '@/types/api';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'procurement', 'processing'];

const SEVERITY: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };

export default function Overview() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const data = q.data;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {ORDER.map((key) => {
          const card = data?.cards[key];
          if (!card) return null;
          return (
            <Col xs={12} lg={4} key={key}>
              <Card size="small" title={t(`wholesale.${key}`)}>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{card.tons.toLocaleString()} т</div>
                <div style={{ fontSize: 12, color: '#909090' }}>
                  {t('wholesale.entities')}: {card.entities} | {t('common.rows')}: {card.rows}
                </div>
                {(key === 'export_wholesale' || key === 'local_wholesale') && (
                  <div style={{ fontSize: 12, color: '#909090' }}>¥{card.amountCny.toLocaleString()}</div>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>
      {data?.issues && data.issues.length > 0 && (
        <Card size="small" title={t('wholesale.dataIssues')}>
          <List
            size="small"
            dataSource={data.issues}
            renderItem={(issue) => (
              <List.Item>
                <Tag color={SEVERITY[issue.severity] || 'default'}>{issue.type}</Tag>
                {issue.message} <span style={{ color: '#909090', fontSize: 12 }}>{issue.date}</span>
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
}
