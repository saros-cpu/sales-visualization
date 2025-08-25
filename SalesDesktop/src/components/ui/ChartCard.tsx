import { Card, Spin } from 'antd';
import { useEffect, useMemo, useRef } from 'react';
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
  return formatSeriesValue(value);
}

function formatSeriesValue(value: any) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? '';
  if (Math.abs(numeric) >= 10000) return Math.round(numeric).toLocaleString();
  if (Math.abs(numeric) >= 100) return numeric.toFixed(0);
  if (Math.abs(numeric) >= 10) return numeric.toFixed(1);
  return numeric.toFixed(2);
}

function dataValue(item: any) {
  const value = item && typeof item === 'object' && !Array.isArray(item) && 'value' in item ? item.value : item;
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function isMixedBarLine(series: any[]) {
  return series.some((item) => item?.type === 'bar') && series.some((item) => item?.type === 'line');
}

function horizontalBarMeta(option: EChartsOption) {
  const next: any = option || {};
  const xAxes = asArray<any>(next.xAxis);
  const yAxes = asArray<any>(next.yAxis);
  const rawSeries = asArray<any>(next.series);
  const horizontalSeries = rawSeries.filter((item) => {
    if (!item || item.type !== 'bar') return false;
    const xAxis = xAxes[item.xAxisIndex || 0] || xAxes[0] || {};
    const yAxis = yAxes[item.yAxisIndex || 0] || yAxes[0] || {};
    return yAxis.type === 'category' && xAxis.type !== 'category';
  });
  const categoryLabels = yAxes
    .filter((axis) => axis?.type === 'category' && Array.isArray(axis.data))
    .flatMap((axis) => axis.data.map((item: any) => String(item ?? '')));
  const valueLabels = horizontalSeries.flatMap((series) =>
    (Array.isArray(series.data) ? series.data : []).map((item: any) => String(formatSeriesValue(dataValue(item))))
  );
  return {
    hasHorizontalBar: horizontalSeries.length > 0,
    categoryCount: Math.max(0, ...yAxes.map((axis) => Array.isArray(axis?.data) ? axis.data.length : 0)),
    longestCategory: Math.max(0, ...categoryLabels.map((item) => item.length)),
    longestValue: Math.max(0, ...valueLabels.map((item) => item.length)),
  };
}

function withReadableLabels(option: EChartsOption): EChartsOption {
  const next: any = { ...option };
  const xAxes = asArray<any>(next.xAxis);
  const yAxes = asArray<any>(next.yAxis);
  const xHasCategory = xAxes.some((axis) => axis?.type === 'category');
  const rawSeries = asArray<any>(next.series);
  const mixedBarLine = isMixedBarLine(rawSeries);
  const isHorizontalBarSeries = (item: any) => {
    if (!item || item.type !== 'bar') return false;
    const xAxis = xAxes[item.xAxisIndex || 0] || xAxes[0] || {};
    const yAxis = yAxes[item.yAxisIndex || 0] || yAxes[0] || {};
    return yAxis.type === 'category' && xAxis.type !== 'category';
  };
  const hasHorizontalBar = rawSeries.some(isHorizontalBarSeries);
  const meta = horizontalBarMeta(option);

  const normalizeAxis = (axis: any, isX: boolean) => {
    if (!axis || axis.type !== 'category') return axis;
    const dataLength = Array.isArray(axis.data) ? axis.data.length : 0;
    const longest = Array.isArray(axis.data) ? Math.max(0, ...axis.data.map((item: any) => String(item ?? '').length)) : 0;
    const needRotate = isX && (dataLength > 7 || longest > 5);
    return {
      ...axis,
      axisLabel: {
        ...(axis.axisLabel || {}),
        interval: 0,
        fontSize: 10,
        margin: isX ? 14 : 8,
        ...(isX
          ? { rotate: needRotate ? 35 : 0, hideOverlap: false }
          : { width: hasHorizontalBar ? Math.min(Math.max(78, meta.longestCategory * 5.5), 128) : 130, overflow: 'break' }),
      },
    };
  };

  if (next.xAxis) {
    const normalized = xAxes.map((axis) => {
      const nextAxis = normalizeAxis(axis, true);
      if (!nextAxis || nextAxis.type !== 'category') return nextAxis;
      return {
        ...nextAxis,
        name: mixedBarLine ? undefined : nextAxis.name,
        nameGap: mixedBarLine ? undefined : nextAxis.nameGap,
      };
    });
    next.xAxis = Array.isArray(next.xAxis) ? normalized : normalized[0];
  }
  if (next.yAxis) {
    const normalized = yAxes.map((axis) => normalizeAxis(axis, false));
    next.yAxis = Array.isArray(next.yAxis) ? normalized : normalized[0];
  }

  if (xHasCategory || hasHorizontalBar) {
    const existingGrid = Array.isArray(next.grid) ? next.grid[0] : next.grid;
    const existingBottom = Number.parseFloat(existingGrid?.bottom);
    const existingRight = Number.parseFloat(existingGrid?.right);
    const horizontalRight = Math.min(Math.max(38, meta.longestValue * 6 + 20), 96);
    next.grid = {
      ...(existingGrid || {}),
      containLabel: true,
      bottom: xHasCategory ? (Number.isFinite(existingBottom) ? Math.max(existingBottom, 68) : 68) : (existingGrid?.bottom ?? 32),
      left: hasHorizontalBar ? 8 : (mixedBarLine ? 56 : (existingGrid?.left ?? 48)),
      right: hasHorizontalBar
        ? (Number.isFinite(existingRight) ? Math.max(existingRight, horizontalRight) : horizontalRight)
        : (mixedBarLine ? 56 : (existingGrid?.right ?? 48)),
    };
  } else if (next.grid && !Array.isArray(next.grid)) {
    const existingGrid = next.grid as any;
    next.grid = { ...existingGrid, containLabel: true, left: existingGrid.left ?? 48, right: existingGrid.right ?? 48 };
  }

  const series = rawSeries.map((item) => {
    if (!item || !item.type) return item;
    const isHorizontalBar = isHorizontalBarSeries(item);
    if (item.type === 'bar') {
      return {
        ...item,
        label: {
          ...(item.label || {}),
          show: true,
          position: isHorizontalBar ? 'insideRight' : (mixedBarLine ? 'insideTop' : 'top'),
          formatter: seriesValue,
          fontSize: 10,
          color: isHorizontalBar ? '#111827' : (mixedBarLine ? '#fff' : undefined),
          textBorderWidth: isHorizontalBar ? 0 : undefined,
          textShadowBlur: isHorizontalBar ? 0 : undefined,
        },
        labelLayout: isHorizontalBar
          ? (params: any) => {
              const rect = params?.rect;
              const labelRect = params?.labelRect;
              if (rect && labelRect && rect.width < labelRect.width + 10) {
                return {
                  x: rect.x + rect.width + 6,
                  align: 'left',
                  verticalAlign: 'middle',
                  hideOverlap: false,
                };
              }
              return { hideOverlap: false };
            }
          : undefined,
      };
    }
    if (item.type === 'line') {
      return {
        ...item,
        label: {
          ...(item.label || {}),
          show: true,
          position: 'top',
          formatter: seriesValue,
          fontSize: 10,
        },
      };
    }
    if (item.type === 'pie') {
      return {
        ...item,
        label: {
          ...(item.label || {}),
          show: true,
          position: 'inside',
          formatter: '{b}\n{d}%',
          fontSize: 11,
          lineHeight: 14,
        },
      };
    }
    return item;
  });
  next.series = Array.isArray(next.series) ? series : series[0];
  return next;
}

function adaptiveChartHeight(option: EChartsOption, baseHeight: number) {
  const meta = horizontalBarMeta(option);
  if (!meta.hasHorizontalBar) return baseHeight;
  const target = 112 + meta.categoryCount * 30;
  return Math.min(Math.max(baseHeight, target), 620);
}

export default function ChartCard({ title, option, loading, height = 320, className }: Props) {
  const chartRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const readableOption = useMemo(() => withReadableLabels(option), [option]);
  const chartHeight = useMemo(() => adaptiveChartHeight(option, height), [option, height]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const resize = () => chartRef.current?.getEchartsInstance?.()?.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [readableOption, chartHeight]);

  return (
    <Card title={title} size="small" className={['chart-card', className].filter(Boolean).join(' ')}>
      <Spin spinning={!!loading} wrapperClassName="chart-spin">
        <div ref={wrapRef} className="chart-resize-wrap">
          <ReactECharts ref={chartRef} option={readableOption} style={{ height: chartHeight, width: '100%' }} notMerge lazyUpdate />
        </div>
      </Spin>
    </Card>
  );
}
