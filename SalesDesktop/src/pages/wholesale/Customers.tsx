import { useState } from 'react';
import { Row, Col, Space, Card, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import RankList from '@/components/wholesale/RankList';
import PeriodPicker from '@/components/ui/PeriodPicker';
import type { WholesaleClass } from '@/types/api';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown'];
const MODE: Partial<Record<WholesaleClass, 'customer' | 'pending'>> = {
  export_wholesale: 'customer', local_wholesale: 'customer',
  unknown: 'pending',
};

export default function Customers() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const visibleKeys = ORDER.filter((key) => (q.data?.customerRankings?.[key]?.length ?? 0) > 0);
  const salesCardCount = visibleKeys.filter((key) => key !== 'unknown').length;

  const cardSpan = (key: WholesaleClass) => {
    if (key === 'unknown') return 24;
    if (salesCardCount >= 2) return key === 'local_wholesale' ? 14 : 10;
    return 24;
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      {q.data && ORDER.every(k => !q.data?.customerRankings?.[k]?.length) && (
        <Alert type="info" message={t('common.noData')} showIcon style={{ marginBottom: 16 }} />
      )}
      <Row gutter={[16, 16]}>
        {visibleKeys.map((key) => {
          const items = q.data?.customerRankings[key] ?? [];
          const content = <RankList rows={items} mode={MODE[key] ?? 'customer'} />;
          return (
            <Col xs={24} lg={cardSpan(key)} key={key}>
              <Card
                size="small"
                title={t(`wholesale.${key}`)}
                className={`${key === 'local_wholesale' ? 'no-scroll-card' : 'scroll-card'} customer-rank-card`}
                style={{ marginBottom: 16 }}
              >
                {content}
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
