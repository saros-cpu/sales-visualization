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
});
