// src/pages/sales/wholesale/TrendTab.jsx — 每日批发趋势
import { useEffect } from 'react';
import { yuan, num } from '../../../utils/format';
import { useChart, noDataOption } from '../../../hooks/useChart';

export default function TrendTab({ data }) {
  const { chartRef, initChart } = useChart();
  const rows = data?.dailyTrend || [];

  useEffect(() => {
    const chart = initChart('wholesaleTrendChart');
    if (!chart) return;

    const items = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!items.length) {
      noDataOption(chart, '暂无每日趋势数据');
      return;
    }

    const labels = items.map(i => i.date.slice(5));
    chart.setOption({
      backgroundColor: 'transparent',
      color: ['#00d4ff', '#00e5a0', '#ffa726', '#9c27b0', '#ffcc66', '#a78bfa'],
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(5, 12, 24, 0.92)',
        borderColor: 'rgba(0, 212, 255, 0.28)',
        textStyle: { color: '#e0e8f5' },
      },
      legend: { top: 0, textStyle: { color: 'rgba(224, 232, 245, 0.78)' } },
      grid: { left: 52, right: 72, top: 46, bottom: 34 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: 'rgba(160, 180, 210, 0.28)' } },
        axisLabel: { color: 'rgba(224, 232, 245, 0.68)' },
      },
      yAxis: [
        {
          type: 'value', name: '吨',
          nameTextStyle: { color: 'rgba(224, 232, 245, 0.58)' },
          splitLine: { lineStyle: { color: 'rgba(160, 180, 210, 0.10)' } },
          axisLabel: { color: 'rgba(224, 232, 245, 0.68)' },
        },
        {
          type: 'value', name: '人民币',
          nameTextStyle: { color: 'rgba(224, 232, 245, 0.58)' },
          splitLine: { show: false },
          axisLabel: {
            color: 'rgba(224, 232, 245, 0.68)',
            formatter: v => `${Math.round(v / 10000)}万`,
          },
        },
      ],
      series: [
        { name: '出口批发', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.exportTons || 0), lineStyle: { width: 3 } },
        { name: '本地批发', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.localTons || 0), lineStyle: { width: 3 } },
        { name: '外运', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.transferTons || 0), lineStyle: { width: 3 } },
        { name: '代加工', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.processingTons || 0), lineStyle: { width: 3 } },
        { name: '采购', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.procurementTons || 0), lineStyle: { width: 3 } },
        { name: '待识别', type: 'line', smooth: true, symbolSize: 6, data: items.map(i => i.pendingTons || 0), lineStyle: { width: 3, type: 'dashed' } },
        {
          name: '销售额', type: 'bar', yAxisIndex: 1, barMaxWidth: 18,
          data: items.map(i => i.amountCny || 0),
          itemStyle: { color: 'rgba(167, 139, 250, 0.34)', borderRadius: [4, 4, 0, 0] },
        },
      ],
    }, true);
  }, [rows, initChart]);

  return (
    <section className="content-grid">
      <section className="panel panel-wide">
        <div className="panel-head"><h2>每日批发趋势</h2><span>出口批发 / 本地批发 / 外运 / 代加工 / 采购</span></div>
        <div id="wholesaleTrendChart" className="trend-chart" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th><th>出口吨数</th><th>本地吨数</th>
                <th>外运吨数</th><th>代加工吨数</th><th>采购吨数</th><th>待识别吨数</th><th>销售额</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((item, i) => (
                <tr key={i}>
                  <td>{item.date}</td>
                  <td>{num.format(item.exportTons || 0)}</td>
                  <td>{num.format(item.localTons || 0)}</td>
                  <td>{num.format(item.transferTons || 0)}</td>
                  <td>{num.format(item.processingTons || 0)}</td>
                  <td>{num.format(item.procurementTons || 0)}</td>
                  <td>{num.format(item.pendingTons || 0)}</td>
                  <td>{yuan.format(item.amountCny || 0)}</td>
                </tr>
              )) : <tr><td colSpan="8">暂无数据</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
