import { useState } from 'react';
import { Row, Col, Space, Button } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import { downloadWholesaleReport } from '@/api/export';
import PeriodPicker from '@/components/ui/PeriodPicker';
import KpiCard from '@/components/ui/KpiCard';
import type { WholesaleClass } from '@/types/api';
import { useAuth } from '@/contexts/AuthContext';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'procurement', 'processing'];
const CARD_ROUTES: Record<WholesaleClass, string> = {
  export_wholesale: '/wholesale/customers',
  local_wholesale: '/wholesale/customers',
  unknown: '/wholesale/query',
  transfer: '/wholesale/transfer',
  procurement: '/wholesale/products',
  processing: '/wholesale/products',
};

export default function Overview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canExport = can('wholesale:export');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const data = q.data;
  const compareFor = (key: WholesaleClass) => {
    const compare = data?.comparison?.[key] || {};
    return [
      { value: compare.momTons, label: t('common.mom'), goodWhen: key === 'unknown' ? 'down' as const : 'up' as const },
      { value: compare.yoyTons, label: t('common.yoy'), goodWhen: key === 'unknown' ? 'down' as const : 'up' as const },
    ];
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker
          value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }}
          picker="month"
        />
        {canExport && (
          <Button icon={<FileTextOutlined />} onClick={() => downloadWholesaleReport({ year, month })}>
            {t('wholesale.generateReport')}
          </Button>
        )}
      </Space>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {ORDER.map((key) => {
          const card = data?.cards[key];
          if (!card) return null;
          const amountText = (key === 'export_wholesale' || key === 'local_wholesale')
            ? ` | CNY ${card.amountCny.toLocaleString()}`
            : '';
          return (
            <Col xs={24} sm={12} md={8} xl={4} key={key} style={{ display: 'flex' }}>
              <KpiCard
                title={t(`wholesale.${key}`)}
                value={`${card.tons.toLocaleString()} t`}
                compare={compareFor(key)}
                goodWhen={key === 'unknown' ? 'down' : 'up'}
                extra={<span>{t('wholesale.entities')}: {card.entities} | {t('common.rows')}: {card.rows}{amountText}</span>}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                onClick={() => navigate(CARD_ROUTES[key])}
              />
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
