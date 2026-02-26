import { describe, expect, it } from 'vitest';
import { withReadableLabels } from './ChartCard';

describe('ChartCard readable label layout', () => {
  it('keeps mixed line labels above bars when the original series has lines before bars', () => {
    const option = {
      color: ['line-color', 'bar-color'],
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => params.map((item) => item.seriesName).join(','),
      },
      xAxis: { type: 'category', data: ['01'] },
      yAxis: [{ type: 'value' }, { type: 'value' }],
      series: [
        { name: 'line', type: 'line', data: [20] },
        { name: 'bar', type: 'bar', yAxisIndex: 1, data: [90] },
      ],
    };

    const readable = withReadableLabels(option as any) as any;

    expect(readable.series.map((item: any) => item.name)).toEqual(['bar', 'line']);
    expect(readable.series[0].itemStyle.color).toBe('bar-color');
    expect(readable.series[1].lineStyle.color).toBe('line-color');
    expect(readable.tooltip.formatter([
      { seriesName: 'bar' },
      { seriesName: 'line' },
    ])).toBe('line,bar');

    readable.series[0].labelLayout({
      dataIndex: 0,
      rect: { x: 100, y: 120, width: 80, height: 180 },
      labelRect: { x: 132, y: 200, width: 16, height: 12 },
    });

    const lineLayout = readable.series[1].labelLayout({
      dataIndex: 0,
      labelRect: { x: 124, y: 150, width: 32, height: 12 },
    });

    expect(lineLayout.verticalAlign).toBe('top');
    expect(lineLayout.y).toBeLessThanOrEqual(100);
    expect(lineLayout.moveOverlap).toBeUndefined();
  });

  it('samples line labels and rotates bar labels on dense monthly mixed charts', () => {
    const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, '0'));
    const lineData = Array.from({ length: 31 }, (_, index) => index + 10);
    const option = {
      color: ['bar-color', 'line-color'],
      xAxis: { type: 'category', data: days },
      yAxis: [{ type: 'value' }, { type: 'value' }],
      series: [
        { name: 'volume', type: 'bar', data: days.map((_, index) => 1000 + index * 20) },
        { name: 'amount', type: 'line', yAxisIndex: 1, data: lineData },
      ],
    };

    const readable = withReadableLabels(option as any) as any;

    expect(readable.grid.top).toBeGreaterThanOrEqual(112);
    expect(readable.series[0].label.rotate).toBe(90);
    expect(readable.series[1].label.formatter({ dataIndex: 0, value: 10 })).toBe('10.0');
    expect(readable.series[1].label.formatter({ dataIndex: 1, value: 11 })).toBe('');
    expect(readable.series[1].label.formatter({ dataIndex: 30, value: 40 })).toBe('40.0');

    readable.series[0].labelLayout({
      dataIndex: 4,
      rect: { x: 100, y: 120, width: 12, height: 180 },
      labelRect: { x: 101, y: 200, width: 12, height: 30 },
    });

    const lineLayout = readable.series[1].labelLayout({
      dataIndex: 4,
      labelRect: { x: 92, y: 150, width: 28, height: 12 },
    });

    expect(lineLayout.hideOverlap).toBe(true);
    expect(lineLayout.moveOverlap).toBeUndefined();
    expect(lineLayout.y).toBeLessThan(120);
  });
});
