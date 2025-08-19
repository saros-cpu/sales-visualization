import { useState } from 'react';
import { Space, Tag, List, Card, Button } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import { downloadWholesaleReport } from '@/api/export';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useAuth } from '@/contexts/AuthContext';

const SEVERITY_COLOR: Record<string, string> = { error: 'red', warning: 'orange', info: 'blue' };

export default function Review() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canExport = can('wholesale:export');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const issues = q.data?.issues ?? [];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
        {canExport && (
          <Button icon={<FileTextOutlined />} onClick={() => downloadWholesaleReport({ year, month })}>
            {t('wholesale.generateReport')}
          </Button>
        )}
      </Space>
      <Card size="small" title={t('wholesale.dataIssues')} className="scroll-card">
        {issues.length > 0 ? (
          <List
            size="small"
            dataSource={issues}
            renderItem={(issue) => (
              <List.Item>
                <Tag color={SEVERITY_COLOR[issue.severity] || 'default'}>{t(`wholesale.${issue.type}`, { defaultValue: issue.type })}</Tag>
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
