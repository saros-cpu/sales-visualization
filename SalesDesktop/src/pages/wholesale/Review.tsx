import { useState } from 'react';
import { Space, Tag, List, Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import PeriodPicker from '@/components/ui/PeriodPicker';

const SEVERITY_COLOR: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };

export default function Review() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const issues = q.data?.issues ?? [];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      <Card size="small" title={t('wholesale.dataIssues')}>
        {issues.length > 0 ? (
          <List
            size="small"
            dataSource={issues}
            renderItem={(issue) => (
              <List.Item>
                <Tag color={SEVERITY_COLOR[issue.severity] || 'default'}>{issue.type}</Tag>
                {issue.message}
                <span style={{ marginLeft: 8, color: '#909090', fontSize: 12 }}>{issue.date}</span>
              </List.Item>
            )}
          />
        ) : (
          <span style={{ color: '#909090' }}>{t('wholesale.noIssues')}</span>
        )}
      </Card>
    </div>
  );
}
