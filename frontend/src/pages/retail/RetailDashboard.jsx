// src/pages/retail/RetailDashboard.jsx — 零售仪表板
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getYears, getMonths, getDashboardYearly, getKpiYearly, getStationMapDetails, getStations, getMonthlyData, generateYearlyReport } from '../../api/retail';
import { localizeMapPoint } from '@shared/map-labels';
import { download } from '../../api/client';
import { useChart } from '../../hooks/useChart';
import RetailKpiCompare from '../../components/retail/RetailKpiCompare';
import {
  REGION_COLORS, REGION_ORDER,
  fmtNum, fmtWanLiters, fmtLiters,
  buildResourceRank,
  amountCnyOf,
  formatCnyKpi,
  formatLitersKpiParts,
  formatRetailMonthLabel,
  formatSomKpiParts,
  formatTonsKpi,
  latestRetailMonthForYear,
  normalizeRetailYears,
  retailTonsOf,
  sortRankingRows,
} from '../../utils/retail-helpers';

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function hasSalesRecord(item) {
  return (
    numeric(item?.amount ?? item?.totalSales) > 0
    || numeric(item?.volume ?? item?.totalLiters) > 0
    || numeric(item?.txnCount) > 0
    || retailTonsOf(item) > 0
  );
}

function stationRowsOf(stations = []) {
  return (stations || []).filter(s => s.type === 'station');
}

function isKnownClosedStation(item) {
  const shopKey = Number(item?.shopKey);
  if (ZERO_INVENTORY_STATION_KEYS.has(shopKey)) return true;
  const reason = String(item?.closedReason || item?.inventoryZeroReason || item?.statusNote || '').trim();
  const label = String(item?.statusLabel || '').trim();
  const status = String(item?.statusType || item?.status || '').toLowerCase();
  const closedText = `${reason} ${label}`;
  if (/(停业|暂停|关闭|无法营业|装修)/.test(closedText)) return true;
  return ['inactive', 'suspended'].includes(status) || (status === 'closed' && Boolean(reason || label));
}

function countOperatingStations(stations = []) {
  return stationRowsOf(stations).filter(s => !isKnownClosedStation(s)).length;
}

function stationDisplayName(item) {
  const name = String(item?.name || '').trim();
  const short = String(item?.short || '').trim();
  if (name && short && short !== name) return `${name}（${short}）`;
  return name || short || '--';
}

const CORE_DEPOTS = [
  { name: 'STN-61', short: 'Главная нефтебаза', region: 'REG-01', lng: 0, lat: 0, type: 'headquarters', status: 'normal' },
  { name: 'DemoDepotNorth', short: 'Север DemoDepot', region: 'REG-08', lng: 0, lat: 0, type: 'depot', status: 'closed', closedReason: '装修停业' },
  { name: 'DemoDepotSouth', short: 'Юж DemoDepot', region: 'REG-07', lng: 0, lat: 0, type: 'depot', status: 'normal' },
];

const ZERO_INVENTORY_STATION_KEYS = new Set([11, 12, 21]);

function mapZeroInventoryDetail(detail, shopKey) {
  if (!ZERO_INVENTORY_STATION_KEYS.has(Number(shopKey))) return detail || {};
  const rows = (detail?.inventoryByResource || []).map((row) => {
    const capacity = Number(row?.capacity || 0);
    return {
      ...row,
      inventory: 0,
      fillPercent: row?.fillPercent !== undefined || capacity > 0 ? 0 : row?.fillPercent,
      fillStatus: capacity > 0 ? 'critical' : (row?.fillStatus || 'unknown'),
    };
  });
  const capacity = Number(detail?.inventoryCapacity || 0);
  return {
    ...(detail || {}),
    inventory: 0,
    inventoryByResource: rows,
    inventoryFillPercent: capacity > 0 ? 0 : detail?.inventoryFillPercent,
    inventoryFillStatus: capacity > 0 ? 'critical' : (detail?.inventoryFillStatus || 'unknown'),
    inventoryZeroedByMapRule: true,
    inventoryZeroReason: detail?.closedReason || '停业，库存清零',
  };
}

function depotKey(depot) {
  const name = String(depot?.name || depot?.label || '');
  if (depot?.type === 'headquarters' || name.includes('总部') || name.includes('公司总部')) return 'hq';
  if (name.includes('北方')) return 'north';
  if (name.includes('南方')) return 'south';
  return name;
}

function ensureCoreDepots(depots = []) {
  const list = Array.isArray(depots) ? [...depots] : [];
  const keys = new Set(list.map(depotKey));
  CORE_DEPOTS.forEach((depot) => {
    if (!keys.has(depotKey(depot))) list.push(depot);
  });
  return list;
}

function normalizeDepotMarker(depot) {
  const rawName = String(depot?.name || depot?.nameRu || '');
  const isHeadquarters = depot?.type === 'headquarters' || rawName.includes('总部') || rawName.includes('公司总部');
  const name = rawName === '公司总部' ? 'STN-61' : rawName;
  return {
    ...depot,
    type: 'depot',
    depotType: isHeadquarters ? 'headquarters' : 'branch',
    name,
    label: name,
    short: depot?.short || depot?.nameRu || '',
    status: depot?.status || 'normal',
    size: isHeadquarters ? 0.26 : 0.22,
    y: isHeadquarters ? 3.48 : 3.12,
    renderOrder: 176,
    color: isHeadquarters ? '#38bdf8' : '#facc15',
    anchorColor: isHeadquarters ? '#7dd3fc' : '#fde68a',
    anchorOpacity: 0.78,
    pinLine: true,
    opacity: 0.98,
    hoverScale: 2.25,
    hoverLift: 0.24,
    showLabel: false,
    labelSubtitle: depot?.short || depot?.region || '',
  };
}

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
  const [latestStationActivity, setLatestStationActivity] = useState({ month: '', active: null, total: null, operating: null });
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
      const options = normalizeRetailYears(list);
      setYears(options);
      if (options.length > 0) {
        const y = options[0];
        setYear(y);
      }
    }).catch(() => {
      const options = normalizeRetailYears([]);
      setYears(options);
      if (options.length > 0) setYear(options[0]);
    });
  }, []);

  // Compute region map from stations
  const computeRegionMap = useCallback((stationList) => {
    const rm = {};
    REGION_ORDER.forEach(name => {
      rm[name] = { stations: [], vol: 0, tons: 0, amt: 0, cash: 0, card: 0, pts: 0 };
    });
    stationList.filter(s => s.type === 'station').forEach(s => {
      const r = rm[s.region];
      if (r) {
        r.stations.push(s);
        r.vol += s.volume || 0;
        r.tons += retailTonsOf(s);
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
          const detail = mapZeroInventoryDetail(detailMap.get(Number(s.shopKey)) || {}, s.shopKey);
          const status = s.status || (ZERO_INVENTORY_STATION_KEYS.has(Number(s.shopKey)) ? 'closed' : 'normal');
          const closedReason = s.closedReason || detail.closedReason || (ZERO_INVENTORY_STATION_KEYS.has(Number(s.shopKey)) ? '停业，库存清零' : '');
          return {
            ...s,
            type: 'station',
            status,
            closedReason,
            volume: s.volume || 0,
            amount: s.amount || 0,
            cash: s.cash || 0,
            card: s.card || 0,
            bonus: s.bonus || 0,
            pts: s.bonus || 0,
            inventory: Number(detail.inventory || 0),
            currentInventory: Number(detail.inventory || 0),
            inventoryCapacity: Number(detail.inventoryCapacity || 0),
            inventoryFillPercent: detail.inventoryFillPercent,
            inventoryFillStatus: detail.inventoryFillStatus,
            inventoryAlert: detail.inventoryAlert,
            inventoryAlerts: detail.inventoryAlerts || [],
            inventoryByResource: detail.inventoryByResource || [],
            currentPrices: detail.prices || [],
            inventoryAsOf: detail.inventoryAsOf || '',
            priceAsOf: detail.priceAsOf || '',
            statusLabel: detail.statusLabel || (status === 'closed' ? '停业' : '在营'),
            statusType: detail.statusType || status,
            statusNote: detail.statusNote || '',
            snapshotGeneratedAt: detail.snapshotGeneratedAt || detailPayload.snapshotGeneratedAt || '',
            inventoryZeroedByMapRule: Boolean(detail.inventoryZeroedByMapRule),
            inventoryZeroReason: detail.inventoryZeroReason || '',
          };
        });
        const depotSource = Array.isArray(dd.depots) && dd.depots.length
          ? dd.depots
          : detailPayload.depots || [];
        const depotList = ensureCoreDepots(depotSource).map(normalizeDepotMarker);

        setStations(stationList);
        setDepots(depotList);
        setRegionMap(computeRegionMap(stationList));

        // Auto-detect station status from recent sales
        let latestMonthData = null;
        let latestActivity = {
          month: '',
          active: null,
          total: stationRowsOf(stationList).length,
          operating: countOperatingStations(stationList),
        };
        try {
          const monthsList = await getMonths().catch(() => []);
          const targetMonth = latestRetailMonthForYear(monthsList, y);
          if (targetMonth) {
            await updateStationStatusBySales(stationList, targetMonth);
            const [monthStationsResult, latestMonthDataResult] = await Promise.allSettled([
              getStations(targetMonth),
              getMonthlyData(targetMonth),
            ]);
            if (latestMonthDataResult.status === 'fulfilled') {
              latestMonthData = latestMonthDataResult.value || null;
            }
            try {
              if (monthStationsResult.status !== 'fulfilled') throw monthStationsResult.reason || new Error('latest month stations unavailable');
              const monthStations = monthStationsResult.value;
              const stationRows = Array.isArray(monthStations?.stations) ? monthStations.stations : [];
              latestActivity = {
                month: targetMonth,
                active: stationRows.filter(hasSalesRecord).length,
                total: stationRows.length || stationRowsOf(stationList).length,
                operating: countOperatingStations(stationList),
              };
              setLatestStationActivity(latestActivity);
            } catch (e) {
              latestActivity = {
                month: targetMonth,
                active: null,
                total: stationRowsOf(stationList).length,
                operating: countOperatingStations(stationList),
              };
              setLatestStationActivity(latestActivity);
            }
          } else {
            setLatestStationActivity(latestActivity);
          }
        } catch (e) { console.warn('[站点状态] 自动判定失败:', e); }
        const updatedRegionMap = computeRegionMap(stationList);
        setRegionMap(updatedRegionMap);

        // Build footer messages
        const msgs = buildFooterMessages(stationList, updatedRegionMap, dd, latestActivity, latestMonthData);
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
        yAxis: { type: 'category', inverse: true, data: rankData.map(r => r.name), axisLabel: { color: 'rgba(200,220,240,0.75)', fontSize: 10 } },
        series: [{
          type: 'bar',
          data: rankData.map(r => r.amount),
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
      const display = sortRankingRows(REGION_ORDER, r => regionMap[r]?.vol);
      rrk.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '12%', bottom: '3%', top: '3%', containLabel: true },
        xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
        yAxis: { type: 'category', inverse: true, data: display, axisLabel: { show: true, color: 'rgba(210,230,245,0.82)', fontSize: 10, width: 58, overflow: 'break' } },
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
      const top10 = sortRankingRows(stations.filter(s => s.status !== 'closed'), s => s.amount, 10);
      rk.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '3%', bottom: '3%', top: '3%', containLabel: true },
        yAxis: { type: 'category', inverse: true, data: top10.map(s => s.name), axisLabel: { show: false }, splitLine: { show: false } },
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

  }, [dashData, stations, regionMap, depots]);

  // Map chart (ECharts fallback or 3D update)
  const updateMapChart = useCallback(() => {
    // If 3D map is active, update its layers
    if (retailKgzMapActiveRef.current && retailKgzMapRef.current) {
      retailKgzMapRef.current.updateLayers({
        depots: ensureCoreDepots(depots).filter(d => d.lng && d.lat).map(d => localizeMapPoint(normalizeDepotMarker(d), 'zh')),
        stations: stations.filter(s => s.type === 'station' && s.lng && s.lat).map(s => {
          const ls = localizeMapPoint(s, 'zh');
          let color = '#34d399';
          if (ls.status === 'closed') {
            color = '#ef4444';
          }
          return {
            ...ls, type: 'station',
            size: 0.28, color, opacity: 0.95,
            showLabel: true, label: ls.name,
            labelSubtitle: ls.short || '',
            inventory: ls.currentInventory,
            inventoryByResource: ls.inventoryByResource,
            inventoryAsOf: ls.inventoryAsOf,
            snapshotGeneratedAt: ls.snapshotGeneratedAt,
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
          color = '#ef4444';
        }
        return { name: s.name, value: [s.lng, s.lat, s.amount], itemStyle: { color } };
      });

    const depotData = ensureCoreDepots(depots)
      .filter(d => d.lng && d.lat)
      .map(d => {
        const marker = localizeMapPoint(normalizeDepotMarker(d), 'zh');
        return {
          name: marker.name,
          value: [marker.lng, marker.lat, 0],
          symbolSize: marker.depotType === 'headquarters' ? 12 : 10,
          itemStyle: { color: marker.color },
        };
      });

    mc.setOption({
      series: [
        { data: scatterData },
        { data: depotData },
      ],
    });
  }, [stations, depots]);

  useEffect(() => {
    if (!dashData || stations.length === 0) return;
    updateMapChart();
  }, [dashData, stations, depots, updateMapChart]);

  // Init 3D map
  const initRetail3DMap = useCallback(async () => {
    if (retailKgzMapActiveRef.current && retailKgzMapRef.current) return true;
    retailKgzMapActiveRef.current = false;
    if (window.USE_3D_KGZ_MAP === false) return false;
    try {
      const runtimeImport = (url) => import(/* @vite-ignore */ url);
      const { mountRetailMap } = await runtimeImport('/assets/kgz-map/kgz-map-entry.js?v=20260801-hover-hit');
      const map = await mountRetailMap('#mapChart', { depots: ensureCoreDepots(depots).map(d => localizeMapPoint(normalizeDepotMarker(d), 'zh')), stations: [] }, {
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
            { type: 'effectScatter', coordinateSystem: 'geo', name: '油库', data: [], symbol: 'diamond', symbolSize: 9, zlevel: 11 },
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
  const totalTons = retailTonsOf(summary)
    || (dashData?.byResource || []).reduce((sum, row) => sum + retailTonsOf(row), 0)
    || stations.reduce((sum, row) => sum + retailTonsOf(row), 0);
  const totalSalesKpi = formatSomKpiParts(summary.totalSales || summary.totalAmount || 0);
  const totalLitersKpi = formatLitersKpiParts(summary.totalLiters || summary.totalVolume || 0);
  const totalSalesCny = amountCnyOf(summary);
  const latestActiveCount = latestStationActivity.active ?? stationRowsOf(stations).filter(hasSalesRecord).length;
  const operatingStationCount = latestStationActivity.operating ?? countOperatingStations(stations);
  const latestActivityMonth = formatRetailMonthLabel(latestStationActivity.month, '最新月份');

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
              <div className="retail-kpi-card kpi-card-with-compare c1">
                <div className="retail-kpi-main">
                  <div className="kpi-icon">💰</div>
                  <div className="kpi-label">累计销售总金额</div>
                  <div className="kpi-value">{totalSalesKpi.value}</div>
                  <div className="kpi-unit">{totalSalesKpi.unit}</div>
                  <div className="kpi-change">人民币 {formatCnyKpi(totalSalesCny)}</div>
                </div>
                <RetailKpiCompare items={[
                  { label: '环比', value: cmp.momSales ?? cmp.momSalesAmount },
                  { label: '同比', value: cmp.yoySales ?? cmp.yoySalesAmount },
                ]} />
              </div>
              <div className="retail-kpi-card kpi-card-with-compare c2">
                <div className="retail-kpi-main">
                  <div className="kpi-icon">⛽</div>
                  <div className="kpi-label">累计销售总量</div>
                  <div className="kpi-value">{totalLitersKpi.value}</div>
                  <div className="kpi-unit">{totalLitersKpi.unit}</div>
                  <div className="kpi-change">吨位 {formatTonsKpi(totalTons)}</div>
                </div>
                <RetailKpiCompare items={[
                  { label: '环比', value: cmp.momVolume },
                  { label: '同比', value: cmp.yoyVolume },
                ]} />
              </div>
              <div className="retail-kpi-card c3">
                <div className="kpi-icon">🏪</div>
                <div className="kpi-label">有销售站点</div>
                <div className="kpi-value">{latestActiveCount}</div>
                <div className="kpi-unit">站（{latestActivityMonth}；当前在营{operatingStationCount}站）</div>
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
        <div className="retail-footer-label">📋 零售动态</div>
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
function buildFooterMessages(stations, regionMap, dashboardData, latestActivity = {}, latestMonthData = null) {
  const stationRows = stationRowsOf(stations);
  const totalVol = stationRows.reduce((a, b) => a + b.volume, 0);
  const totalAmt = stationRows.reduce((a, b) => a + b.amount, 0);
  const activeCount = latestActivity.active ?? stationRows.filter(hasSalesRecord).length;
  const operatingCount = latestActivity.operating ?? countOperatingStations(stations);
  const latestMonthText = formatRetailMonthLabel(latestActivity.month, '最新月份');
  const totalCash = stations.reduce((a, b) => a + (b.cash || 0), 0);
  const totalCard = stations.reduce((a, b) => a + (b.card || 0), 0);
  const totalPts = stations.reduce((a, b) => a + (b.bonus || 0), 0);
  const paymentTotal = totalCash + totalCard + totalPts;

  const leaderRows = stationRows.filter(s => !isKnownClosedStation(s) && hasSalesRecord(s));
  const leaderSource = leaderRows.length ? leaderRows : stationRows;
  const leader = leaderSource.slice().sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
  const regionLeader = Object.entries(regionMap || {})
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.vol || 0) - (a.vol || 0))[0];
  const resourceLeader = buildResourceRank(dashboardData?.byResource || [])[0];
  const latestDailyRows = latestMonthData?.daily || dashboardData?.daily || [];
  const dailyRows = latestDailyRows
    .filter(d => (d.volume || 0) > 0)
    .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));
  const latestDay = dailyRows[dailyRows.length - 1];
  const prevDay = dailyRows[dailyRows.length - 2];

  const messages = [];
  if (latestDay) {
    const latestVol = Number(latestDay.volume || 0);
    let text = `${String(latestDay.date || '').slice(5)} 最新销售日销量 ${latestVol.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L`;
    if (prevDay && prevDay.volume) {
      const change = ((latestVol - prevDay.volume) / prevDay.volume) * 100;
      text += `，较上一销售日${change >= 0 ? '增长' : '下降'} ${Math.abs(change).toFixed(1)}%`;
    }
    messages.push(text);
  }
  if (leader) {
    messages.push(`${stationDisplayName(leader)} 年累计销量领先，累计 ${Number(leader.volume || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L`);
  }
  if (regionLeader) {
    messages.push(`${regionLeader.name} 年累计区域销量 ${Number(regionLeader.vol || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L，区域表现居前`);
  }
  if (resourceLeader) {
    messages.push(`${resourceLeader.name} 年累计油品销售额居首，累计 ${Number(resourceLeader.amount || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 索姆`);
  }
  if (paymentTotal > 0) {
    const paymentParts = [
      `现金 ${((totalCash / paymentTotal) * 100).toFixed(1)}%`,
      `刷卡 ${((totalCard / paymentTotal) * 100).toFixed(1)}%`,
    ];
    if (totalPts > 0) {
      paymentParts.push(`积分 ${((totalPts / paymentTotal) * 100).toFixed(1)}%`);
    }
    messages.push(`年累计支付方式：${paymentParts.join('，')}`);
  }
  messages.push(`当前在营加油站 ${operatingCount} 座，${latestMonthText}有销售站点 ${activeCount} 座，年累计销售 ${Number(totalVol || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} L，金额 ${Number(totalAmt || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 索姆`);
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
