// src/pages/retail/StationPage.jsx — 站点详情
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useChart } from '../../hooks/useChart';
import { getMonths, getStations, getStationDetail } from '../../api/retail';
import { REGION_COLORS, REGION_ORDER, numberFormat } from '../../utils/retail-helpers';

const darkTooltip = {
  backgroundColor: 'rgba(10,20,50,0.9)',
  borderColor: 'rgba(0,180,255,0.3)',
  textStyle: { color: '#e0e8f5', fontSize: 11 },
};

function rankBadge(rank, total, label) {
  const cls = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-n';
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
  return <span className={`rank-badge ${cls}`}>{medal} {label}第 {rank} / {total}</span>;
}

function fixed2(n) { return Number(n || 0).toFixed(2); }

export default function StationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryName = params.get('name');
  const fromRegion = params.get('from') === 'region';
  const fromRegionName = params.get('region') || '';

  const [allStations, setAllStations] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(location.state?.month || '');
  const [currentShopKey, setCurrentShopKey] = useState(location.state?.shopKey || null);
  const [detail, setDetail] = useState(null);

  // 6 charts
  const trendC = useChart();
  const oilC = useChart();
  const resourceC = useChart();
  const payTrendC = useChart();
  const compareC = useChart();
  const radarC = useChart();

  // ── 选择最近有数据的月份 ──
  useEffect(() => {
    if (currentMonth) return;
    (async () => {
      try {
        const months = await getMonths();
        const valid = months.find(m => m.transactions > 1000);
        setCurrentMonth(valid ? valid.month : months[0]?.month || '2026-04');
      } catch { setCurrentMonth('2026-04'); }
    })();
  }, []);

  // ── 加载站点列表 ──
  useEffect(() => {
    if (!currentMonth) return;
    (async () => {
      try {
        const res = await getStations(currentMonth);
        setAllStations(res.stations || []);
      } catch (e) { console.error('站点列表加载失败', e); }
    })();
  }, [currentMonth]);

  // ── 确定默认 shopKey ──
  useEffect(() => {
    if (!allStations.length || currentShopKey) return;
    let key = null;
    if (queryName) {
      const found = allStations.find(s => s.name === queryName);
      if (found) key = found.shopKey;
    }
    if (!key) {
      const active = allStations.filter(s => s.amount > 0);
      if (active.length) key = active[0].shopKey;
    }
    if (key) setCurrentShopKey(key);
  }, [allStations, queryName, currentShopKey]);

  // ── 加载详情 ──
  const loadDetail = useCallback(async (shopKey) => {
    if (!currentMonth || !shopKey) return;
    try {
      const res = await getStationDetail(currentMonth, shopKey);
      setDetail(res);
    } catch (e) { console.error('站点详情加载失败', e); }
  }, [currentMonth]);

  useEffect(() => {
    if (currentShopKey) loadDetail(currentShopKey);
  }, [currentShopKey, loadDetail]);

  // ── 渲染图表 ──
  useEffect(() => {
    if (!detail) return;
    const s = detail.summary || {};
    const daily = detail.daily || [];
    const region = detail.region || '';
    const color = REGION_COLORS[region] || '#00d4ff';
    const name = detail.name || '';

    const regionSts = allStations.filter(x => x.region === region && x.status !== 'closed').sort((a, b) => b.amount - a.amount);
    const activeAll = allStations.filter(x => x.status !== 'closed').sort((a, b) => b.amount - a.amount);

    // 1. 日销趋势
    const tc = trendC.init('chart-station-trend');
    if (daily.length) {
      tc?.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', ...darkTooltip, formatter: p => `${p[0].axisValue}<br/>销量：${(p[0].value / 1e3).toFixed(2)}千升<br/>金额：${(p[1].value / 1e4).toFixed(2)}万索姆` },
        legend: { data: ['销量', '金额'], top: 4, textStyle: { color: 'rgba(160,180,210,0.6)', fontSize: 10 }, itemWidth: 10, itemHeight: 8 },
        grid: { top: 28, right: 55, bottom: 28, left: 55 },
        xAxis: { type: 'category', data: daily.map(d => d.date.slice(5)), axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 8, rotate: 30 }, axisLine: { lineStyle: { color: 'rgba(0,180,255,0.2)' } }, splitLine: { show: false } },
        yAxis: [
          { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e3).toFixed(2) + 'k' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
          { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { show: false }, axisLine: { show: false } },
        ],
        series: [
          { name: '销量', type: 'bar', data: daily.map(d => d.volume), yAxisIndex: 0, barMaxWidth: 8, itemStyle: { color: color + '80', borderRadius: [2, 2, 0, 0] } },
          { name: '金额', type: 'line', data: daily.map(d => d.amount), yAxisIndex: 1, smooth: true, symbol: 'none', lineStyle: { color, width: 2 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + '40' }, { offset: 1, color: color + '05' }] } } },
        ],
      }, true);
    } else {
      tc?.setOption({ backgroundColor: 'transparent', title: { text: '该站点本月暂无日销数据', left: 'center', top: 'middle', textStyle: { color: 'rgba(160,180,210,0.5)', fontSize: 13 } }, xAxis: { show: false }, yAxis: { show: false }, series: [] }, true);
    }

    // 2. 支付方式对比 (pie)
    const oc = oilC.init('chart-station-oil');
    oc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', ...darkTooltip, formatter: p => `${p.name}：${numberFormat(p.value)} 升 (${p.percent}%)` },
      legend: { bottom: 4, textStyle: { fontSize: 10, color: 'rgba(160,180,210,0.6)' }, itemWidth: 10, itemHeight: 10 },
      series: [{
        type: 'pie', radius: ['40%', '68%'], center: ['50%', '44%'],
        data: [
          { name: '现金升数', value: Number(s.cashLiters || 0), itemStyle: { color: '#ffa726' } },
          { name: '刷卡升数', value: Number(s.cardLiters || 0), itemStyle: { color: '#a78bfa' } },
        ],
        label: { show: false },
        emphasis: { scaleSize: 4, label: { show: true, fontSize: 11, fontWeight: 'bold', color: '#fff', formatter: '{b}\n{d}%' } },
      }],
    }, true);

    // 3. 油品结构 (horizontal bar)
    const resourceRows = (detail.byResource || []).filter(r => !String(r.name || '').startsWith('Other')).sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const rc = resourceC.init('chart-station-resource');
    rc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip, formatter: p => `${(Array.isArray(p) ? p[0] : p).name}<br/>销售量：<b>${p[0]?.value || p.value}万升</b>` },
      grid: { top: 14, right: 64, bottom: 18, left: 70 },
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      yAxis: { type: 'category', data: resourceRows.map(r => r.name).reverse(), axisLabel: { color: 'rgba(200,220,240,0.75)', fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'bar', data: resourceRows.map(r => parseFloat(((r.volume || 0) / 10000).toFixed(2))).reverse(), barMaxWidth: 16,
        itemStyle: { color: '#00d4ff', borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', formatter: p => p.value + '万', color: 'rgba(220,240,255,0.86)', fontSize: 10 },
      }],
    }, true);

    // 4. 支付趋势
    const payDays = daily.map(d => ({ date: d.date.slice(5), cash: d.cashSales ?? Number(d.amount * (s.amount > 0 ? s.cashSales / s.amount : 0.6)), card: d.cardSales ?? Number(d.amount * (s.amount > 0 ? s.cardSales / s.amount : 0.35)) }));
    const pc = payTrendC.init('chart-station-pay-trend');
    pc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip },
      legend: { data: ['现金', '刷卡'], top: 4, textStyle: { color: 'rgba(160,180,210,0.6)', fontSize: 10 } },
      grid: { top: 28, right: 10, bottom: 28, left: 50 },
      xAxis: { type: 'category', data: payDays.map(d => d.date), axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 8, rotate: 30 }, axisLine: { lineStyle: { color: 'rgba(0,180,255,0.2)' } }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      series: [
        { name: '现金', type: 'bar', stack: 'pay', data: payDays.map(d => d.cash), barMaxWidth: 10, itemStyle: { color: '#ffa726' } },
        { name: '刷卡', type: 'bar', stack: 'pay', data: payDays.map(d => d.card), barMaxWidth: 10, itemStyle: { color: '#a78bfa' } },
      ],
    }, true);

    // 5. 区域对比
    const cmpData = [...regionSts];
    const cc = compareC.init('chart-station-compare');
    cc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip, formatter: p => `${p[0].name}：${(p[0].value / 1e4).toFixed(2)}万索姆` },
      grid: { top: 8, right: 60, bottom: 8, left: 80 },
      xAxis: { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.5)', fontSize: 9, formatter: v => (v / 1e4).toFixed(2) + '万' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      yAxis: { type: 'category', data: cmpData.map(x => x.name).reverse(), axisLabel: { color: 'rgba(200,220,240,0.7)', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'bar', barMaxWidth: 16,
        data: cmpData.map(x => x.amount).reverse(),
        itemStyle: { borderRadius: [0, 4, 4, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: color + '20' }, { offset: 1, color: color + '50' }] } },
        label: { show: true, position: 'right', fontSize: 9, color: 'rgba(200,220,240,0.5)', formatter: p => (p.value / 1e4).toFixed(2) + '万' },
      }],
    }, true);

    // 6. 雷达图
    const maxAmt = Math.max(...cmpData.map(x => x.amount), 1);
    const maxVol = Math.max(...cmpData.map(x => x.volume), 1);
    const maxCard = Math.max(...cmpData.map(x => x.amount > 0 ? (x.card || 0) / x.amount : 0), 0.01);
    const maxPts = Math.max(...cmpData.map(x => x.bonus || 0), 1);
    const score = x => [
      Math.round(x.volume / maxVol * 100),
      Math.round(x.amount / maxAmt * 100),
      Math.round((x.amount > 0 ? (x.card || 0) / x.amount : 0) / maxCard * 100),
      x.bonus > 0 ? Math.min(100, Math.round(x.bonus / maxPts * 100)) : 0,
      cmpData.length > 1 ? Math.round((1 - cmpData.indexOf(x) / (cmpData.length - 1)) * 100) : 100,
    ];
    const cur = cmpData.find(x => x.shopKey === currentShopKey);
    if (cur) {
      const rdc = radarC.init('chart-station-radar');
      rdc?.setOption({
        backgroundColor: 'transparent',
        tooltip: darkTooltip,
        radar: {
          indicator: [{ name: '销量', max: 100 }, { name: '金额', max: 100 }, { name: '刷卡率', max: 100 }, { name: '积分', max: 100 }, { name: '排名', max: 100 }],
          center: ['50%', '50%'], radius: '65%', nameGap: 8,
          name: { textStyle: { color: 'rgba(160,180,210,0.7)', fontSize: 10 } },
          splitLine: { lineStyle: { color: 'rgba(0,180,255,0.1)' } },
          splitArea: { areaStyle: { color: ['rgba(0,180,255,0.03)', 'rgba(0,180,255,0.06)'] } },
          axisLine: { lineStyle: { color: 'rgba(0,180,255,0.15)' } },
        },
        series: [{ type: 'radar', data: [{ value: score(cur), name, areaStyle: { color: color + '40' }, lineStyle: { color, width: 2 }, itemStyle: { color } }] }],
      }, true);
    }
  }, [detail, allStations, currentShopKey]);

  // ── 计算排行 ──
  const regionSts = allStations.filter(x => x.region === detail?.region && x.status !== 'closed').sort((a, b) => b.amount - a.amount);
  const activeAll = allStations.filter(x => x.status !== 'closed').sort((a, b) => b.amount - a.amount);
  const regionRank = regionSts.findIndex(x => x.shopKey === currentShopKey) + 1;
  const globalRank = activeAll.findIndex(x => x.shopKey === currentShopKey) + 1;

  // ── 站点分组选择器 ──
  const stationGroups = REGION_ORDER.map(rgn => ({
    label: rgn,
    stations: allStations.filter(s => s.region === rgn).sort((a, b) => {
      if (a.status === 'closed' && b.status !== 'closed') return 1;
      if (a.status !== 'closed' && b.status === 'closed') return -1;
      return b.amount - a.amount;
    }),
  })).filter(g => g.stations.length > 0);

  const handleSwitchStation = (e) => {
    const sk = parseInt(e.target.value);
    if (sk) setCurrentShopKey(sk);
  };

  const s = detail?.summary || {};
  return (
    <div className="retail-page-wrap">
      {/* Header */}
      <div className="retail-page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: '1px solid rgba(0,180,255,0.12)' }}>
        <button className="retail-nav-btn" onClick={() => fromRegion && fromRegionName ? navigate(`/retail/region?region=${encodeURIComponent(fromRegionName)}`) : navigate('/retail')} style={{ padding: '4px 12px', background: 'rgba(0,30,80,0.4)', border: '1px solid rgba(0,180,255,0.2)', borderRadius: 6, color: '#c8d8f0', cursor: 'pointer', fontSize: 12 }}>
          ← {fromRegion ? '返回区域' : '返回'}
        </button>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, background: 'linear-gradient(90deg,#00d4ff,#60a5fa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {detail?.name || '--'} · 站点详情
          </div>
          <div style={{ fontSize: 12, color: 'rgba(160,180,210,0.5)' }}>{detail?.region || '--'} · {detail?.short || '--'}</div>
        </div>
      </div>

      {/* Main grid */}
      <div className="retail-station-grid">
        {/* Left col */}
        <div className="station-left-col">
          {/* 站点信息 */}
          <div className="retail-panel" style={{ flexShrink: 0 }}>
            <div className="panel-header"><div className="dot" /><span>站点信息</span></div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div className="station-name-big">{detail?.name || '--'}</div>
                <div style={{ fontSize: 13, color: 'rgba(160,180,210,0.5)', marginTop: 2 }}>{detail?.short || '--'}</div>
              </div>
              <div>
                <div className="info-row"><span className="info-label">所属区域</span><span className="info-value">{detail?.region || '--'}</span></div>
                <div className="info-row"><span className="info-label">营业状态</span><span className="info-value">
                  {detail?.status === 'normal'
                    ? <span className="tag tag-green">● 正常营业</span>
                    : detail?.closedReason?.includes('装修')
                      ? <span className="tag" style={{ background: 'rgba(255,167,38,0.15)', color: '#ffa726', border: '1px solid rgba(255,167,38,0.3)' }}>● 装修停业</span>
                      : <span className="tag tag-red">● 停业</span>}
                </span></div>
                <div className="info-row"><span className="info-label">区域排名</span><span className="info-value">{regionRank > 0 ? rankBadge(regionRank, regionSts.length, '区域') : '--'}</span></div>
                <div className="info-row"><span className="info-label">全网排名</span><span className="info-value">{globalRank > 0 ? rankBadge(globalRank, activeAll.length, '全网') : '--'}</span></div>
              </div>
            </div>
          </div>

          {/* KPI */}
          <div className="retail-panel" style={{ flexShrink: 0 }}>
            <div className="panel-header"><div className="dot" /><span>当月经营指标</span></div>
            <div className="station-kpi">
              <div className="retail-kpi-card c1"><div className="kpi-label">💰 销售金额</div><div className="kpi-value">{fixed2(s.amount / 1e4)}</div><div className="kpi-unit">万索姆</div></div>
              <div className="retail-kpi-card c2"><div className="kpi-label">⛽ 销售总量</div><div className="kpi-value">{fixed2(s.volume / 1e4)}</div><div className="kpi-unit">万升</div></div>
              <div className="retail-kpi-card c3"><div className="kpi-label">💵 现金占比</div><div className="kpi-value">{s.amount > 0 ? (s.cashSales / s.amount * 100).toFixed(2) : '0'}</div><div className="kpi-unit">%</div></div>
              <div className="retail-kpi-card c4"><div className="kpi-label">🎯 积分消费</div><div className="kpi-value">{numberFormat(s.bonusCost || 0)}</div><div className="kpi-unit">索姆</div></div>
            </div>
          </div>

          {/* 切换站点 */}
          <div className="retail-panel" style={{ flexShrink: 0 }}>
            <div className="panel-header"><div className="dot" /><span>切换站点</span></div>
            <div style={{ padding: '6px 10px' }}>
              <select className="station-selector" value={currentShopKey || ''} onChange={handleSwitchStation}>
                {stationGroups.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.stations.map(st => {
                      const tag = st.status === 'closed' ? (st.closedReason?.includes('装修') ? ' [装修]' : ' [停业]') : '';
                      return <option key={st.shopKey} value={st.shopKey}>{st.name} ({st.short}){tag}</option>;
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* 雷达图 */}
          <div className="retail-panel" style={{ flex: 1, minHeight: 0 }}>
            <div className="panel-header"><div className="dot" /><span>同区域对比雷达图</span></div>
            <div className="panel-body"><div id="chart-station-radar" className="chart-full" /></div>
          </div>
        </div>

        {/* Right grid cells */}
        <div className="retail-panel station-cell-trend">
          <div className="panel-header"><div className="dot" /><span>近30天日销趋势</span></div>
          <div className="panel-body"><div id="chart-station-trend" className="chart-full" /></div>
        </div>

        <div className="retail-panel station-cell-oil">
          <div className="panel-header"><div className="dot" /><span>支付方式对比</span></div>
          <div className="panel-body"><div id="chart-station-oil" className="chart-full" /></div>
        </div>

        <div className="retail-panel station-cell-pay-trend">
          <div className="panel-header"><div className="dot" /><span>支付方式趋势（近30天）</span></div>
          <div className="panel-body"><div id="chart-station-pay-trend" className="chart-full" /></div>
        </div>

        <div className="retail-panel station-cell-compare">
          <div className="panel-header"><div className="dot" /><span>同区域站点销售对比</span></div>
          <div className="panel-body"><div id="chart-station-compare" className="chart-full" /></div>
        </div>

        <div className="retail-panel station-cell-resource">
          <div className="panel-header"><div className="dot" /><span>油品销售结构</span></div>
          <div className="panel-body"><div id="chart-station-resource" className="chart-full" /></div>
        </div>
      </div>
    </div>
  );
}
