import type { ReactNode } from 'react';
import { Card, Col, Row, Statistic, Tag, Tooltip, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Text } = Typography;

export type KpiGoodWhen = 'up' | 'down' | 'neutral';
export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface KpiCardProps {
  title: string;
  value: number | string | null | undefined;
  precision?: number;
  prefix?: ReactNode;
  suffix?: string;
  delta?: number;
  deltaLabel?: string;
  goodWhen?: KpiGoodWhen;
  tone?: KpiTone;
  loading?: boolean;
  tooltip?: ReactNode;
  extra?: ReactNode;
  statusText?: string;
  onClick?: () => void;
}

export interface KpiGridItem extends KpiCardProps {
  key: string;
  span?: number;
}

interface KpiGridProps {
  items?: KpiGridItem[];
  children?: ReactNode;
  gutter?: [number, number];
  defaultSpan?: number;
}

const toneColor: Record<KpiTone, string | undefined> = {
  neutral: undefined,
  success: '#389e0d',
  warning: '#d48806',
  danger: '#cf1322',
  info: '#1677ff',
};

function deltaColor(delta: number, goodWhen: KpiGoodWhen) {
  if (goodWhen === 'neutral' || delta === 0) return '#5f6368';
  const isGood = goodWhen === 'up' ? delta > 0 : delta < 0;
  return isGood ? '#389e0d' : '#cf1322';
}

export function MetricDelta({ value, label, goodWhen = 'up' }: { value?: number; label?: string; goodWhen?: KpiGoodWhen }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const color = deltaColor(value, goodWhen);
  return (
    <span className="kpi-delta" style={{ color }}>
      {value >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(value)}%
      {label && <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{label}</Text>}
    </span>
  );
}

export function KpiGrid({ items, children, gutter = [16, 16], defaultSpan = 6 }: KpiGridProps) {
  if (items) {
    return (
      <Row gutter={gutter} className="kpi-grid">
        {items.map(({ key, span, ...item }) => (
          <Col key={key} xs={24} sm={12} md={span && span >= 12 ? 12 : 8} xl={span ?? defaultSpan}>
            <KpiCard {...item} />
          </Col>
        ))}
      </Row>
    );
  }
  return <Row gutter={gutter} className="kpi-grid">{children}</Row>;
}

export default function KpiCard({
  title,
  value,
  precision,
  prefix,
  suffix,
  delta,
  deltaLabel,
  goodWhen = 'up',
  tone = 'neutral',
  loading = false,
  tooltip,
  extra,
  statusText,
  onClick,
}: KpiCardProps) {
  const valueColor = delta === undefined ? toneColor[tone] : deltaColor(delta, goodWhen);
  const displayValue = value === null || value === undefined || value === '' ? '-' : value;
  const titleNode = tooltip ? <Tooltip title={tooltip}><span>{title}</span></Tooltip> : title;
  return (
    <Card
      size="small"
      className={`kpi-card${onClick ? ' kpi-card-clickable' : ''}`}
      loading={loading}
      onClick={onClick}
    >
      <Statistic
        title={titleNode}
        value={displayValue}
        precision={precision}
        prefix={prefix}
        suffix={suffix}
        valueStyle={{ color: valueColor }}
      />
      <div className="kpi-card-footer">
        <MetricDelta value={delta} label={deltaLabel} goodWhen={goodWhen} />
        {statusText && <Tag color={tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : tone === 'success' ? 'green' : 'default'}>{statusText}</Tag>}
        {extra}
      </div>
    </Card>
  );
}
