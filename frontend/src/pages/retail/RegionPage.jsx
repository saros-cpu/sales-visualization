// src/pages/retail/RegionPage.jsx — 区域详情
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useChart } from '../../hooks/useChart';
import { getMonths, getStations, getRegions, getDaily } from '../../api/retail';
import { REGION_COLORS, REGION_ORDER } from '../../utils/retail-helpers';

const darkTooltip = { backgroundColor: 'rgba(10,20,50,0.9)', borderColor: 'rgba(0,180,255,0.3)', textStyle: { color: '#e0e8f5', fontSize: 11 } };

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function tonsOf(item) {
  const tons = numeric(item?.totalTons ?? item?.tons);
  if (tons > 0) return tons;
  const mass = numeric(item?.mass ?? item?.totalWeightKg);
  return mass > 0 ? mass / 1000 : 0;
}

function formatTons(value) {
  return numeric(value).toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function RegionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [currentRegion, setCurrentRegion] = useState(params.get('region') || 'REG-02');
  const [currentMonth, setCurrentMonth] = useState('');
  const [allStations, setAllStations] = useState([]);
  const [allRegionsData, setAllRegionsData] = useState({});
  const [regionsData, setRegionsData] = useState({});
  const [monthlyData, setMonthlyData] = useState(null);

  const trendC = useChart();
  const rankC = useChart();
  const payC = useChart();
  const resourceC = useChart();
  const cashCardC = useChart();

  // ── 初始化月份 ──
  useEffect(() => {
    (async () => {
      try {
        const months = await getMonths();
        const valid = months.find(m => m.transactions > 1000);
        setCurrentMonth(valid ? valid.month : months[0]?.month || '2026-04');
      } catch { setCurrentMonth('2026-04'); }
    })();
  }, []);

  // ── 加载数据 ──
  useEffect(() => {
    if (!currentMonth) return;
    (async () => {
      try {
        const [stationsRes, regionsRes, dailyRes] = await Promise.all([
          getStations(currentMonth),
          getRegions(currentMonth),
          getDaily(currentMonth),
        ]);
        setAllStations(stationsRes.stations || []);
        setAllRegionsData(regionsRes || {});
        setRegionsData(regionsRes.regions || {});
        setMonthlyData(dailyRes);
      } catch (e) { console.error('区域数据加载失败', e); }
    })();
  }, [currentMonth]);

  // ── 渲染图表 ──
  useEffect(() => {
    const rd = regionsData[currentRegion] || { amount: 0, volume: 0, cash: 0, card: 0, bonus: 0, stationCount: 0, activeCount: 0 };
    const sts = allStations.filter(s => s.region === currentRegion);
    const activeSts = sts.filter(s => s.amount > 0);
    const color = REGION_COLORS[currentRegion] || '#00d4ff';

    // 1. 趋势图
    let dailyData = [];
    if (monthlyData) {
      const globalDaily = monthlyData.daily || [];
      const stationDaily = monthlyData.stations || {};
      const regionShopKeys = new Set(sts.map(s => s.shopKey));
      const dayMap = {};
      globalDaily.forEach(d => { dayMap[d.date] = { date: d.date, volume: 0, amount: 0 }; });
      regionShopKeys.forEach(sk => {
        const sDaily = stationDaily[String(sk)] || [];
        sDaily.forEach(d => { if (dayMap[d.date]) { dayMap[d.date].volume += d.volume || 0; dayMap[d.date].amount += d.amount || 0; } });
      });
      dailyData = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    }
    const trendEl = document.getElementById('chart-region-trend');
    if (trendEl && trendEl.offsetHeight < 50) {
      trendEl.style.height = '200px';
    }
    const tc = trendC.init('chart-region-trend');
    if (dailyData.length) {
      tc?.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...darkTooltip, formatter: p => `${p[0]?.axisValue}<br/>销量：${((p[0]?.value || 0) / 1e4).toFixed(2)}万升<br/>金额：${((p[1]?.value || 0) / 1e4).toFixed(2)}万索姆` },
        legend: { data: ['销量(升)', '金额(索姆)'], top: 4, textStyle: { color: 'rgba(160,180,210,0.6)', fontSize: 11 } },
        grid: { top: 32, right: 60, bottom: 30, left: 55 },
        xAxis: { type: 'category', data: dailyData.map(d => d.date.slice(5)), axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9 }, axisLine: { lineStyle: { color: 'rgba(0,180,255,0.2)' } }, splitLine: { show: false } },
        yAxis: [
          { type: 'value', name: '升', nameTextStyle: { color: 'rgba(160,180,210,0.4)', fontSize: 9 }, axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
          { type: 'value', name: '索姆', nameTextStyle: { color: 'rgba(160,180,210,0.4)', fontSize: 9 }, axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { show: false }, axisLine: { show: false } },
        ],
        series: [
          { name: '销量(升)', type: 'line', data: dailyData.map(d => d.volume), yAxisIndex: 0, smooth: true, symbol: 'none', lineStyle: { color: '#00e5a0', width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(0,229,160,0.3)' }, { offset: 1, color: 'rgba(0,229,160,0.02)' }] } } },
          { name: '金额(索姆)', type: 'line', data: dailyData.map(d => d.amount), yAxisIndex: 1, smooth: true, symbol: 'none', lineStyle: { color, width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + '50' }, { offset: 1, color: color + '05' }] } } },
        ],
      }, true);
    } else {
      tc?.setOption({ backgroundColor: 'transparent', title: { text: '当前区域暂无日销数据', left: 'center', top: 'middle', textStyle: { color: 'rgba(160,180,210,0.5)', fontSize: 13 } }, xAxis: { show: false }, yAxis: { show: false }, series: [] }, true);
    }

    // 2. 站点排行
    const rankData = [...activeSts].sort((a, b) => a.amount - b.amount);
    const rc = rankC.init('chart-region-rank');
    rc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip, formatter: p => `${p[0].name}<br/>销售金额：${(p[0].value / 1e4).toFixed(2)}万索姆` },
      grid: { top: 8, right: 80, bottom: 8, left: 80 },
      xAxis: { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      yAxis: { type: 'category', data: rankData.map(s => s.name), axisLabel: { color: 'rgba(200,220,240,0.7)', fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'bar', barMaxWidth: 18,
        data: rankData.map(s => ({ value: s.amount, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: color + '40' }, { offset: 1, color: color }] }, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: 'right', fontSize: 9, color: 'rgba(200,220,240,0.5)', formatter: p => (p.value / 1e4).toFixed(2) + '万' },
      }],
    }, true);
    // 点击跳转
    const rankInst = rankC.getInstance();
    rankInst?.off('click');
    rankInst?.on('click', p => {
      const found = allStations.find(s => s.name === p.name);
      navigate(`/retail/station?name=${encodeURIComponent(p.name)}&from=region&region=${encodeURIComponent(currentRegion)}`, { state: { shopKey: found?.shopKey, month: currentMonth } });
    });

    // 3. 支付方式
    const pc = payC.init('chart-region-pay');
    pc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', ...darkTooltip, formatter: p => `${p.name}：${(p.value / 1e4).toFixed(2)}万索姆 (${p.percent}%)` },
      legend: { bottom: 2, textStyle: { fontSize: 10, color: 'rgba(160,180,210,0.6)' } },
      series: [{
        type: 'pie', radius: ['45%', '72%'], center: ['50%', '45%'],
        data: [{ value: rd.cash || 0, name: '现金', itemStyle: { color: '#00d4ff' } }, { value: rd.card || 0, name: '刷卡', itemStyle: { color: '#00e5a0' } }],
        label: { show: false }, emphasis: { scaleSize: 4, label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{b}\n{d}%' } },
      }],
    }, true);

    // 4. 油品结构
    const resourceRows = ((allRegionsData.byResourceByRegion || {})[currentRegion] || allRegionsData.byResource || [])
      .filter(r => !String(r.name || '').startsWith('Other'))
      .sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const resc = resourceC.init('chart-region-resource');
    resc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip, formatter: p => `${(Array.isArray(p) ? p[0] : p).name}<br/>销售量：<b>${p[0]?.value || p.value}万升</b>` },
      grid: { top: 8, right: 48, bottom: 16, left: 52 },
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      yAxis: { type: 'category', data: resourceRows.map(r => r.name).reverse(), axisLabel: { color: 'rgba(200,220,240,0.75)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{ type: 'bar', data: resourceRows.map(r => parseFloat(((r.volume || 0) / 10000).toFixed(2))).reverse(), barMaxWidth: 14, itemStyle: { color: '#00d4ff', borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', formatter: p => p.value + '万', color: 'rgba(220,240,255,0.86)', fontSize: 10 } }],
    }, true);

    // 5. 现金 vs 刷卡（按站点）
    const ccSts = [...activeSts].sort((a, b) => b.amount - a.amount).slice(0, 8);
    const ccc = cashCardC.init('chart-region-cash-card');
    ccc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip },
      legend: { data: ['现金', '刷卡'], top: 4, textStyle: { color: 'rgba(160,180,210,0.6)', fontSize: 10 } },
      grid: { top: 28, right: 8, bottom: 42, left: 36 },
      xAxis: { type: 'category', data: ccSts.map(s => s.short || s.name), axisLabel: { color: 'rgba(200,220,240,0.7)', fontSize: 9, rotate: 30 }, axisLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      series: [
        { name: '现金', type: 'bar', barMaxWidth: 12, data: ccSts.map(s => s.cash || 0), itemStyle: { color: '#00d4ff' }, label: { show: true, position: 'top', formatter: p => (p.value / 1e4).toFixed(2) + '万', color: 'rgba(220,240,255,0.78)', fontSize: 9 } },
        { name: '刷卡', type: 'bar', barMaxWidth: 12, data: ccSts.map(s => s.card || 0), itemStyle: { color: '#00e5a0' }, label: { show: true, position: 'top', formatter: p => (p.value / 1e4).toFixed(2) + '万', color: 'rgba(220,240,255,0.78)', fontSize: 9 } },
      ],
    }, true);
  }, [currentRegion, allStations, regionsData, allRegionsData, monthlyData]);

  const rd = regionsData[currentRegion] || { amount: 0, volume: 0 };
  const sts = allStations.filter(s => s.region === currentRegion);
  const activeSts = sts.filter(s => s.amount > 0);
  const regionTons = tonsOf(rd) || sts.reduce((sum, row) => sum + tonsOf(row), 0);
  const cardPct = rd.amount > 0 ? ((rd.card / rd.amount) * 100).toFixed(2) : '0.0';

  return (
    <div className="retail-page-wrap">
      <div className="retail-region-grid">
        {/* 左列 */}
        <div className="region-left-col">
          {/* 区域选择 */}
          <div className="retail-panel" style={{ flexShrink: 0 }}>
            <div className="retail-panel-header"><div className="dot" /><span>选择区域</span></div>
            <div style={{ display: 'flex', gap: 6, padding: '8px 12px', flexWrap: 'wrap' }}>
              {REGION_ORDER.map(r => (
                <div key={r} className={`region-tab${r === currentRegion ? ' active' : ''}`} onClick={() => setCurrentRegion(r)}>{r}</div>
              ))}
            </div>
          </div>

          {/* KPI */}
          <div className="retail-panel" style={{ flexShrink: 0 }}>
            <div className="retail-panel-header"><div className="dot" /><span>{currentRegion} 核心指标</span></div>
            <div className="retail-kpi-grid">
              <div className="retail-kpi-card c1"><div className="kpi-label">💰 销售总金额</div><div className="kpi-value">{(rd.amount / 1e4).toFixed(2)}</div><div className="kpi-unit">万索姆</div></div>
              <div className="retail-kpi-card c2"><div className="kpi-label">⛽ 销售总量</div><div className="kpi-value">{(rd.volume / 1e4).toFixed(2)}</div><div className="kpi-unit">万升</div><div className="kpi-change">吨位 {formatTons(regionTons)} 吨</div></div>
              <div className="retail-kpi-card c3"><div className="kpi-label">🏪 活跃站点</div><div className="kpi-value">{activeSts.length}/{sts.length}</div><div className="kpi-unit">站</div></div>
              <div className="retail-kpi-card c4"><div className="kpi-label">💳 刷卡占比</div><div className="kpi-value">{cardPct}</div><div className="kpi-unit">%</div></div>
            </div>
          </div>

          {/* 站点列表 */}
          <div className="retail-panel" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="retail-panel-header"><div className="dot" /><span>区域站点列表</span></div>
            <div className="station-list">
              {[...sts].sort((a, b) => b.amount - a.amount).map(s => {
                const isClosed = s.status === 'closed';
                return (
                  <div key={s.shopKey} className="station-item" onClick={() => navigate(`/retail/station?name=${encodeURIComponent(s.name)}&from=region&region=${encodeURIComponent(currentRegion)}`, { state: { shopKey: s.shopKey, month: currentMonth } })}>
                    <div>
                      <div className="station-name">{s.name} {isClosed && <span className="closed-badge">● {s.closedReason || '停业'}</span>}</div>
                      <div className="station-short">{s.short}</div>
                    </div>
                    <div className="station-amt">{isClosed ? '--' : (s.amount / 1e4).toFixed(2) + '万'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 右上：趋势 */}
        <div className="retail-panel region-cell-trend">
          <div className="retail-panel-header"><div className="dot" /><span>当月日销趋势（销量 + 金额）</span></div>
          <div className="panel-body"><div id="chart-region-trend" className="chart-full" /></div>
        </div>

        {/* 右中：站点排行 */}
        <div className="retail-panel region-cell-rank">
          <div className="retail-panel-header"><div className="dot" /><span>区域内站点销售排行</span></div>
          <div className="panel-body"><div id="chart-region-rank" className="chart-full" /></div>
        </div>

        {/* 右下：3个子图 */}
        <div className="region-bottom-row">
          <div className="retail-panel" style={{ flex: 1 }}>
            <div className="retail-panel-header"><div className="dot" /><span>支付方式分布</span></div>
            <div className="panel-body"><div id="chart-region-pay" className="chart-full" /></div>
          </div>
          <div className="retail-panel" style={{ flex: 1 }}>
            <div className="retail-panel-header"><div className="dot" /><span>油品销售结构</span></div>
            <div className="panel-body"><div id="chart-region-resource" className="chart-full" /></div>
          </div>
          <div className="retail-panel" style={{ flex: 1 }}>
            <div className="retail-panel-header"><div className="dot" /><span>现金 vs 刷卡（按站点）</span></div>
            <div className="panel-body"><div id="chart-region-cash-card" className="chart-full" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
