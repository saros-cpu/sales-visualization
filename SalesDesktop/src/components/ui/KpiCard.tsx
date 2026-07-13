import type { CSSProperties, ReactNode } from 'react';
import { Card, Col, Row, Statistic, Tag, Tooltip, Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

const { Text } = Typography;

export type KpiGoodWhen = 'up' | 'down' | 'neutral';
export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface KpiCompareItem {
  value?: number | null;
  label?: string;
  goodWhen?: KpiGoodWhen;
}

export interface KpiCardProps {
  title: string;
  value: number | string | null | undefined;
  precision?: number;
  prefix?: ReactNode;
  suffix?: string;
  delta?: number;
  deltaLabel?: string;
  compare?: KpiCompareItem[];
  compareLayout?: 'compact' | 'side';
  goodWhen?: KpiGoodWhen;
  tone?: KpiTone;
  loading?: boolean;
  tooltip?: ReactNode;
  extra?: ReactNode;
  statusText?: string;
  style?: CSSProperties;
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

export function MetricDelta({ value, label, goodWhen = 'up' }: { value?: number | null; label?: string; goodWhen?: KpiGoodWhen }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const color = deltaColor(value, goodWhen);
  return (
    <span className="kpi-delta" style={{ color }}>
      {value > 0 ? <ArrowUpOutlined /> : value < 0 ? <ArrowDownOutlined /> : null} {Math.abs(value)}%
      {label && <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>{label}</Text>}
    </span>
  );
}

function KpiCompareMetric({ value, label, goodWhen = 'up' }: { value?: number | null; label?: string; goodWhen?: KpiGoodWhen }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const color = deltaColor(value, goodWhen);
  const toneClass = value > 0 ? 'up' : value < 0 ? 'down' : 'neutral';
  return (
    <span className={`kpi-card-compare-item ${toneClass}`}>
      <span className="kpi-card-compare-label">{label}</span>
      <span className="kpi-card-compare-value" style={{ color }}>
        {value > 0 ? <ArrowUpOutlined /> : value < 0 ? <ArrowDownOutlined /> : null}
        {Math.abs(value)}%
      </span>
    </span>
  );
}

function KpiCompactCompareMetric({ value, label, goodWhen = 'up' }: { value?: number | null; label?: string; goodWhen?: KpiGoodWhen }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const color = deltaColor(value, goodWhen);
  const toneClass = value > 0 ? 'up' : value < 0 ? 'down' : 'neutral';
  return (
    <span className={`kpi-card-compact-compare-item ${toneClass}`}>
      <span className="kpi-card-compact-compare-label">{label}</span>
      <span className="kpi-card-compact-compare-value" style={{ color }}>
        {value > 0 ? <ArrowUpOutlined /> : value < 0 ? <ArrowDownOutlined /> : null}
        {Math.abs(value)}%
      </span>
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
  compare,
  compareLayout = 'compact',
  goodWhen = 'up',
  tone = 'neutral',
  loading = false,
  tooltip,
  extra,
  statusText,
  style,
  onClick,
}: KpiCardProps) {
  const valueColor = delta === undefined ? toneColor[tone] : deltaColor(delta, goodWhen);
  const displayValue = value === null || value === undefined || value === '' ? '-' : value;
  const titleNode = tooltip ? <Tooltip title={tooltip}><span>{title}</span></Tooltip> : title;
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const compareItems = (compare || []).filter((item) => item.value !== undefined && item.value !== null && Number.isFinite(item.value));
  const hasCompare = compareItems.length > 0;
  const hasFooter = hasDelta || hasCompare || !!statusText || !!extra;
  const sideCompare = hasCompare && compareLayout === 'side';
  const compactCompare = hasCompare && compareLayout === 'compact';
  const cardClass = [
    'kpi-card',
    onClick ? 'kpi-card-clickable' : '',
    hasFooter ? 'kpi-card-has-footer' : 'kpi-card-no-footer',
    sideCompare ? 'kpi-card-has-compare' : '',
    hasCompare && !sideCompare ? 'kpi-card-has-compact-compare' : '',
  ].filter(Boolean).join(' ');
  return (
    <Card
      size="small"
      className={cardClass}
      loading={loading}
      style={style}
      onClick={onClick}
    >
      {sideCompare ? (
        <>
          <div className="kpi-card-data">
            <Statistic
              title={titleNode}
              value={displayValue}
              precision={precision}
              prefix={prefix}
              suffix={suffix}
              valueStyle={{ color: valueColor }}
            />
            {extra && <div className="kpi-card-extra">{extra}</div>}
          </div>
          <div className="kpi-card-compare-panel">
            <span className="kpi-card-compare-group">
              {compareItems.map((item, index) => (
                <KpiCompareMetric
                  key={`${item.label || 'compare'}-${index}`}
                  value={item.value}
                  label={item.label}
                  goodWhen={item.goodWhen || goodWhen}
                />
              ))}
            </span>
          </div>
          {(hasDelta || statusText) && (
            <div className="kpi-card-footer">
              <MetricDelta value={delta} label={deltaLabel} goodWhen={goodWhen} />
              {statusText && <Tag color={tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : tone === 'success' ? 'green' : 'default'}>{statusText}</Tag>}
            </div>
          )}
        </>
      ) : compactCompare ? (
        <>
          <div className="kpi-card-compact-body">
            <div className="kpi-card-compact-main">
              <Statistic
                title={titleNode}
                value={displayValue}
                precision={precision}
                prefix={prefix}
                suffix={suffix}
                valueStyle={{ color: valueColor }}
              />
            </div>
            <div className="kpi-card-compact-compare-panel">
              <span className="kpi-card-compact-compare-group">
                {compareItems.map((item, index) => (
                  <KpiCompactCompareMetric
                    key={`${item.label || 'compare'}-${index}`}
                    value={item.value}
                    label={item.label}
                    goodWhen={item.goodWhen || goodWhen}
                  />
                ))}
              </span>
            </div>
          </div>
          {(hasDelta || statusText || !!extra) && (
            <div className="kpi-card-footer">
              <MetricDelta value={delta} label={deltaLabel} goodWhen={goodWhen} />
              {statusText && <Tag color={tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : tone === 'success' ? 'green' : 'default'}>{statusText}</Tag>}
              {extra}
            </div>
          )}
        </>
      ) : (
        <Statistic
          title={titleNode}
          value={displayValue}
          precision={precision}
          prefix={prefix}
          suffix={suffix}
          valueStyle={{ color: valueColor }}
        />
      )}
      {hasFooter && !sideCompare && !compactCompare && (
        <div className="kpi-card-footer">
          <MetricDelta value={delta} label={deltaLabel} goodWhen={goodWhen} />
          {hasCompare && (
            <span className="kpi-card-compare-group">
              {compareItems.map((item, index) => (
                <MetricDelta
                  key={`${item.label || 'compare'}-${index}`}
                  value={item.value}
                  label={item.label}
                  goodWhen={item.goodWhen || goodWhen}
                />
              ))}
            </span>
          )}
          {statusText && <Tag color={tone === 'danger' ? 'red' : tone === 'warning' ? 'orange' : tone === 'success' ? 'green' : 'default'}>{statusText}</Tag>}
          {extra}
        </div>
      )}
    </Card>
  );
}
