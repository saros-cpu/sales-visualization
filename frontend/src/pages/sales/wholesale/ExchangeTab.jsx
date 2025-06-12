// src/pages/sales/wholesale/ExchangeTab.jsx — 汇率
import { useEffect } from 'react';
import { num, rateNum } from '../../../utils/format';
import { useChart, noDataOption } from '../../../hooks/useChart';

export default function ExchangeTab({ data, onExport }) {
  const { chartRef, initChart } = useChart();
  const exchange = data?.exchangeRates || { items: [] };
  const items = exchange.items || [];

  useEffect(() => {
    const chart = initChart('exchangeTrendChart');
    if (!chart) return;

    const sorted = [...items].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!sorted.length) {
      noDataOption(chart, '暂无汇率快照');
      return;
    }

    chart.setOption({
      backgroundColor: 'transparent',
      color: ['#00d4ff', '#00e5a0'],
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(5, 12, 24, 0.92)',
        borderColor: 'rgba(0, 212, 255, 0.28)',
        textStyle: { color: '#e0e8f5' },
        valueFormatter: v => v == null ? '--' : rateNum.format(v),
      },
      legend: { top: 0, textStyle: { color: 'rgba(224, 232, 245, 0.78)' } },
      grid: { left: 54, right: 64, top: 46, bottom: 34 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: sorted.map(i => i.date.slice(5)),
        axisLine: { lineStyle: { color: 'rgba(160, 180, 210, 0.28)' } },
        axisLabel: { color: 'rgba(224, 232, 245, 0.68)' },
      },
      yAxis: [
        {
          type: 'value', name: 'USD/KGS', scale: true,
          nameTextStyle: { color: 'rgba(224, 232, 245, 0.58)' },
          splitLine: { lineStyle: { color: 'rgba(160, 180, 210, 0.10)' } },
          axisLabel: { color: 'rgba(224, 232, 245, 0.68)' },
        },
        {
          type: 'value', name: 'CNY/KGS', scale: true,
          nameTextStyle: { color: 'rgba(224, 232, 245, 0.58)' },
          splitLine: { show: false },
          axisLabel: { color: 'rgba(224, 232, 245, 0.68)' },
        },
      ],
      series: [
        { name: 'USD/KGS', type: 'line', smooth: true, symbolSize: 6, data: sorted.map(i => i.usdKgs), lineStyle: { width: 3 } },
        { name: 'CNY/KGS', type: 'line', smooth: true, symbolSize: 6, yAxisIndex: 1, data: sorted.map(i => i.cnyKgs), lineStyle: { width: 3 } },
      ],
    }, true);
  }, [items, initChart]);

  return (
    <>
      <section className="summary-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <article className="metric-panel wholesale" style={{ minHeight: 'auto', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ margin: 0 }}>汇率快照</span>
          <strong style={{ fontSize: 20 }}>{num.format(exchange.total || 0)}</strong>
          <small style={{ margin: 0 }}>条记录 · USD缺口 {num.format(exchange.missingUsd || 0)} · CNY缺口 {num.format(exchange.missingCny || 0)}</small>
        </article>
        <article className="metric-panel combined" style={{ minHeight: 'auto', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ margin: 0 }}>待处理缺口</span>
          <strong style={{ fontSize: 20 }}>{num.format(exchange.openGaps || 0)}</strong>
          <small style={{ margin: 0 }}>缺失汇率需人工补录</small>
        </article>
      </section>

      <section className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head">
            <h2>每日汇率</h2>
            <div className="inline-filter">
              <span>NBKR 快照 / 手工录入</span>
              <button type="button" onClick={onExport}>保存 Excel</button>
            </div>
          </div>
          <div id="exchangeTrendChart" className="trend-chart compact" />
          <div className="table-wrap review-scroll exchange-scroll">
            <table>
              <thead>
                <tr><th>日期</th><th>USD/KGS</th><th>CNY/KGS</th><th>来源</th><th>状态</th></tr>
              </thead>
              <tbody>
                {items.length ? items.map((item, i) => {
                  const missing = [];
                  if (item.missingUsd) missing.push('USD');
                  if (item.missingCny) missing.push('CNY');
                  const status = missing.length ? `缺 ${missing.join('/')}` : '完整';
                  return (
                    <tr key={i}>
                      <td>{item.date}</td>
                      <td>{item.usdKgs ?? '--'}</td>
                      <td>{item.cnyKgs ?? '--'}</td>
                      <td>{item.isManual ? '人工' : item.source}</td>
                      <td>{status}</td>
                    </tr>
                  );
                }) : <tr><td colSpan="5">暂无汇率快照</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </>
  );
}
