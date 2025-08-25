import { useState } from 'react';
import { Row, Col, Space, Card, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import BarList from '@/components/wholesale/BarList';
import PeriodPicker from '@/components/ui/PeriodPicker';
import type { WholesaleClass } from '@/types/api';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'procurement', 'processing'];
const STACK_ORDER: WholesaleClass[] = ['export_wholesale', 'transfer', 'procurement', 'processing', 'unknown'];
const SHOW_AMOUNT: Partial<Record<WholesaleClass, boolean>> = { export_wholesale: true, local_wholesale: true };

export default function Products() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const leftKeys = STACK_ORDER.filter((key) => (q.data?.productRankings?.[key]?.length ?? 0) > 0);
  const localItems = q.data?.productRankings?.local_wholesale ?? [];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      {q.data && ORDER.every(k => !q.data?.productRankings?.[k]?.length) && (
        <Alert type="info" message={t('common.noData')} showIcon style={{ marginBottom: 16 }} />
      )}
      <Row gutter={[12, 12]} className="wholesale-product-grid">
        {leftKeys.length > 0 && (
          <Col xs={24} lg={localItems.length ? 10 : 24}>
            <div className="product-stack-column">
              {leftKeys.map((key) => {
                const items = q.data?.productRankings[key] ?? [];
                return (
                  <Card size="small" title={t(`wholesale.${key}`)} className="scroll-card product-stat-card product-stack-card" key={key}>
                    <BarList rows={items} showAmount={SHOW_AMOUNT[key]} />
                  </Card>
                );
              })}
            </div>
          </Col>
        )}
        {localItems.length > 0 && (
          <Col xs={24} lg={leftKeys.length ? 14 : 24}>
            <Card size="small" title={t('wholesale.local_wholesale')} className="product-stat-card product-local-card no-scroll-card">
              <BarList rows={localItems} showAmount />
            </Card>
          </Col>
        )}
      </Row>
    </div>
  );
}
