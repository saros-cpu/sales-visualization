import { Card, Statistic } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

interface Props {
  title: string;
  value: number | string;
  precision?: number;
  prefix?: React.ReactNode;
  suffix?: string;
  delta?: number;
}

export default function KpiCard({ title, value, precision, prefix, suffix, delta }: Props) {
  const color = delta === undefined ? undefined : delta >= 0 ? '#3f8600' : '#cf1322';
  return (
    <Card size="small" className="kpi-card">
      <Statistic
        title={title}
        value={value}
        precision={precision}
        prefix={prefix}
        suffix={suffix}
        valueStyle={{ color }}
      />
      {delta !== undefined && (
        <span className="kpi-delta" style={{ color }}>
          {delta >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(delta)}%
        </span>
      )}
    </Card>
  );
}
