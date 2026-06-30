// src/pages/retail/ResourcePage.jsx — 油品分析
import { useState, useEffect } from 'react';
import { useChart } from '../../hooks/useChart';
import { getYears, getMonths, getResourcesYearly } from '../../api/retail';
import {
  amountCnyOf,
  formatCnyKpi,
  formatLitersKpiParts,
  formatSomKpiParts,
  formatTonsKpi,
  numberFormat,
  volumeFormat,
  pctColor,
  sortRankingRows,
} from '../../utils/retail-helpers';
import { useRetailHeader } from '../../components/layout/RetailHeaderContext';

const RESOURCE_ORDER = [102, 103, 104, 106, 110, 108];
const RESOURCE_ALIASES = { 109: 106 };
const RESOURCE_NAMES = { 102: 'АИ 80', 103: 'АИ 92', 104: 'АИ 95', 106: 'Д/Т', 108: 'СПБТ', 110: 'ДТ -35' };
const RESOURCE_COLORS = { 102: '#00e5a0', 103: '#00d4ff', 104: '#a78bfa', 106: '#ffa726', 108: '#ff6b6b', 110: '#ff8a65' };

const darkTooltip = { backgroundColor: 'rgba(10,20,50,0.9)', borderColor: 'rgba(0,180,255,0.3)', textStyle: { color: '#e0e8f5', fontSize: 11 } };

function numeric(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function tonsOf(item) {
  const tons = numeric(item?.totalTons ?? item?.tons ?? item?.latestMonthTons);
  if (tons > 0) return tons;
  const mass = numeric(item?.mass ?? item?.totalWeightKg ?? item?.latestMonthMass);
  return mass > 0 ? mass / 1000 : 0;
}

function formatTons(value) {
  return numeric(value).toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function normalizeResources(rows) {
  const buckets = new Map();
  (rows || []).forEach(row => {
    const rawKey = Number(row.resourceKey ?? row.key ?? 0);
    const key = RESOURCE_ALIASES[rawKey] || rawKey;
    if (!RESOURCE_NAMES[key]) return;
    const cur = buckets.get(key) || { resourceKey: key, key, name: RESOURCE_NAMES[key], volume: 0, tons: 0, mass: 0, amount: 0, amountCnyAvg: 0, color: RESOURCE_COLORS[key], yoyVolumeParts: [], yoySalesParts: [], momVolumeParts: [], momSalesParts: [], latestMonthVolume: 0, latestMonthAmount: 0 };
    const rowTons = tonsOf(row);
    const rowMass = numeric(row.mass ?? row.latestMonthMass) || rowTons * 1000;
    cur.volume += Number(row.volume || 0);
    cur.mass += rowMass;
    cur.tons += rowTons || rowMass / 1000;
    cur.amount += Number(row.amount || 0);
    cur.amountCnyAvg += Number(row.amountCnyAvg || 0);
    cur.latestMonthVolume += Number(row.latestMonthVolume || 0);
    cur.latestMonthAmount += Number(row.latestMonthAmount || 0);
    ['yoyVolume', 'yoySales', 'momVolume', 'momSales'].forEach(f => { if (row[f] != null) cur[f + 'Parts'].push(Number(row[f])); });
    buckets.set(key, cur);
  });
  return RESOURCE_ORDER.filter(k => buckets.has(k)).map(k => {
    const item = buckets.get(k);
    ['yoyVolume', 'yoySales', 'momVolume', 'momSales'].forEach(f => {
      const parts = item[f + 'Parts'];
      item[f] = parts.length ? Number((parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(2)) : null;
      delete item[f + 'Parts'];
    });
    item.volume = Number(item.volume.toFixed(2));
    item.mass = Number(item.mass.toFixed(3));
    item.tons = Number(item.tons.toFixed(3));
    item.amount = Number(item.amount.toFixed(2));
    item.amountCnyAvg = Number(item.amountCnyAvg.toFixed(2));
    return item;
  });
}

function pctCell(v) {
  if (v == null) return <span style={{ color: 'rgba(160,180,210,0.35)' }}>--</span>;
  return <span style={{ color: pctColor(v), fontWeight: 700 }}>{v >= 0 ? '+' : ''}{v}%</span>;
}

export default function ResourcePage() {
  const [years, setYears] = useState([]);
  const [year, setYear] = useState(null);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState('');
  const [resources, setResources] = useState([]);
  const [periodLabel, setPeriodLabel] = useState('--');
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalAmountCny, setTotalAmountCny] = useState(null);
  const [totalVolume, setTotalVolume] = useState(0);
  const [totalTons, setTotalTons] = useState(0);

  const { registerControls, clearControls } = useRetailHeader();

  const mixC = useChart();
  const compareC = useChart();

  // ── 加载年份 ──
  useEffect(() => {
    (async () => {
      const y = await getYears();
      setYears(y);
      if (y[0]) setYear(y[0]);
    })();
  }, []);

  // ── 加载月份 ──
  useEffect(() => {
    if (!year) return;
    (async () => {
      try {
        const m = await getMonths();
        const yearMonths = (m || []).filter(x => String(x.month || x).startsWith(String(year) + '-')).map(x => Number((x.month || x).slice(5, 7))).filter(x => x >= 1 && x <= 12);
        setMonths(yearMonths.length ? yearMonths : Array.from({ length: 12 }, (_, i) => i + 1));
      } catch { setMonths(Array.from({ length: 12 }, (_, i) => i + 1)); }
    })();
  }, [year]);

  // ── 注册 header 控件 ──
  useEffect(() => {
    registerControls({
      type: 'resource',
      years,
      year,
      months,
      month,
      onYearChange: (v) => { setYear(v); setMonth(''); },
      onMonthChange: (v) => setMonth(v),
    });
    return () => clearControls();
  }, [years, year, months, month, registerControls, clearControls]);

  // ── 加载数据 ──
  useEffect(() => {
    if (!year) return;
    (async () => {
      try {
        const data = await getResourcesYearly(year, month || null);
        const res = normalizeResources(data.resources || []);
        const summary = data.summary || {};
        const amount = res.reduce((s, r) => s + (r.amount || 0), 0);
        setResources(res);
        setTotalAmount(amount);
        setTotalAmountCny(amountCnyOf({ ...summary, totalAmount: summary.totalAmount ?? amount, amount }));
        setTotalVolume(res.reduce((s, r) => s + (r.volume || 0), 0));
        setTotalTons(tonsOf(data.summary) || res.reduce((s, r) => s + tonsOf(r), 0));
        setPeriodLabel(data.periodLabel || data.latestMonth || '--');
      } catch (e) { console.error('油品数据加载失败', e); }
    })();
  }, [year, month]);

  // ── 渲染图表 ──
  useEffect(() => {
    // 1. 油品销售结构 (horizontal bar)
    const rankedResources = sortRankingRows(resources, r => r.volume);

    const mc = mixC.init('chart-resource-mix');
    mc?.setOption({
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip, formatter: p => `${(Array.isArray(p) ? p[0] : p).name}<br/>销售量：<b>${Number(p[0]?.value || p.value || 0).toFixed(2)}万升</b>` },
      grid: { top: 12, right: 58, bottom: 18, left: 64 },
      xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } }, axisLine: { show: false } },
      yAxis: { type: 'category', inverse: true, data: rankedResources.map(r => r.name), axisLabel: { color: 'rgba(200,220,240,0.75)', fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'bar', data: rankedResources.map(r => parseFloat(((r.volume || 0) / 10000).toFixed(2))), barMaxWidth: 16,
        itemStyle: { color: '#00d4ff', borderRadius: [0, 3, 3, 0] },
        label: { show: true, position: 'right', formatter: p => Number(p.value || 0).toFixed(2) + '万', color: 'rgba(220,240,255,0.86)', fontSize: 10 },
      }],
    }, true);

    // 2. 同比/环比对比
    const cc = compareC.init('chart-resource-compare');
    cc?.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...darkTooltip },
      legend: { top: 4, textStyle: { color: 'rgba(160,180,210,0.65)' }, data: ['同比金额', '最近月环比'] },
      grid: { top: 34, left: 48, right: 18, bottom: 34 },
      xAxis: { type: 'category', data: rankedResources.map(r => r.name), axisLabel: { color: 'rgba(160,180,210,0.6)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(0,180,255,0.2)' } } },
      yAxis: { type: 'value', axisLabel: { color: 'rgba(160,180,210,0.55)', formatter: v => Number(v || 0).toFixed(2) + '%' }, splitLine: { lineStyle: { color: 'rgba(0,180,255,0.06)' } } },
      series: [
        { name: '同比金额', type: 'bar', data: rankedResources.map(r => r.yoySales || 0), itemStyle: { color: '#00d4ff' }, barMaxWidth: 16, label: { show: true, position: 'top', formatter: p => Number(p.value || 0).toFixed(2) + '%', color: 'rgba(220,240,255,0.82)', fontSize: 10 } },
        { name: '最近月环比', type: 'bar', data: rankedResources.map(r => r.momSales || 0), itemStyle: { color: '#ffa726' }, barMaxWidth: 16, label: { show: true, position: 'top', formatter: p => Number(p.value || 0).toFixed(2) + '%', color: 'rgba(220,240,255,0.82)', fontSize: 10 } },
      ],
    }, true);
  }, [resources, periodLabel]);

  const totalAmountKpi = formatSomKpiParts(totalAmount);
  const totalVolumeKpi = formatLitersKpiParts(totalVolume);

  return (
    <div className="retail-page-wrap">
      <div className="retail-resource-grid">
        {/* KPI Row */}
        <div className="retail-kpi-row">
          <div className="retail-kpi-card c1"><div className="kpi-label">销售金额</div><div className="kpi-value">{totalAmountKpi.value}</div><div className="kpi-unit">{totalAmountKpi.unit}</div><div className="kpi-change">人民币 {formatCnyKpi(totalAmountCny)}</div></div>
          <div className="retail-kpi-card c2"><div className="kpi-label">销售量</div><div className="kpi-value">{totalVolumeKpi.value}</div><div className="kpi-unit">{totalVolumeKpi.unit}</div><div className="kpi-change">吨位 {formatTonsKpi(totalTons)}</div></div>
          <div className="retail-kpi-card c3"><div className="kpi-label">在售油品</div><div className="kpi-value">{resources.length}</div><div className="kpi-unit">类</div></div>
          <div className="retail-kpi-card c4"><div className="kpi-label">统计口径</div><div className="kpi-value">{periodLabel}</div><div className="kpi-unit">报表口径</div></div>
        </div>

        {/* 油品统计表格 */}
        <div className="retail-panel resource-cell-table">
          <div className="retail-panel-header"><div className="dot" /><span>油品销售统计</span></div>
          <div className="panel-body" style={{ overflow: 'auto', padding: 8 }}>
            <table className="retail-rank-table">
              <thead>
                <tr><th>油品</th><th>销售量</th><th>吨位</th><th>金额</th><th>同比金额</th><th>最近月环比</th></tr>
              </thead>
              <tbody>
                {resources.map(r => (
                  <tr key={r.key}>
                    <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.color, marginRight: 6 }} />{r.name}</td>
                    <td>{volumeFormat(r.volume)} L</td>
                    <td>{formatTons(tonsOf(r))} 吨</td>
                    <td>{numberFormat(r.amount)}</td>
                    <td>{pctCell(r.yoySales)}</td>
                    <td>{pctCell(r.momSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 油品结构 */}
        <div className="retail-panel resource-cell-mix">
          <div className="retail-panel-header"><div className="dot" /><span>油品销售结构</span></div>
          <div className="panel-body"><div id="chart-resource-mix" className="chart-full" /></div>
        </div>

        {/* 同比/环比 */}
        <div className="retail-panel resource-cell-compare">
          <div className="retail-panel-header"><div className="dot" /><span>同比 / 最近月环比</span></div>
          <div className="panel-body"><div id="chart-resource-compare" className="chart-full" /></div>
        </div>
      </div>
    </div>
  );
}
