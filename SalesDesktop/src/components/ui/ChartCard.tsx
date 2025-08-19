import { Card, Spin } from 'antd';
import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface Props {
  title: string;
  option: EChartsOption;
  loading?: boolean;
  height?: number;
  className?: string;
}

const asArray = <T,>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

function seriesValue(params: any) {
  const value = Array.isArray(params.value) ? params.value[params.value.length - 1] : params.value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? '';
  if (Math.abs(numeric) >= 10000) return Math.round(numeric).toLocaleString();
  if (Math.abs(numeric) >= 100) return numeric.toFixed(0);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1);
  return numeric.toFixed(2);
}

function withReadableLabels(option: EChartsOption): EChartsOption {
  const next: any = { ...option };
  const xAxes = asArray<any>(next.xAxis);
  const yAxes = asArray<any>(next.yAxis);
  const xHasCategory = xAxes.some((axis) => axis?.type === 'category');

  const normalizeAxis = (axis: any, isX: boolean) => {
    if (!axis || axis.type !== 'category') return axis;
    const dataLength = Array.isArray(axis.data) ? axis.data.length : 0;
    const longest = Array.isArray(axis.data) ? Math.max(0, ...axis.data.map((item: any) => String(item ?? '').length)) : 0;
    const needRotate = isX && (dataLength > 7 || longest > 5);
    return {
      ...axis,
      axisLabel: {
        interval: 0,
        fontSize: 10,
        margin: isX ? 14 : 8,
        ...(isX
          ? { rotate: needRotate ? 35 : 0, hideOverlap: false }
          : { width: 130, overflow: 'break' }),
        ...(axis.axisLabel || {}),
      },
    };
  };

  if (next.xAxis) {
    const normalized = xAxes.map((axis) => normalizeAxis(axis, true));
    next.xAxis = Array.isArray(next.xAxis) ? normalized : normalized[0];
  }
  if (next.yAxis) {
    const normalized = yAxes.map((axis) => normalizeAxis(axis, false));
    next.yAxis = Array.isArray(next.yAxis) ? normalized : normalized[0];
  }

  if (xHasCategory) {
    const existingGrid = Array.isArray(next.grid) ? next.grid[0] : next.grid;
    next.grid = {
      containLabel: true,
      bottom: 68,
      ...(existingGrid || {}),
    };
  } else if (next.grid && !Array.isArray(next.grid)) {
    next.grid = { containLabel: true, ...(next.grid as any) };
  }

  const series = asArray<any>(next.series).map((item) => {
    if (!item || !item.type) return item;
    const xAxis = xAxes[item.xAxisIndex || 0] || xAxes[0] || {};
    const yAxis = yAxes[item.yAxisIndex || 0] || yAxes[0] || {};
    const isHorizontalBar = item.type === 'bar' && yAxis.type === 'category' && xAxis.type !== 'category';
    if (item.type === 'bar') {
      return {
        ...item,
        label: {
          show: true,
          position: isHorizontalBar ? 'insideRight' : 'top',
          formatter: seriesValue,
          fontSize: 10,
          color: isHorizontalBar ? '#fff' : undefined,
          ...(item.label || {}),
        },
      };
    }
    if (item.type === 'line') {
      return {
        ...item,
        label: {
          show: true,
          position: 'top',
          formatter: seriesValue,
          fontSize: 10,
          ...(item.label || {}),
        },
      };
    }
    if (item.type === 'pie') {
      return {
        ...item,
        label: {
          show: true,
          position: 'inside',
          formatter: '{b}\n{d}%',
          fontSize: 11,
          lineHeight: 14,
          ...(item.label || {}),
        },
      };
    }
    return item;
  });
  next.series = Array.isArray(next.series) ? series : series[0];
  return next;
}

export default function ChartCard({ title, option, loading, height = 320, className }: Props) {
  const readableOption = useMemo(() => withReadableLabels(option), [option]);
  return (
    <Card title={title} size="small" className={['chart-card', className].filter(Boolean).join(' ')}>
      <Spin spinning={!!loading}>
        <ReactECharts option={readableOption} style={{ height, width: '100%' }} notMerge lazyUpdate />
      </Spin>
    </Card>
  );
}
