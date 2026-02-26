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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

type LayoutRect = { x: number; y: number; width: number; height: number };
type BarBounds = { left: number; right: number; top: number; bottom: number };

function toBarBounds(rect: LayoutRect): BarBounds {
  const left = Math.min(rect.x, rect.x + rect.width);
  const right = Math.max(rect.x, rect.x + rect.width);
  const top = Math.min(rect.y, rect.y + rect.height);
  const bottom = Math.max(rect.y, rect.y + rect.height);
  return { left, right, top, bottom };
}

function mergeBarBounds(current: BarBounds | undefined, rect: LayoutRect): BarBounds {
  const next = toBarBounds(rect);
  if (!current) return next;
  return {
    left: Math.min(current.left, next.left),
    right: Math.max(current.right, next.right),
    top: Math.min(current.top, next.top),
    bottom: Math.max(current.bottom, next.bottom),
  };
}

function rectsOverlapX(labelRect: LayoutRect, bounds: BarBounds) {
  const labelLeft = Math.min(labelRect.x, labelRect.x + labelRect.width);
  const labelRight = Math.max(labelRect.x, labelRect.x + labelRect.width);
  return labelRight >= bounds.left - 4 && labelLeft <= bounds.right + 4;
}

function categoryCount(option: any) {
  return Math.max(0, ...asArray<any>(option?.xAxis).map((axis) => (axis?.type === 'category' && Array.isArray(axis.data) ? axis.data.length : 0)));
}

function denseLineLabelIndexes(data: any[], count: number) {
  const indexes = new Set<number>();
  if (count <= 0) return indexes;

  indexes.add(0);
  indexes.add(count - 1);

  const targetLabels = count >= 25 ? 8 : 10;
  const step = Math.max(2, Math.ceil(count / targetLabels));
  for (let index = 0; index < count; index += step) {
    indexes.add(index);
  }

  let minIndex = -1;
  let maxIndex = -1;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  data.slice(0, count).forEach((item, index) => {
    const value = Number(dataValue(item));
    if (!Number.isFinite(value)) return;
    if (value < minValue) {
      minValue = value;
      minIndex = index;
    }
    if (value > maxValue) {
      maxValue = value;
      maxIndex = index;
    }
  });
  if (minIndex >= 0) indexes.add(minIndex);
  if (maxIndex >= 0) indexes.add(maxIndex);

  return indexes;
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

function preservePaletteColor(item: any, palette: any[], originalIndex: number) {
  const color = palette[originalIndex];
  if (!color || item?.itemStyle?.color || item?.lineStyle?.color) return item;
  if (item.type === 'line') {
    return {
      ...item,
      itemStyle: { ...(item.itemStyle || {}), color },
      lineStyle: { ...(item.lineStyle || {}), color },
    };
  }
  if (item.type === 'bar') {
    return {
      ...item,
      itemStyle: { ...(item.itemStyle || {}), color },
    };
  }
  return item;
}

export function withReadableLabels(option: EChartsOption): EChartsOption {
  const next: any = { ...option };
  const xAxes = asArray<any>(next.xAxis);
  const yAxes = asArray<any>(next.yAxis);
  const xHasCategory = xAxes.some((axis) => axis?.type === 'category');
  const rawSeries = asArray<any>(next.series);
  const palette = Array.isArray(next.color) ? next.color : [];
  const xCategoryCount = categoryCount(next);
  const mixedBarLine = isMixedBarLine(rawSeries);
  const isHorizontalBarSeries = (item: any) => {
    if (!item || item.type !== 'bar') return false;
    const xAxis = xAxes[item.xAxisIndex || 0] || xAxes[0] || {};
    const yAxis = yAxes[item.yAxisIndex || 0] || yAxes[0] || {};
    return yAxis.type === 'category' && xAxis.type !== 'category';
  };
  const isVerticalBarSeries = (item: any) => item?.type === 'bar' && !isHorizontalBarSeries(item);
  const hasHorizontalBar = rawSeries.some(isHorizontalBarSeries);
  const mixedVerticalBarLine = mixedBarLine && xHasCategory && rawSeries.some(isVerticalBarSeries);
  const denseMixedVerticalBarLine = mixedVerticalBarLine && xCategoryCount > 12;
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
      outerBoundsMode: 'same' as const,
      outerBoundsContain: 'axisLabel' as const,
      top: mixedBarLine
        ? Math.max(Number.parseFloat(existingGrid?.top) || 0, mixedVerticalBarLine ? (denseMixedVerticalBarLine ? 112 : 104) : 88)
        : existingGrid?.top,
      bottom: xHasCategory ? (Number.isFinite(existingBottom) ? Math.max(existingBottom, 68) : 68) : (existingGrid?.bottom ?? 32),
      left: hasHorizontalBar ? 8 : (mixedBarLine ? 56 : (existingGrid?.left ?? 48)),
      right: hasHorizontalBar
        ? (Number.isFinite(existingRight) ? Math.max(existingRight, horizontalRight) : horizontalRight)
        : (mixedBarLine ? 56 : (existingGrid?.right ?? 48)),
    };
  } else if (next.grid && !Array.isArray(next.grid)) {
    const existingGrid = next.grid as any;
    next.grid = {
      ...existingGrid,
      outerBoundsMode: 'same' as const,
      outerBoundsContain: 'axisLabel' as const,
      left: existingGrid.left ?? 48,
      right: existingGrid.right ?? 48,
    };
  }

  const originalIndexByName = new Map<string, number>();
  rawSeries.forEach((item, index) => {
    if (item?.name != null && !originalIndexByName.has(String(item.name))) {
      originalIndexByName.set(String(item.name), index);
    }
  });

  const indexedSeries = rawSeries.map((item, originalIndex) => ({ item, originalIndex }));
  const layoutSeries = mixedVerticalBarLine
    ? [
        ...indexedSeries.filter(({ item }) => isVerticalBarSeries(item)),
        ...indexedSeries.filter(({ item }) => !isVerticalBarSeries(item)),
      ]
    : indexedSeries;
  const verticalBarBoundsByDataIndex: Record<number, BarBounds> = {};

  if (mixedVerticalBarLine) {
    const tooltip = next.tooltip;
    if (tooltip && !Array.isArray(tooltip) && typeof tooltip.formatter === 'function') {
      const formatter = tooltip.formatter;
      next.tooltip = {
        ...tooltip,
        formatter: (params: any, ...rest: any[]) => {
          const orderedParams = Array.isArray(params)
            ? [...params].sort((a, b) => {
                const aIndex = originalIndexByName.get(String(a?.seriesName ?? '')) ?? Number.MAX_SAFE_INTEGER;
                const bIndex = originalIndexByName.get(String(b?.seriesName ?? '')) ?? Number.MAX_SAFE_INTEGER;
                return aIndex - bIndex;
              })
            : params;
          return formatter(orderedParams, ...rest);
        },
      };
    }
  }

  const series = layoutSeries.map(({ item, originalIndex }, seriesIndex) => {
    if (!item || !item.type) return item;
    const isHorizontalBar = isHorizontalBarSeries(item);
    const lineSeriesIndex = layoutSeries.slice(0, seriesIndex).filter((entry) => entry.item?.type === 'line').length;
    const itemWithPalette = mixedVerticalBarLine ? preservePaletteColor(item, palette, originalIndex) : item;
    const lineLabelIndexes = denseMixedVerticalBarLine && item.type === 'line'
      ? denseLineLabelIndexes(Array.isArray(item.data) ? item.data : [], xCategoryCount)
      : undefined;
    if (item.type === 'bar') {
      return {
        ...itemWithPalette,
        label: {
          ...(item.label || {}),
          show: true,
          position: isHorizontalBar ? 'insideRight' : 'inside',
          distance: isHorizontalBar ? undefined : 0,
          verticalAlign: isHorizontalBar ? undefined : 'middle',
          formatter: seriesValue,
          fontSize: denseMixedVerticalBarLine && !isHorizontalBar ? 9 : 10,
          color: isHorizontalBar ? '#111827' : '#fff',
          textBorderColor: isHorizontalBar ? undefined : 'rgba(15, 23, 42, 0.32)',
          textBorderWidth: isHorizontalBar ? 0 : 2,
          textShadowBlur: 0,
          rotate: denseMixedVerticalBarLine && !isHorizontalBar ? 90 : undefined,
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
          : mixedVerticalBarLine
            ? (params: any) => {
                const rect = params?.rect;
                const dataIndex = params?.dataIndex;
                if (rect && isFiniteNumber(dataIndex)) {
                  verticalBarBoundsByDataIndex[dataIndex] = mergeBarBounds(verticalBarBoundsByDataIndex[dataIndex], rect);
                }
                return { hideOverlap: false };
              }
            : undefined,
      };
    }
    if (item.type === 'line') {
      return {
        ...itemWithPalette,
        label: {
          ...(item.label || {}),
          show: true,
          position: 'top',
          distance: mixedBarLine ? 14 : 6,
          formatter: (params: any) => {
            if (lineLabelIndexes && !lineLabelIndexes.has(params?.dataIndex)) return '';
            return seriesValue(params);
          },
          fontSize: 10,
          color: '#111827',
          textBorderColor: '#fff',
          textBorderWidth: mixedBarLine ? 2 : 0,
          backgroundColor: mixedBarLine ? 'rgba(255, 255, 255, 0.9)' : undefined,
          borderRadius: mixedBarLine ? 3 : undefined,
          padding: mixedBarLine ? [1, 3] : undefined,
        },
        labelLayout: mixedBarLine
          ? (params: any) => {
              const labelRect = params?.labelRect;
              if (!labelRect) return { hideOverlap: false };
              const bounds = isFiniteNumber(params?.dataIndex) ? verticalBarBoundsByDataIndex[params.dataIndex] : undefined;
              const shouldAvoidBar = bounds && rectsOverlapX(labelRect, bounds) && labelRect.y + labelRect.height > bounds.top - 6;
              if (shouldAvoidBar) {
                const stackStep = Math.max(labelRect.height + 4, 15);
                return {
                  y: Math.max(2, bounds.top - 8 - labelRect.height - lineSeriesIndex * stackStep),
                  verticalAlign: 'top',
                  hideOverlap: denseMixedVerticalBarLine,
                };
              }
              return {
                y: Math.max(2, labelRect.y - 8 - lineSeriesIndex * 6),
                hideOverlap: denseMixedVerticalBarLine,
                moveOverlap: denseMixedVerticalBarLine ? undefined : 'shiftY',
              };
            }
          : undefined,
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
