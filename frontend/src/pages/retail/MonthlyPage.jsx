// src/pages/retail/MonthlyPage.jsx — 月度分析
import { useState, useEffect, useCallback, useRef } from 'react';
import { getMonths, getMonthlyData, generateMonthlyReport } from '../../api/retail';
import { download } from '../../api/client';
import { useChart } from '../../hooks/useChart';
import { REGION_COLORS, numberFormat, volumeFormat, sortRankingRows } from '../../utils/retail-helpers';
import { useRetailHeader } from '../../components/layout/RetailHeaderContext';

export default function MonthlyPage() {
  const [months, setMonths] = useState([]);
  const [ym, setYm] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reporting, setReporting] = useState(false);
  const requestSeqRef = useRef(0);

  const { registerControls, clearControls } = useRetailHeader();

  const trendChart = useChart();
  const oilChart = useChart();
  const resourceChart = useChart();

  // Report handler
  const handleReport = useCallback(async () => {
    if (!ym) { alert('请先选择月份'); return; }
    setReporting(true);
    try {
      const res = await generateMonthlyReport(ym);
      download(res.docxDownloadUrl);
      download(res.htmlDownloadUrl);
    } catch (err) {
      alert(err.message || '分析报告生成失败');
    } finally {
      setReporting(false);
    }
  }, [ym]);

  // Load months — 零售数据 T+1 延迟，当前月份 = 昨天的月份
  useEffect(() => {
    const yesterday = new Date(Date.now() - 86400000);
    const currentMonth = yesterday.toISOString().slice(0, 7);
    getMonths().then(list => {
      setMonths(list);
      if (list.length > 0) {
        const sel = list.some(m => m.month === currentMonth) ? currentMonth : list[0].month;
        setYm(sel);
      }
    }).catch(() => {});
  }, []);

  // Register header controls
  useEffect(() => {
    registerControls({
      type: 'monthly',
      months,
      ym,
      onYmChange: (val) => setYm(val),
      onReport: handleReport,
      reporting,
    });
    return () => clearControls();
  }, [months, ym, handleReport, reporting, registerControls, clearControls]);

  // Load monthly data
  useEffect(() => {
    if (!ym) return;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setLoadError('');
    setData(null);

    getMonthlyData(ym)
      .then(d => {
        if (requestSeqRef.current !== requestSeq) return;
        setData(d);
        initCharts(d);
      })
      .catch(err => {
        if (requestSeqRef.current !== requestSeq) return;
        console.error('加载月度数据失败:', err);
        setLoadError(err.message || '加载月度数据失败');
      })
      .finally(() => {
        if (requestSeqRef.current === requestSeq) setLoading(false);
      });
  }, [ym]);

  // Init charts
  const initCharts = useCallback((d) => {
    if (!window.echarts) return;
    setTimeout(() => {
      const tc = trendChart.init('monthTrendChart');
      if (tc && !tc.getOption()) {
        tc.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', backgroundColor: 'rgba(10,20,50,0.9)', borderColor: 'rgba(0,180,255,0.3)', textStyle: { color: '#e0e8f5', fontSize: 11 },
            formatter: (p) => `${p[0].axisValue}<br/>销量：${(p[0].value / 1e4).toFixed(2)}万升<br/>金额：${(p[1].value / 1e4).toFixed(2)}万索姆` },
          legend: { data: ['日销量(升)', '日销额(索姆)'], top: 4, textStyle: { color: 'rgba(160,180,210,0.6)', fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
          grid: { top: 30, right: 70, bottom: 32, left: 70 },
          xAxis: { type: 'category', data: [], axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(0,180,255,0.2)' } } },
          yAxis: [
            { type: 'value', name: '升', nameTextStyle: { color: 'rgba(160,180,210,0.4)', fontSize: 10 }, axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 10, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } } },
            { type: 'value', name: '索姆', nameTextStyle: { color: 'rgba(160,180,210,0.4)', fontSize: 10 }, axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 10, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { show: false } },
          ],
          series: [
            { name: '日销量(升)', type: 'bar', data: [], yAxisIndex: 0, barMaxWidth: 14, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,229,160,0.8)' }, { offset: 1, color: 'rgba(0,229,160,0.2)' }] }, borderRadius: [2, 2, 0, 0] } },
            { name: '日销额(索姆)', type: 'line', data: [], yAxisIndex: 1, smooth: true, symbol: 'none', lineStyle: { color: '#00d4ff', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,212,255,0.3)' }, { offset: 1, color: 'rgba(0,212,255,0.02)' }] } } },
          ],
        });
      }

      const oc = oilChart.init('oilChart');
      if (oc && !oc.getOption()) {
        oc.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'item', backgroundColor: 'rgba(10,20,50,0.9)', borderColor: 'rgba(0,180,255,0.3)', textStyle: { color: '#e0e8f5', fontSize: 11 },
            formatter: (p) => `${p.name}：${(p.value / 1e4).toFixed(2)}万索姆 (${p.percent}%)` },
          legend: { bottom: 4, textStyle: { fontSize: 10, color: 'rgba(160,180,210,0.6)' }, itemWidth: 10, itemHeight: 10, itemGap: 8 },
          series: [{ type: 'pie', radius: ['40%', '68%'], center: ['50%', '44%'], data: [], label: { show: false }, emphasis: { scaleSize: 4, label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{b}\n{d}%' } } }],
        });
      }

      const rc = resourceChart.init('resourceChart');
      if (rc && !rc.getOption()) {
        rc.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(10,20,50,0.9)', borderColor: 'rgba(0,180,255,0.3)', textStyle: { color: '#e0e8f5', fontSize: 11 },
            formatter: (p) => `${(Array.isArray(p) ? p[0] : p).name}<br/>销售量：<b>${(Array.isArray(p) ? p[0] : p).value}万升</b>` },
          grid: { top: 12, right: 54, bottom: 18, left: 58 },
          xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } } },
          yAxis: { type: 'category', inverse: true, data: [], axisLabel: { color: 'rgba(200,220,240,0.72)', fontSize: 10 } },
          series: [{ type: 'bar', data: [], barMaxWidth: 14, itemStyle: { color: '#00d4ff', borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: 'rgba(220,240,255,0.86)', fontSize: 10, formatter: p => p.value + '万' } }],
        });
      }

      // Now update with data
      updateChartsWithData(d);
    }, 100);
  }, []);

  const updateChartsWithData = useCallback((d) => {
    const dailyData = d.daily || [];
    const s = d.summary || {};

    // Trend
    const tc = trendChart.getInstance();
    if (tc) {
      tc.setOption({
        xAxis: { data: dailyData.map(dd => dd.date.slice(5)) },
        series: [
          { data: dailyData.map(dd => dd.volume) },
          { data: dailyData.map(dd => dd.amount) },
        ],
      });
    }

    // Oil (payment)
    const oc = oilChart.getInstance();
    if (oc) {
      oc.setOption({
        series: [{
          data: [
            { value: Number(s.cashSales || 0), name: '现金', itemStyle: { color: '#ffa726' } },
            { value: Number(s.cardSales || 0), name: '刷卡', itemStyle: { color: '#a78bfa' } },
          ],
        }],
      });
    }

    // Resource
    const rc = resourceChart.getInstance();
    if (rc) {
      const resourceRows = sortRankingRows(
        (d.byResource || []).filter(r => !String(r.name || '').startsWith('Other')),
        r => r.volume,
      );
      rc.setOption({
        yAxis: { inverse: true, data: resourceRows.map(r => r.name) },
        series: [{ data: resourceRows.map(r => parseFloat(((r.volume || 0) / 10000).toFixed(2))) }],
      });
    }
  }, []);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      [trendChart, oilChart, resourceChart].forEach(c => c.getInstance()?.resize());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Render data
  const s = data?.summary || {};
  const stationData = (data?.stations || []).map(st => ({
    ...st,
    amount: Number(st.amount || st.totalSales || st.cardSales || 0),
    volume: Number(st.volume || st.totalLiters || 0),
    cash: Number(st.cash || st.cashSales || 0),
    card: Number(st.card || st.cardSales || 0),
    bonus: Number(st.bonus || st.bonusCost || 0),
  }));
  const stationByAmount = [...stationData].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  const top10 = stationByAmount.slice(0, 10);

  const dailyData = data?.daily || [];
  const daysInData = dailyData.length;
  const dailyLitersAvg = daysInData > 0 ? s.totalLiters / daysInData : 0;
  const totalTons = Number(s.totalTons || 0);
  const dailyTonsAvg = daysInData > 0 ? totalTons / daysInData : 0;
  const totalSalesCny = Number(s.totalSalesCny || 0);
  const cardPct = s.totalSales > 0 ? (s.cardSales / s.totalSales * 100) : 0;
  const inactiveSt = (s.totalShops || 0) - (s.activeShops || 0);

  // Region data for insights
  const regionData = data?.regions || {};
  const regionArr = Object.keys(regionData).sort((a, b) => (regionData[b].amount || 0) - (regionData[a].amount || 0));

  const cmp = data?.comparison || {};
  const mom = cmp.mom || {};
  const yoy = cmp.yoy || {};

  const fmtChange = (val, label) => {
    if (val == null) return '--';
    const arrow = val >= 0 ? '↑' : '↓';
    const color = val >= 0 ? '#00e5a0' : '#ef5350';
    return <span style={{ color }}>{arrow} {Math.abs(val).toFixed(2)}%</span>;
  };

  const yearLabel = ym ? `${ym.split('-')[0]}年${parseInt(ym.split('-')[1])}月` : '';

  if (!data && loading) {
    return (
      <main className="retail-monthly-content">
        <div className="retail-panel" style={{ padding: 24, color: 'rgba(220,240,255,0.8)' }}>
          正在加载 {ym || ''} 月度数据...
        </div>
      </main>
    );
  }

  if (!data && loadError) {
    return (
      <main className="retail-monthly-content">
        <div className="retail-panel" style={{ padding: 24, color: '#ef5350' }}>
          {loadError}
        </div>
      </main>
    );
  }

  // Build insights (JSX with color highlights matching original)
  const B = ({ color, children }) => <b style={{ color }}>{children}</b>;
  const insights = [];
  if (top10.length > 0) {
    const t = top10[0];
    insights.push({ icon: '🏆', content: <>{t.name}（{t.short}）单站销售额 <B color="#00d4ff">{(t.amount / 1e4).toFixed(2)}万索姆</B>，位居全网第1名。</> });
  }
  if (regionArr.length > 0) {
    const topR = regionArr[0];
    const rPct = s.totalSales > 0 ? (regionData[topR].amount / s.totalSales * 100).toFixed(2) : '0.0';
    insights.push({ icon: '🔴', content: <>{topR}销售金额 <B color="#00d4ff">{(regionData[topR].amount / 1e4).toFixed(2)}万索姆</B>，占全网 <B color="#00d4ff">{rPct}%</B>，持续领跑。</> });
  }
  insights.push({ icon: '💳', content: <>全网刷卡支付占比 <b>{cardPct.toFixed(2)}%</b>，现金支付占 {(100 - cardPct).toFixed(2)}%。</> });
  if (inactiveSt > 0) {
    const zeroStations = stationData.filter(x => Number(x.amount || 0) === 0).map(x => x.name);
    insights.push({ icon: '⚠️', content: <>共 <B color="#ef5350">{inactiveSt}站</B> 本月无销售：{zeroStations.join('、')}。</> });
  }
  insights.push({ icon: '📊', content: <>日均销量 <B color="#ffa726">{volumeFormat(dailyLitersAvg)}升</B>，日均销售额 {numberFormat(s.totalSales / daysInData)} 索姆。</> });
  if (mom.sales != null) {
    const momColor = mom.sales >= 0 ? '#00e5a0' : '#ef5350';
    const volColor = mom.volume >= 0 ? '#00e5a0' : '#ef5350';
    insights.push({ icon: '📈', content: <>环比上月（{mom.prevMonth || ''}）：销售额{mom.sales >= 0 ? '增长' : '下降'} <B color={momColor}>{Math.abs(mom.sales).toFixed(2)}%</B>，销量{mom.volume >= 0 ? '增长' : '下降'} <B color={volColor}>{Math.abs(mom.volume).toFixed(2)}%</B>。</> });
  }
  if (yoy.sales != null) {
    const yoyColor = yoy.sales >= 0 ? '#00e5a0' : '#ef5350';
    const yoyVolColor = yoy.volume >= 0 ? '#00e5a0' : '#ef5350';
    insights.push({ icon: '📅', content: <>同比去年（{yoy.yoyMonth || ''}）：销售额{yoy.sales >= 0 ? '增长' : '下降'} <B color={yoyColor}>{Math.abs(yoy.sales).toFixed(2)}%</B>，销量{yoy.volume >= 0 ? '增长' : '下降'} <B color={yoyVolColor}>{Math.abs(yoy.volume).toFixed(2)}%</B>。</> });
  }

  return (
    <main className="retail-monthly-content">
      {/* KPI Row */}
      <div className="retail-kpi-row">
        <div className="retail-panel retail-kpi-card c1">
          <div className="kpi-label">💰 月销售总金额</div>
          <div className="kpi-value">{numberFormat(s.totalSales)}</div>
          <div className="kpi-unit">索姆（COM）</div>
          <div className="kpi-sub">
            {totalSalesCny > 0 ? `人民币 ${numberFormat(totalSalesCny)}元 | ` : ''}
            {fmtChange(mom.sales, '环比')}
            {yoy.sales != null && <> | {fmtChange(yoy.sales, '同比')}</>}
          </div>
        </div>
        <div className="retail-panel retail-kpi-card c2">
          <div className="kpi-label">⛽ 月销售总量</div>
          <div className="kpi-value">{volumeFormat(s.totalLiters)}</div>
          <div className="kpi-unit">升（Л）</div>
          <div className="kpi-sub">
            {totalTons > 0 ? `吨位 ${Number(totalTons).toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} 吨 | ` : ''}
            {fmtChange(mom.volume, '环比')}
          </div>
        </div>
        <div className="retail-panel retail-kpi-card c3">
          <div className="kpi-label">📅 日均销量</div>
          <div className="kpi-value">{volumeFormat(dailyLitersAvg)}</div>
          <div className="kpi-unit">升/天</div>
          <div className="kpi-sub">{daysInData}天均值 · {dailyTonsAvg.toFixed(3)} 吨/天</div>
        </div>
        <div className="retail-panel retail-kpi-card c4">
          <div className="kpi-label">🏪 活跃站点</div>
          <div className="kpi-value">{s.activeShops || '--'}</div>
          <div className="kpi-unit">站（共{s.totalShops || 0}站有记录）</div>
          <div className="kpi-sub" style={{ color: inactiveSt > 0 ? '#ef5350' : '#00e5a0' }}>
            {inactiveSt > 0 ? `${inactiveSt}站无销售` : '全部有销售'}
          </div>
        </div>
        <div className="retail-panel retail-kpi-card c5">
          <div className="kpi-label">💳 刷卡支付占比</div>
          <div className="kpi-value">{cardPct.toFixed(2)}%</div>
          <div className="kpi-unit">现金占{(100 - cardPct).toFixed(2)}%</div>
          <div className="kpi-sub">全网络合计</div>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="retail-panel retail-monthly-panel monthly-trend-cell">
        <div className="retail-panel-header"><div className="dot" />{yearLabel} · 全网日销趋势（{daysInData}天）</div>
        <div className="panel-body"><div id="monthTrendChart" /></div>
      </div>

      {/* Insights */}
      <div className="retail-panel monthly-insights-cell" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="retail-panel-header"><div className="dot" />🔍 月度关键洞察</div>
        <div className="retail-insight-list" style={{ flex: 1, minHeight: 0 }}>
          {insights.map((ins, i) => (
            <div key={i} className="retail-insight-item">
              <span className="retail-insight-icon">{ins.icon}</span>
              <span>{ins.content}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Resource Chart */}
      <div className="retail-panel retail-monthly-panel monthly-resource-cell">
        <div className="retail-panel-header"><div className="dot" />油品销售结构</div>
        <div className="panel-body"><div id="resourceChart" /></div>
      </div>

      {/* Oil Chart */}
      <div className="retail-panel retail-monthly-panel monthly-oil-cell">
        <div className="retail-panel-header"><div className="dot" />支付方式分布</div>
        <div className="panel-body"><div id="oilChart" /></div>
      </div>

      {/* Rank Table */}
      <div className="retail-panel monthly-rank-cell" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="retail-panel-header"><div className="dot" />销售金额 TOP 10</div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          <table className="retail-rank-table">
            <thead>
              <tr><th>排名</th><th>站点</th><th>区域</th><th style={{ textAlign: 'right' }}>销售金额</th><th style={{ textAlign: 'right' }}>占比</th></tr>
            </thead>
            <tbody>
              {top10.map((st, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
                const rc = REGION_COLORS[st.region] || '#666';
                return (
                  <tr key={i}>
                    <td style={{ textAlign: 'center' }}>{medal}</td>
                    <td>
                      <b>{st.name}</b>
                      <div style={{ fontSize: 10, color: 'rgba(160,180,210,0.4)' }}>{st.short}</div>
                    </td>
                    <td>
                      <span className="retail-tag" style={{ background: rc + '20', color: rc, border: `1px solid ${rc}40` }}>{st.region}</span>
                    </td>
                    <td className="num">{(st.amount / 1e4).toFixed(2)}万</td>
                    <td className="num">{s.totalSales > 0 ? (st.amount / s.totalSales * 100).toFixed(2) : '0'}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
