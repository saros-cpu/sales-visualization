// src/pages/retail/TransferPage.jsx — 零售外运实收统计
// 数据来源：零售库 supply 表（各加油站实际收到的油品转运/入库记录）。
// 与批发外运（装车/发货口径）不同，这里是「到站实收」口径，不依赖分库发货实时数据。
import { useCallback, useEffect, useState } from 'react';
import { getRetailTransferStats } from '../../api/retail';
import {
  fmtLiters,
  metricNumber,
  numberFormat,
} from '../../utils/retail-helpers';

const MODE_OPTIONS = [
  { key: 'range', label: '按日期区间' },
  { key: 'year', label: '按年' },
  { key: 'month', label: '按月' },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  key: String(i + 1),
  label: `${i + 1} 月`,
}));

function pad(value) {
  return String(value).padStart(2, '0');
}
function formatLocalDate(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
function yearStartDate() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}
function fmtTons(v) {
  return metricNumber(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
function fmtDensity(v) {
  return Number(v || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default function TransferPage() {
  const now = new Date();
  // Web 端语言：默认中文；若 localStorage 标记 ru 则俄文（与 Desktop 同源）
  const isRu =
    typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'ru';
  const [mode, setMode] = useState('range');
  const [start, setStart] = useState(yearStartDate);
  const [end, setEnd] = useState(() => formatLocalDate(now));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [station, setStation] = useState(''); // ''=全部, 'blank'=未知站, 否则 shopKey
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = { groupBy: 'station_resource' };
    if (mode === 'year') {
      params.mode = 'year';
      params.year = year;
    } else if (mode === 'month') {
      params.mode = 'month';
      params.year = year;
      params.month = month;
    } else {
      params.start = start;
      params.end = end;
    }
    if (station === 'blank') params.nameStatus = 'blank';
    else if (station) params.shopKey = station;
    try {
      const result = await getRetailTransferStats(params);
      setData(result?.data || null);
    } catch (err) {
      setData(null);
      setError(err?.message || '外运实收数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [mode, start, end, year, month, station]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const total = data?.total || { liters: 0, tons: 0, rows: 0, density: 0 };
  const stationCount = (data?.summary?.byStation || []).length;
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const byResource = data?.summary?.byResource || [];

  // 站名解析：按当前语言选择中/俄名；未知站回退 shopName
  const stationMap = {};
  stations.forEach((s) => { stationMap[s.shopKey] = s; });
  const stationName = (row) => {
    const s = stationMap[row.shopKey];
    if (s) return isRu ? (s.nameRu || s.nameZh) : (s.nameZh || s.nameRu);
    return row.shopName || `Station-${row.shopKey}`;
  };

  // 内容区：站×油品，按加油站编号顺序（再按油品）
  const records = (Array.isArray(data?.records) ? data.records : [])
    .slice()
    .sort((a, b) => (a.shopKey - b.shopKey) || (a.resourceKey - b.resourceKey));

  const rangeText =
    mode === 'month'
      ? `${year} 年 ${month} 月`
      : mode === 'year'
      ? `${year} 年`
      : start && end
      ? `${start} 至 ${end}`
      : '--';

  // 选中具体加油站时隐藏「加油站」列，只显示该站各油品
  const specificStation = station !== '' && station !== 'blank';

  // 全部加油站时合并「加油站」列：每个站点名跨其所有油品行显示一次（rowSpan）
  const isGroupStart = {};
  const stationRowSpan = {};
  if (!specificStation && records.length) {
    let i = 0;
    while (i < records.length) {
      const sk = records[i].shopKey;
      let j = i;
      while (j < records.length && records[j].shopKey === sk) j++;
      isGroupStart[i] = true;
      stationRowSpan[i] = j - i;
      i = j;
    }
  }

  const columns = [
    ...(specificStation
      ? []
      : [{ key: 'shopName', label: '加油站', num: false, resolve: stationName }]),
    { key: 'resourceLabel', label: '油品', num: false },
    { key: 'liters', label: '升 (L)', num: true },
    { key: 'tons', label: '吨 (t)', num: true },
    { key: 'density', label: '密度 (kg/L)', num: true },
    { key: 'rows', label: '笔数', num: true },
  ];

  const rowKey = (row) => `sr-${row.shopKey}-${row.resourceKey}`;
  const cellValue = (row, col) => {
    if (col.resolve) return col.resolve(row);
    if (col.key === 'tons') return fmtTons(row.tons);
    if (col.key === 'density') return fmtDensity(row.density);
    if (col.num) return fmtLiters(row[col.key]);
    return row[col.key] ?? '--';
  };

  const stationOptions = [
    { key: '', label: '全部加油站' },
    ...stations.map((s) => ({
      key: String(s.shopKey),
      label: isRu ? (s.nameRu || s.nameZh) : (s.nameZh || s.nameRu),
    })),
    { key: 'blank', label: '空白名称（未知站）' },
  ];

  return (
    <div className="retail-page-wrap retail-transfer-page">
      <div className="retail-filter-bar">
        <label>选择方式</label>
        <select
          className="retail-search-input"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          {MODE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>

        {mode === 'range' && (
          <>
            <label>开始日期</label>
            <input
              className="retail-search-input"
              type="date"
              value={start}
              max={end || undefined}
              onChange={(e) => setStart(e.target.value)}
            />
            <label>结束日期</label>
            <input
              className="retail-search-input"
              type="date"
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
            />
          </>
        )}
        {mode === 'year' && (
          <>
            <label>年份</label>
            <select
              className="retail-search-input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {[String(now.getFullYear()), String(now.getFullYear() - 1)].map((y) => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
          </>
        )}
        {mode === 'month' && (
          <>
            <label>年份</label>
            <select
              className="retail-search-input"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {[String(now.getFullYear()), String(now.getFullYear() - 1)].map((y) => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
            <label>月份</label>
            <select
              className="retail-search-input"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </>
        )}

        <label>加油站</label>
        <select
          className="retail-search-input"
          value={station}
          onChange={(e) => setStation(e.target.value)}
        >
          {stationOptions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button className="retail-report-btn" type="button" onClick={loadData} disabled={loading}>
          {loading ? '查询中...' : '查询'}
        </button>
        <span className="retail-toolbar-meta">
          {rangeText}，共 {records.length} 行
        </span>
      </div>

      {error && <div className="retail-transfer-error">{error}</div>}

      <div className="retail-kpi-row">
        <div className="retail-kpi-card c1">
          <div className="kpi-label">合计油量</div>
          <div className="kpi-value">{fmtLiters(total.liters)}</div>
          <div className="kpi-unit">L</div>
          <div className="kpi-change">到站实收口径</div>
        </div>
        <div className="retail-kpi-card c2">
          <div className="kpi-label">合计吨位</div>
          <div className="kpi-value">{fmtTons(total.tons)}</div>
          <div className="kpi-unit">t</div>
          <div className="kpi-change">零售日报修正质量</div>
        </div>
        <div className="retail-kpi-card c3">
          <div className="kpi-label">平均密度</div>
          <div className="kpi-value">{fmtDensity(total.density)}</div>
          <div className="kpi-unit">kg/L</div>
          <div className="kpi-change">修正质量÷体积</div>
        </div>
        <div className="retail-kpi-card c4">
          <div className="kpi-label">入库笔数</div>
          <div className="kpi-value">{metricNumber(total.rows).toLocaleString('zh-CN')}</div>
          <div className="kpi-unit">笔</div>
          <div className="kpi-change">Supply 记录数</div>
        </div>
      </div>

      {byResource.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '12px 0' }}>
          <div style={{ width: '100%', fontSize: 13, color: '#666', marginBottom: 2 }}>
            按油品分类（随所选{rangeText}同步）
          </div>
          {byResource.map((r) => (
            <div
              key={r.resourceKey}
              style={{
                flex: '1 1 160px',
                minWidth: 160,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '10px 12px',
                background: '#fafafa',
              }}
            >
              <div style={{ fontSize: 13, color: '#374151' }}>{r.resourceLabel}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#111827', marginTop: 4 }}>
                {fmtTons(r.tons)} t
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {fmtLiters(r.liters)} L ｜ {fmtDensity(r.density)} kg/L
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.sourceNote && (
        <div className="retail-transfer-note">
          说明：{data.sourceNote}
        </div>
      )}

      <div className="retail-table-wrap">
        <table className="retail-data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="retail-transfer-empty">
                  {loading ? '正在加载外运实收数据...' : error || '当前范围暂无转运入库记录'}
                </td>
              </tr>
            ) : (
              records.map((row, i) => (
                <tr key={rowKey(row, i)}>
                  {columns.map((c) => {
                    if (c.key === 'shopName' && !specificStation) {
                      if (!isGroupStart[i]) return null;
                      return (
                        <td key={c.key} rowSpan={stationRowSpan[i]} className="">{stationName(row)}</td>
                      );
                    }
                    return <td key={c.key} className={c.num ? 'num' : ''}>{cellValue(row, c)}</td>;
                  })}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={columns.length}>
                合计：{fmtLiters(total.liters)} L ｜ {fmtTons(total.tons)} t ｜{' '}
                {fmtDensity(total.density)} kg/L ｜ {metricNumber(total.rows).toLocaleString('zh-CN')} 笔
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
