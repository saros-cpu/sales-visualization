import { useState, type ReactNode } from 'react';
import { Alert, Row, Col, Space, Button, Card } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import { downloadWholesaleReport } from '@/api/export';
import PeriodPicker from '@/components/ui/PeriodPicker';
import KpiCard from '@/components/ui/KpiCard';
import type { OperationMode, TransportMode, WholesaleClass, WholesalePageData } from '@/types/api';
import { useAuth } from '@/contexts/AuthContext';

const ORDER: WholesaleClass[] = ['export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'procurement', 'processing'];
const OPERATION_TRANSPORT_ORDER: { operation: OperationMode; transport: TransportMode; tone: 'neutral' | 'info' | 'warning' | 'success' }[] = [
  { operation: 'loading', transport: 'truck', tone: 'neutral' },
  { operation: 'loading', transport: 'train', tone: 'info' },
  { operation: 'unloading', transport: 'truck', tone: 'success' },
  { operation: 'unloading', transport: 'train', tone: 'warning' },
];
const CARD_ROUTES: Record<WholesaleClass, string> = {
  export_wholesale: '/wholesale/customers',
  local_wholesale: '/wholesale/customers',
  unknown: '/wholesale/query',
  transfer: '/wholesale/transfer',
  procurement: '/wholesale/products',
  processing: '/wholesale/products',
};

type SummaryCompareItem = {
  value?: number | null;
  label?: string;
  goodWhen?: 'up' | 'down' | 'neutral';
};

function compareColor(value: number, goodWhen: 'up' | 'down' | 'neutral') {
  if (goodWhen === 'neutral' || value === 0) return '#5f6368';
  const isGood = goodWhen === 'up' ? value > 0 : value < 0;
  return isGood ? '#389e0d' : '#cf1322';
}

function WholesaleSummaryCard({
  title,
  value,
  compare,
  goodWhen,
  extra,
  onClick,
}: {
  title: string;
  value: string;
  compare: SummaryCompareItem[];
  goodWhen: 'up' | 'down';
  extra: ReactNode;
  onClick: () => void;
}) {
  return (
    <Card size="small" className="wholesale-summary-card kpi-card-clickable" onClick={onClick}>
      <div className="wholesale-summary-card-left">
        <div className="wholesale-summary-card-title">{title}</div>
        <div className="wholesale-summary-card-value">{value}</div>
        <div className="wholesale-summary-card-extra">{extra}</div>
      </div>
      <div className="wholesale-summary-card-right">
        {compare.map((item, index) => {
          if (item.value === undefined || item.value === null || !Number.isFinite(item.value)) return null;
          const delta = item.value;
          const color = compareColor(delta, item.goodWhen || goodWhen);
          return (
            <div className="wholesale-summary-card-compare" key={`${item.label || 'compare'}-${index}`}>
              <span className="wholesale-summary-card-compare-label">{item.label}</span>
              <span className="wholesale-summary-card-compare-value" style={{ color }}>
                <span className="wholesale-summary-card-compare-main">
                  <span className="wholesale-summary-card-compare-arrow">
                    {delta > 0 ? <ArrowUpOutlined /> : delta < 0 ? <ArrowDownOutlined /> : null}
                  </span>
                  <span className="wholesale-summary-card-compare-number">{Math.abs(delta)}</span>
                </span>
                <span className="wholesale-summary-card-compare-percent">%</span>
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function SourcePolicyAlert({ data }: { data?: WholesalePageData }) {
  const policy = data?.sourcePolicy;
  if (!policy) return null;
  const business = data?.dataCompleteness?.businessDetail || {};
  const rows = Number(business.businessPolicyRows || 0);
  const tons = Number(business.businessPolicyTons || 0);
  const warnings = data?.dataQualityWarnings || [];
  const cutoff = policy.cutoff || '2026-06-01';
  const message = `${cutoff} 前称重生成，${cutoff} 起上传/手工录入`;
  const description = rows || tons
    ? `当前期间按统一口径命中 ${rows.toLocaleString()} 条、${tons.toLocaleString()} t。`
    : '当前期间暂未命中批发业务明细。';
  return (
    <Alert
      type={warnings.length ? 'warning' : 'info'}
      showIcon
      message={message}
      description={warnings.length ? `${description} ${warnings[0]}` : description}
      style={{ marginBottom: 16 }}
    />
  );
}

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
      <SourcePolicyAlert data={data} />
      <Row gutter={[16, 16]} className="wholesale-transport-kpi-row" style={{ marginBottom: 16 }}>
        {data && OPERATION_TRANSPORT_ORDER.map(({ operation, transport, tone }) => {
          const card = data.operationTransportSummary?.[operation]?.[transport] || { rows: 0, entities: 0, tons: 0, amountCny: 0 };
          const amountText = card.amountCny ? ` | CNY ${card.amountCny.toLocaleString()}` : '';
          return (
            <Col xs={24} sm={12} xl={6} key={`${operation}-${transport}`} style={{ display: 'flex' }}>
              <KpiCard
                title={t(`wholesale.${operation}_${transport}`)}
                value={`${card.tons.toLocaleString()} t`}
                tone={tone}
                extra={<span>{t('wholesale.entities')}: {card.entities} | {t('common.rows')}: {card.rows}{amountText}</span>}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              />
            </Col>
          );
        })}
      </Row>
      <Row gutter={[16, 16]} className="wholesale-summary-kpi-row" style={{ marginBottom: 16 }}>
        {ORDER.map((key) => {
          const card = data?.cards[key];
          if (!card) return null;
          const amountText = (key === 'export_wholesale' || key === 'local_wholesale')
            ? ` | CNY ${card.amountCny.toLocaleString()}`
            : '';
          return (
            <Col xs={24} sm={12} md={8} xl={8} key={key} style={{ display: 'flex' }}>
              <WholesaleSummaryCard
                title={t(`wholesale.${key}`)}
                value={`${card.tons.toLocaleString()} t`}
                compare={compareFor(key)}
                goodWhen={key === 'unknown' ? 'down' : 'up'}
                extra={<span>{t('wholesale.entities')}: {card.entities} | {t('common.rows')}: {card.rows}{amountText}</span>}
                onClick={() => navigate(CARD_ROUTES[key])}
              />
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
