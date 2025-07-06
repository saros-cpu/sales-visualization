import { useState } from 'react';
import { Row, Col, Space, Card, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import BarList from '@/components/wholesale/BarList';
import PeriodPicker from '@/components/ui/PeriodPicker';
import type { WholesaleClass } from '@/types/api';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'procurement', 'processing'];
const SHOW_AMOUNT: Partial<Record<WholesaleClass, boolean>> = { export_wholesale: true, local_wholesale: true };

export default function Products() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      {q.data && ORDER.every(k => !q.data?.productRankings?.[k]?.length) && (
        <Alert type="info" message={t('common.noData')} showIcon style={{ marginBottom: 16 }} />
      )}
      <Row gutter={16}>
        {ORDER.map((key) => {
          const items = q.data?.productRankings[key];
          if (!items || items.length === 0) return null;
          return (
            <Col xs={24} lg={12} key={key}>
              <Card size="small" title={t(`wholesale.${key}`)} style={{ marginBottom: 16 }}>
                <BarList rows={items} showAmount={SHOW_AMOUNT[key]} />
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
