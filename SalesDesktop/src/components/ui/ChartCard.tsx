import { Card, Spin } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface Props {
  title: string;
  option: EChartsOption;
  loading?: boolean;
  height?: number;
}

export default function ChartCard({ title, option, loading, height = 320 }: Props) {
  return (
    <Card title={title} size="small" style={{ marginBottom: 16, overflow: 'hidden' }}>
      <Spin spinning={!!loading}>
        <ReactECharts option={option} style={{ height, width: '100%' }} notMerge lazyUpdate />
      </Spin>
    </Card>
  );
}
