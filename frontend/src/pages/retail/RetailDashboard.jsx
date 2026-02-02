// src/pages/retail/RetailDashboard.jsx — 零售仪表板
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getYears, getMonths, getDashboardYearly, getKpiYearly, getStationMapDetails, getStations, generateYearlyReport } from '../../api/retail';
import { download } from '../../api/client';
import { useChart } from '../../hooks/useChart';
import {
  REGION_COLORS, REGION_ORDER,
  fmtNum, fmtWanLiters, fmtLiters, fmtPct, pctColor,
  buildResourceRank,
} from '../../utils/retail-helpers';

export default function RetailDashboard() {
  const navigate = useNavigate();
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [kpi, setKpi] = useState(null);
  const [dashData, setDashData] = useState(null);
  const [stations, setStations] = useState([]);
  const [depots, setDepots] = useState([]);
  const [regionMap, setRegionMap] = useState({});
  const [footerMessages, setFooterMessages] = useState([]);
  const [cutoffText, setCutoffText] = useState('数据截止：--');
  const [retailMapFullscreen, setRetailMapFullscreen] = useState(false);

  // 3D map refs
  const retailKgzMapRef = useRef(null);
  const retailKgzMapActiveRef = useRef(false);
  const retailMapShellRef = useRef(null);

  // chart refs
  const regionBarChart = useChart();
  const mapChart = useChart();
  const rankChart = useChart();
  const resourceRankChart = useChart();
  const payChart = useChart();
  const regionRankChart = useChart();
  const cashCardChart = useChart();

  // Load years
  useEffect(() => {
    getYears().then(list => {
      setYears(list);
      if (list.length > 0) {
        const y = list[0];
        setYear(y);
      }
    }).catch(() => {});
  }, []);

  // Compute region map from stations
  const computeRegionMap = useCallback((stationList) => {
    const rm = {};
    REGION_ORDER.forEach(name => {
      rm[name] = { stations: [], vol: 0, amt: 0, cash: 0, card: 0, pts: 0 };
    });
    stationList.filter(s => s.type === 'station').forEach(s => {
      const r = rm[s.region];
      if (r) {
        r.stations.push(s);
        r.vol += s.volume || 0;
        r.amt += s.amount || 0;
        r.cash += s.cash || 0;
        r.card += s.card || 0;
        r.pts += s.pts || 0;
      }
    });
    return rm;
  }, []);

  // Load data for a given year
  const loadYearData = useCallback(async (y) => {
    try {
      const [dash, kpiData, mapDetails] = await Promise.allSettled([
        getDashboardYearly(y),
        getKpiYearly(y),
        getStationMapDetails(),
      ]);

      // KPI
      if (kpiData.status === 'fulfilled' && kpiData.value) {
        const kd = kpiData.value;
        setKpi(kd);
        const summary = kd.summary || {};
        if (summary.queryEndExclusive) {
          const d = new Date(summary.queryEndExclusive + 'T00:00:00');
          d.setDate(d.getDate() - 1);
          setCutoffText(`数据截止：${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 23:59`);
        }
      }

      // Dashboard data
      if (dash.status === 'fulfilled' && dash.value) {
        const dd = dash.value;
        setDashData(dd);

        const detailPayload = mapDetails.status === 'fulfilled' ? (mapDetails.value || {}) : {};
        const detailMap = new Map();
        if (mapDetails.status === 'fulfilled' && mapDetails.value?.items) {
          mapDetails.value.items.forEach(item => detailMap.set(Number(item.shopKey), item));
        }

        const stationList = (dd.stations || []).map(s => {
          const detail = detailMap.get(Number(s.shopKey)) || {};
          return {
            ...s,
            type: 'station',
            volume: s.volume || 0,
            amount: s.amount || 0,
            cash: s.cash || 0,
            card: s.card || 0,
            bonus: s.bonus || 0,
            pts: s.bonus || 0,
            currentInventory: Number(detail.inventory || 0),
            inventoryByResource: detail.inventoryByResource || [],
            currentPrices: detail.prices || [],
            inventoryAsOf: detail.inventoryAsOf || '',
            priceAsOf: detail.priceAsOf || '',
            snapshotGeneratedAt: detail.snapshotGeneratedAt || detailPayload.snapshotGeneratedAt || '',
          };
        });
        const depotList = (dd.depots || []).map(d => ({
          ...d, type: 'depot',
          status: d.status || 'normal',
        }));

        setStations(stationList);
        setDepots(depotList);
        setRegionMap(computeRegionMap(stationList));

        // Auto-detect station status from recent sales
        try {
          const monthsList = await getMonths().catch(() => []);
          const yearStr = String(y);
          const yearMonths = (monthsList || []).filter(m => m.month && m.month.startsWith(yearStr)).map(m => m.month);
          const targetMonth = yearMonths.length > 0 ? yearMonths[yearMonths.length - 1] : null;
          if (targetMonth) {
            await updateStationStatusBySales(stationList, targetMonth);
          }
        } catch (e) { console.warn('[站点状态] 自动判定失败:', e); }
        const updatedRegionMap = computeRegionMap(stationList);
        setRegionMap(updatedRegionMap);

        // Build footer messages
        const msgs = buildFooterMessages(stationList, updatedRegionMap, dd);
        setFooterMessages(msgs);
      }
    } catch (err) {
      console.error('加载年度数据失败:', err);
    }
  }, [computeRegionMap]);

  useEffect(() => {
    if (year) loadYearData(year);
  }, [year, loadYearData]);

  // Init charts after data loads
  useEffect(() => {
    if (!dashData || stations.length === 0) return;
    const timer = setTimeout(() => {
      initAllCharts();
    }, 150);
    return () => clearTimeout(timer);
  }, [dashData]);

  // Update charts when data changes
  const updateCharts = useCallback(() => {
    if (!window.echarts) return;

    // Region bar
    const rb = regionBarChart.getInstance();
    if (rb) {
      rb.setOption({
        grid: { left: '3%', right: '3%', bottom: '3%', top: '8%', containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (p) => `${p[0]?.name}<br/>年销售金额：<b>${p[0]?.value}万索姆</b>` },
        xAxis: { type: 'category', data: REGION_ORDER, axisLabel: { show: true, color: 'rgba(200,220,240,0.7)', fontSize: 10, rotate: 30 } },
        yAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
        series: [{
          name: '年销售金额', type: 'bar',
          data: REGION_ORDER.map(r => ({
            value: parseFloat(((regionMap[r]?.amt || 0) / 10000).toFixed(2)),
            itemStyle: {
              color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: REGION_COLORS[r] },
                { offset: 1, color: REGION_COLORS[r] + '40' },
              ]),
              borderRadius: [4, 4, 0, 0],
            },
          })),
          label: { show: true, position: 'top', color: 'rgba(220,240,255,0.9)', fontSize: 10, formatter: p => p.value + '万' },
        }],
      });
      rb.off('click');
      rb.on('click', (p) => { if (p.name) navigate(`/retail/region?region=${encodeURIComponent(p.name)}`); });
    }

    // Resource rank
    const rr = resourceRankChart.getInstance();
    if (rr && dashData?.byResource) {
      const rankData = buildResourceRank(dashData.byResource);
      rr.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 60, right: 54, top: 8, bottom: 12 },
        xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } } },
        yAxis: { type: 'category', data: rankData.map(r => r.name).reverse(), axisLabel: { color: 'rgba(200,220,240,0.75)', fontSize: 10 } },
        series: [{
          type: 'bar',
          data: rankData.map(r => r.amount).reverse(),
          itemStyle: { color: '#00d4ff', borderRadius: [0, 3, 3, 0] },
          barMaxWidth: 12,
          label: { show: true, position: 'right', color: 'rgba(220,240,255,0.86)', fontSize: 10, formatter: p => (p.value / 10000).toFixed(2) + '万' },
        }],
      });
      rr.off('click');
      rr.on('click', () => navigate('/retail/resource'));
    }

    // Pay chart
    const pc = payChart.getInstance();
    if (pc) {
      const totalCash = stations.reduce((a, b) => a + (b.cash || 0), 0);
      const totalCard = stations.reduce((a, b) => a + (b.card || 0), 0);
      const totalPts = stations.reduce((a, b) => a + (b.bonus || 0), 0);
      const total = totalCash + totalCard + totalPts;
      const cashPct = total > 0 ? (totalCash / total * 100).toFixed(2) : '0.00';
      pc.setOption({
        tooltip: { trigger: 'item' },
        legend: { show: false },
        series: [{
          type: 'pie', radius: ['50%', '70%'],
          data: [
            { value: totalCash, name: '现金', itemStyle: { color: '#ffa726' } },
            { value: totalCard, name: '刷卡', itemStyle: { color: '#a78bfa' } },
            { value: totalPts, name: '积分', itemStyle: { color: '#00d4ff' } },
          ],
          label: { color: 'rgba(200,220,240,0.9)', textShadowBlur: 0 },
        }],
        graphic: [{ type: 'text', left: 'center', top: '38%', style: { text: `现金 ${cashPct}%`, fill: 'rgba(200,220,240,0.5)', fontSize: 11, textAlign: 'center' } }],
      });
    }

    // Region rank
    const rrk = regionRankChart.getInstance();
    if (rrk) {
      const sorted = [...REGION_ORDER].sort((a, b) => (regionMap[b]?.vol || 0) - (regionMap[a]?.vol || 0));
      const display = [...sorted].reverse();
      rrk.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '12%', bottom: '3%', top: '3%', containLabel: true },
        xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
        yAxis: { type: 'category', data: display, axisLabel: { show: true, color: 'rgba(210,230,245,0.82)', fontSize: 10, width: 58, overflow: 'break' } },
        series: [{
          type: 'bar',
          data: display.map(r => ({
            value: parseFloat(((regionMap[r]?.vol || 0) / 10000).toFixed(2)),
            itemStyle: {
              color: new window.echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: REGION_COLORS[r] + '20' },
                { offset: 1, color: REGION_COLORS[r] },
              ]),
              borderRadius: [0, 3, 3, 0],
            },
          })),
          label: { show: true, position: 'right', color: 'rgba(200,220,240,0.9)', fontSize: 10, formatter: p => p.value + '万升' },
        }],
      });
      rrk.off('click');
      rrk.on('click', (p) => { if (p.name) navigate(`/retail/region?region=${encodeURIComponent(p.name)}`); });
    }

    // Cash vs Card
    const cc = cashCardChart.getInstance();
    if (cc) {
      cc.setOption({
        tooltip: { trigger: 'axis' },
        legend: { show: false },
        grid: { left: '3%', right: '3%', bottom: '3%', top: '3%', containLabel: true },
        xAxis: { type: 'category', data: REGION_ORDER, axisLabel: { show: true, color: 'rgba(200,220,240,0.7)', fontSize: 10, rotate: 30 } },
        yAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
        series: [
          { name: '现金', type: 'bar', stack: 'pay', data: REGION_ORDER.map(r => ((regionMap[r]?.cash || 0) / 10000).toFixed(2)), itemStyle: { color: '#ffa726' } },
          { name: '刷卡', type: 'bar', stack: 'pay', data: REGION_ORDER.map(r => ((regionMap[r]?.card || 0) / 10000).toFixed(2)), itemStyle: { color: '#a78bfa' } },
        ],
      });
    }

    // TOP10 rank
    const rk = rankChart.getInstance();
    if (rk) {
      const top10 = [...stations].filter(s => s.status !== 'closed').sort((a, b) => b.amount - a.amount).slice(0, 10).reverse();
      rk.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '3%', bottom: '3%', top: '3%', containLabel: true },
        yAxis: { type: 'category', data: top10.map(s => s.name), axisLabel: { show: false }, splitLine: { show: false } },
        xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
        series: [{
          type: 'bar',
          data: top10.map(s => ({
            value: parseFloat((s.amount / 10000).toFixed(2)),
            itemStyle: {
              color: new window.echarts.graphic.LinearGradient(0, 0, 1, 0, [
                { offset: 0, color: (REGION_COLORS[s.region] || '#00d4ff') + '30' },
                { offset: 1, color: REGION_COLORS[s.region] || '#00d4ff' },
              ]),
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', color: 'rgba(200,220,240,0.9)', fontSize: 10, formatter: p => p.value + '万' },
        }],
      });
      rk.off('click');
      rk.on('click', (p) => { if (p.name) navigate(`/retail/station?name=${encodeURIComponent(p.name)}`); });
    }

    // Map (ECharts fallback)
    updateMapChart();

  }, [dashData, stations, regionMap]);

  // Map chart (ECharts fallback or 3D update)
  const updateMapChart = useCallback(() => {
    // If 3D map is active, update its layers
    if (retailKgzMapActiveRef.current && retailKgzMapRef.current) {
      retailKgzMapRef.current.updateLayers({
        depots: depots.filter(d => d.lng && d.lat).map(d => ({
          ...d, type: 'depot',
          size: 0.55, color: d.status === 'closed' ? '#616161' : '#ffd54f',
          opacity: 0.95, showLabel: true, label: d.name,
          labelSubtitle: d.status === 'closed' ? '停业' : '运营',
        })),
        stations: stations.filter(s => s.type === 'station' && s.lng && s.lat).map(s => {
          let color = '#34d399';
          if (s.status === 'closed') {
            color = (s.closedReason && s.closedReason.indexOf('装修') > -1) ? '#ef5350' : '#9e9e9e';
          }
          return {
            ...s, type: 'station',
            size: 0.28, color, opacity: 0.95,
            showLabel: true, label: s.name,
            labelSubtitle: s.short || '',
            inventory: s.currentInventory,
            inventoryByResource: s.inventoryByResource,
            inventoryAsOf: s.inventoryAsOf,
            snapshotGeneratedAt: s.snapshotGeneratedAt,
          };
        }),
        points: []
      });
      return;
    }

    // ECharts fallback
    if (!window.echarts) return;
    const mc = mapChart.getInstance();
    if (!mc) return;

    const scatterData = stations
      .filter(s => s.type === 'station' && s.lng && s.lat)
      .map(s => {
        let color = '#00e5a0';
        if (s.status === 'closed') {
          if (s.closedReason && s.closedReason.indexOf('装修') > -1) color = '#ff5252';
          else color = '#9e9e9e';
        }
        return { name: s.name, value: [s.lng, s.lat, s.amount], itemStyle: { color } };
      });

    const depotData = depots
      .filter(d => d.lng && d.lat)
      .map(d => ({
        name: d.name, value: [d.lng, d.lat],
        itemStyle: { color: d.status === 'closed' ? '#616161' : '#ffd54f' },
      }));

    mc.setOption({
      series: [
        { data: scatterData },
        { data: depotData },
      ],
    });
  }, [stations, depots]);

  // Init 3D map
  const initRetail3DMap = useCallback(async () => {
    if (retailKgzMapActiveRef.current && retailKgzMapRef.current) return true;
    retailKgzMapActiveRef.current = false;
    if (window.USE_3D_KGZ_MAP === false) return false;
    try {
      const runtimeImport = (url) => new Function('url', 'return import(url)')(url);
      const { mountRetailMap } = await runtimeImport('/assets/kgz-map/kgz-map-entry.js?v=20260722-uniform-region');
      const map = await mountRetailMap('#mapChart', { depots: [], stations: [] }, {
        showRoadPanel: false, showLakeLabels: true, showCities: true,
        showRegionLabels: false, showLegend: false, mode: 'retail',
        initialCamera: { cameraX: -2.35, cameraY: 24.77, cameraZ: 38.2, targetX: -2.35, targetY: 0.33, targetZ: 3.95 },
        fallback(error) {
          retailKgzMapRef.current = null;
          retailKgzMapActiveRef.current = false;
          console.warn('[Kgz3DMap] retail fallback to ECharts:', error);
        }
      });
      retailKgzMapActiveRef.current = !!map;
      retailKgzMapRef.current = map;
      if (map) window.__map3d = map;
      return retailKgzMapActiveRef.current;
    } catch (err) {
      retailKgzMapRef.current = null;
      retailKgzMapActiveRef.current = false;
      console.warn('[Kgz3DMap] retail import failed, fallback to ECharts:', err);
      return false;
    }
  }, []);

  // Init all charts
  const initAllCharts = useCallback(async () => {
    if (!window.echarts) return;

    // Try 3D map first
    const mapUsing3D = await initRetail3DMap();

    // Register ECharts map (for fallback)
    fetch('/assets/kgz_merged.json')
      .then(r => r.json())
      .then(geojson => {
        if (!window.echarts.getMap('kyrgyzstan')) {
          window.echarts.registerMap('kyrgyzstan', geojson);
        }
      })
      .catch(() => {});

    // Region bar
    regionBarChart.init('regionBarChart');
    // Init ECharts map instance (used as fallback or if 3D not available)
    if (!mapUsing3D) {
      const mc = mapChart.init('mapChart');
      if (mc) {
        mc.setOption({
          geo: {
            map: 'kyrgyzstan', roam: true,
            scaleLimit: { min: 1, max: 5 },
            itemStyle: { areaColor: 'rgba(10,30,60,0.8)', borderColor: 'rgba(0,212,255,0.8)', borderWidth: 1.5 },
            emphasis: { itemStyle: { areaColor: 'rgba(0,212,255,0.4)', borderColor: 'rgba(0,255,255,1)' }, label: { show: false } },
          },
          series: [
            { type: 'effectScatter', coordinateSystem: 'geo', name: '加油站', data: [], symbolSize: 10, zlevel: 10 },
            { type: 'effectScatter', coordinateSystem: 'geo', name: '油库', data: [], symbol: 'diamond', symbolSize: 18, zlevel: 11 },
          ],
          tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(5,10,25,0.98)',
            borderColor: 'transparent', borderWidth: 0,
            textStyle: { color: '#e0e8f5', fontSize: 12 },
          },
        });
      }
    }

    // Rank
    rankChart.init('rankChart');
    // Resource rank
    resourceRankChart.init('resourceRankChart');
    // Pay
    payChart.init('payChart');
    // Region rank
    regionRankChart.init('regionRankChart');
    // Cash card
    cashCardChart.init('cashCardChart');

    // After init, update data
    setTimeout(() => updateCharts(), 100);
    // Expose 3D map for console debugging
    setTimeout(() => {
      if (retailKgzMapRef.current) {
        window.__map3d = retailKgzMapRef.current;
      }
    }, 500);
  }, [updateCharts, initRetail3DMap]);

  // Resize
  useEffect(() => {
    const handleResize = () => {
      retailKgzMapRef.current?.resize?.();
      [regionBarChart, mapChart, rankChart, resourceRankChart, payChart, regionRankChart, cashCardChart]
        .forEach(c => c.getInstance()?.resize());
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      retailKgzMapRef.current?.destroy?.();
      delete window.__map3d;
    };
  }, []);

  const resizeRetailMap = useCallback(() => {
    retailKgzMapRef.current?.resize?.();
    mapChart.getInstance()?.resize();
  }, [mapChart]);

  const scheduleRetailMapResize = useCallback(() => {
    window.setTimeout(resizeRetailMap, 60);
    window.setTimeout(resizeRetailMap, 240);
  }, [resizeRetailMap]);

  const toggleRetailMapFullscreen = useCallback(async () => {
    const shell = retailMapShellRef.current;
    if (!shell || !document.fullscreenEnabled) return;
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setRetailMapFullscreen(document.fullscreenElement === retailMapShellRef.current);
      scheduleRetailMapResize();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && document.fullscreenElement === retailMapShellRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [scheduleRetailMapResize]);

  // Report generation
  const handleReport = async () => {
    const btn = document.getElementById('genYearReportBtn');
    if (btn) btn.disabled = true;
    try {
      const data = await generateYearlyReport(year);
      download(data.docxDownloadUrl);
      download(data.htmlDownloadUrl);
    } catch (err) {
      alert(err.message || '年度分析报告生成失败');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  const summary = kpi?.summary || {};
  const cmp = kpi?.comparison || {};

  // 计算所有站点日快照库存合计
  const totalStationInventory = stations.reduce((sum, s) => sum + (s.currentInventory || 0), 0);

  return (
    <>
      <main className="retail-dashboard">
        {/* ===== 左侧面板 ===== */}
        <aside className="retail-left">
          <div className="retail-year-bar">
            <select value={year || ''} onChange={e => setYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y} 年</option>)}
            </select>
            <button className="retail-report-btn" id="genYearReportBtn" onClick={handleReport}>生成年度分析报告</button>
          </div>

          <div className="retail-panel">
            <div className="retail-panel-header"><div className="dot" />核心经营指标（{year}年累计）</div>
            <div className="retail-kpi-grid">
              <div className="retail-kpi-card c1">
                <div className="kpi-icon">💰</div>
                <div className="kpi-label">累计销售总金额</div>
                <div className="kpi-value">{((summary.totalSales || 0) / 1e8).toFixed(2)}</div>
                <div className="kpi-unit">亿索姆（COM）</div>
                <div className="kpi-change" style={{ color: pctColor(cmp.yoySales) }}>
                  {cmp.yoySales != null ? `同比 ${fmtPct(cmp.yoySales)}` : ''}
                </div>
              </div>
              <div className="retail-kpi-card c2">
                <div className="kpi-icon">⛽</div>
                <div className="kpi-label">累计销售总量</div>
                <div className="kpi-value">{((summary.totalLiters || 0) / 1e4).toFixed(2)}</div>
                <div className="kpi-unit">万升（Л）</div>
                <div className="kpi-change" style={{ color: pctColor(cmp.yoyVolume) }}>
                  {cmp.yoyVolume != null ? `同比 ${fmtPct(cmp.yoyVolume)}` : ''}
                </div>
              </div>
              <div className="retail-kpi-card c3">
                <div className="kpi-icon">🏪</div>
                <div className="kpi-label">活跃加油站</div>
                <div className="kpi-value">{summary.activeShops || 0}</div>
                <div className="kpi-unit">站（共 28 站，不含油库）</div>
              </div>
              <div className="retail-kpi-card c4">
                <div className="kpi-icon">📦</div>
                <div className="kpi-label">期末库存总量</div>
                <div className="kpi-value">{totalStationInventory > 0 ? fmtWanLiters(totalStationInventory, 2) : ((summary.inventory || summary.totalInventory) ? fmtWanLiters(summary.inventory ?? summary.totalInventory, 2) : '--')}</div>
                <div className="kpi-unit">万升（Л）</div>
              </div>
            </div>
            <div style={{ padding: '0 12px 4px', color: 'rgba(160,180,210,0.6)', fontSize: 10 }}>{cutoffText}</div>
          </div>

          <div className="retail-panel retail-chart-container">
            <div className="retail-panel-header"><div className="dot" />各区域年销售金额</div>
            <div className="panel-body"><div id="regionBarChart" /></div>
          </div>
        </aside>

        {/* ===== 中央区域 ===== */}
        <section className="retail-center">
          <div className="retail-panel retail-map-panel">
            <div className="retail-panel-header">
              <div className="dot" />吉尔吉斯斯坦 · 加油站年销售热力
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(160,180,210,0.35)' }}>点击区域查看详情 · 滚轮缩放</span>
            </div>
            <div className="panel-body">
              <div className="retail-map-stage" ref={retailMapShellRef}>
                {document.fullscreenEnabled && !retailMapFullscreen && (
                  <button
                    type="button"
                    className="map-fullscreen-btn"
                    title={retailMapFullscreen ? '退出全屏' : '全屏'}
                    aria-label={retailMapFullscreen ? '退出全屏' : '全屏'}
                    onClick={toggleRetailMapFullscreen}
                  >
                    {retailMapFullscreen ? '×' : '⛶'}
                  </button>
                )}
                <div id="mapChart" />
              </div>
            </div>
          </div>
          <div className="retail-panel retail-rank-panel">
            <div className="retail-panel-header"><div className="dot" />加油站年销售金额 TOP10</div>
            <div className="panel-body"><div id="rankChart" /></div>
          </div>
        </section>

        {/* ===== 右侧面板 ===== */}
        <aside className="retail-right">
          <div className="retail-panel chart-box">
            <div className="retail-panel-header"><div className="dot" />油品销售金额排行</div>
            <div className="panel-body"><div id="resourceRankChart" /></div>
          </div>
          <div className="retail-panel chart-box">
            <div className="retail-panel-header"><div className="dot" />支付方式分布<span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'rgba(200,220,240,0.85)' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffa726' }} /> 现金<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#a78bfa' }} /> 刷卡<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#00d4ff' }} /> 积分</span></div>
            <div className="panel-body"><div id="payChart" /></div>
          </div>
          <div className="retail-panel chart-box">
            <div className="retail-panel-header"><div className="dot" />各区域年销售量排行</div>
            <div className="panel-body"><div id="regionRankChart" /></div>
          </div>
          <div className="retail-panel chart-box">
            <div className="retail-panel-header"><div className="dot" />年现金 vs 刷卡（按区域）<span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'rgba(200,220,240,0.85)' }}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#ffa726' }} /> 现金<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#a78bfa' }} /> 刷卡</span></div>
            <div className="panel-body"><div id="cashCardChart" /></div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="retail-footer">
        <div className="retail-footer-label">📋 实时动态</div>
        <div className="retail-footer-scroll">
          <div className="retail-footer-inner">
            {(footerMessages.length > 0 ? [...footerMessages, ...footerMessages] : ['正在加载...']).map((msg, i) => (
              <span key={i}>{msg}</span>
            ))}
          </div>
        </div>
      </footer>
    </>
  );
}

// Build footer messages
function buildFooterMessages(stations, regionMap, monthlyData) {
  const totalVol = stations.filter(s => s.type === 'station').reduce((a, b) => a + b.volume, 0);
  const totalAmt = stations.filter(s => s.type === 'station').reduce((a, b) => a + b.amount, 0);
  const activeCount = stations.filter(s => s.type === 'station' && s.status !== 'closed').length;
  const totalCash = stations.reduce((a, b) => a + (b.cash || 0), 0);
  const totalCard = stations.reduce((a, b) => a + (b.card || 0), 0);
  const totalPts = stations.reduce((a, b) => a + (b.bonus || 0), 0);
  const paymentTotal = totalCash + totalCard + totalPts;

  const stationRows = stations.filter(s => s.type === 'station');
  const leader = stationRows.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
  const regionLeader = Object.entries(regionMap || {})
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.vol || 0) - (a.vol || 0))[0];
  const resourceLeader = buildResourceRank(monthlyData?.byResource || [])[0];
  const dailyRows = (monthlyData?.daily || []).filter(d => (d.volume || 0) > 0);
  const latestDay = dailyRows[dailyRows.length - 1];
  const prevDay = dailyRows[dailyRows.length - 2];

  const messages = [];
  if (latestDay) {
    const latestVol = Number(latestDay.volume || 0);
    let text = `${String(latestDay.date || '').slice(5)} 最新销量 ${latestVol.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L`;
    if (prevDay && prevDay.volume) {
      const change = ((latestVol - prevDay.volume) / prevDay.volume) * 100;
      text += `，较上一销售日${change >= 0 ? '增长' : '下降'} ${Math.abs(change).toFixed(1)}%`;
    }
    messages.push(text);
  }
  if (leader) {
    messages.push(`${leader.short || leader.name} 当前销量领先，累计 ${Number(leader.volume || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L`);
  }
  if (regionLeader) {
    messages.push(`${regionLeader.name} 区域销量 ${Number(regionLeader.vol || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L，区域表现居前`);
  }
  if (resourceLeader) {
    messages.push(`${resourceLeader.name} 油品销售额居首，累计 ${Number(resourceLeader.amount || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 索姆`);
  }
  if (paymentTotal > 0) {
    messages.push(`现金占比 ${((totalCash / paymentTotal) * 100).toFixed(1)}%，刷卡占比 ${((totalCard / paymentTotal) * 100).toFixed(1)}%`);
  }
  messages.push(`当前参与统计加油站 ${activeCount} 座，累计销售 ${Number(totalVol || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L，金额 ${Number(totalAmt || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 索姆`);
  return messages;
}

// ── 根据销售数据自动判定站点状态 ──
// 规则：API 已标记 closed 的站点，根据历史销售判定原因（装修停业 / 长期无销售）
async function updateStationStatusBySales(stations, currentMonth) {
  try {
    const [year, month] = currentMonth.split('-').map(Number);
    const monthsToCheck = [];
    for (let i = 1; i <= 3; i++) {
      let m = month - i, y = year;
      if (m <= 0) { m += 12; y -= 1; }
      monthsToCheck.push(`${y}-${String(m).padStart(2, '0')}`);
    }

    const historyData = {};
    for (const m of monthsToCheck) {
      try {
        const res = await getStations(m);
        const stationMap = {};
        (res.stations || []).forEach(s => { stationMap[s.shopKey] = s.amount || 0; });
        historyData[m] = stationMap;
      } catch { /* 历史月份可能无数据 */ }
    }

    stations.forEach(s => {
      const shopKey = s.shopKey;
      const currentAmount = s.amount || 0;
      if (s.status === 'closed') {
        if (currentAmount > 0) {
          s.closedReason = s.closedReason || '装修停业';
        } else {
          let hasHistorySales = false;
          monthsToCheck.forEach(m => {
            if (historyData[m] && historyData[m][shopKey] > 0) hasHistorySales = true;
          });
          s.closedReason = s.closedReason || (hasHistorySales ? '装修停业' : '长期无销售');
        }
      } else {
        s.status = 'normal';
        s.closedReason = '';
      }
    });
  } catch (e) {
    console.warn('[站点状态] 更新失败:', e);
  }
}
