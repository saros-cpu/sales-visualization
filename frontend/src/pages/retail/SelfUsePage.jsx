// src/pages/retail/SelfUsePage.jsx — 自用油明细
import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadSelfUseReport, getSelfUseByRange } from '../../api/retail';
import {
  fmtLiters,
  formatLitersKpiParts,
  formatSomKpiParts,
  formatTonsKpi,
  metricNumber,
  retailTonsOf,
  summarizeSelfUseRecords,
} from '../../utils/retail-helpers';

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function todayDate() {
  return formatLocalDate(new Date());
}

function monthStartDate() {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function formatNumber(value, digits = 2) {
  return metricNumber(value).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function compareValue(left, right, key) {
  if (key === 'datetime') {
    return `${left.date || ''} ${left.time || '00:00:00'}`.localeCompare(`${right.date || ''} ${right.time || '00:00:00'}`);
  }
  if (key === 'station') {
    return String(left.stationName || '').localeCompare(String(right.stationName || ''), 'zh-CN');
  }
  if (key === 'product') {
    return String(left.productName || '').localeCompare(String(right.productName || ''), 'zh-CN');
  }
  if (key === 'plate') {
    return String(left.plateNumber || '').localeCompare(String(right.plateNumber || ''), 'zh-CN');
  }
  if (key === 'tons') {
    return retailTonsOf(left) - retailTonsOf(right);
  }
  return metricNumber(left[key]) - metricNumber(right[key]);
}

function SortHeader({ sortKey, currentSort, onSort, children, className = '' }) {
  const active = currentSort.key === sortKey;
  const icon = !active ? '⇅' : currentSort.asc ? '↑' : '↓';
  const ariaSort = active ? (currentSort.asc ? 'ascending' : 'descending') : 'none';
  return (
    <th className={className} onClick={() => onSort(sortKey)} aria-sort={ariaSort}>
      {children} {icon}
    </th>
  );
}

function EmptyRows({ loading, error }) {
  return (
    <tr>
      <td colSpan="9" className="self-use-empty-row">
        {loading ? '正在加载自用油数据...' : error || '当前日期范围暂无自用油记录'}
      </td>
    </tr>
  );
}

export default function SelfUsePage() {
  const [dateFrom, setDateFrom] = useState(monthStartDate);
  const [dateTo, setDateTo] = useState(todayDate);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [sort, setSort] = useState({ key: 'datetime', asc: false });

  const loadData = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError('');
    try {
      const result = await getSelfUseByRange(dateFrom, dateTo);
      setData(result);
    } catch (err) {
      setData(null);
      setError(err?.message || '自用油数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const records = Array.isArray(data?.records) ? data.records : [];
  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const rows = keyword
      ? records.filter(row => String(row.plateNumber || '').toLowerCase().includes(keyword))
      : records;
    return [...rows].sort((left, right) => {
      const result = compareValue(left, right, sort.key);
      return sort.asc ? result : -result;
    });
  }, [records, search, sort]);

  // 未输入车牌：沿用接口整区间汇总；输入车牌：按内容区实际展示的记录实算。
  const plateKeyword = search.trim();
  const rangeSummary = data?.summary || {};
  const shownSummary = useMemo(() => summarizeSelfUseRecords(filteredRecords), [filteredRecords]);
  const summary = plateKeyword ? shownSummary : rangeSummary;
  const volumeKpi = formatLitersKpiParts(summary.totalVolume);
  const amountKpi = formatSomKpiParts(summary.totalAmount);
  const totalTons = retailTonsOf(summary);
  const stationCount = new Set(
    (plateKeyword ? filteredRecords : records).map(row => row.shopKey || row.stationName).filter(Boolean),
  ).size;
  const dateRangeText = dateFrom && dateTo ? `${dateFrom} 至 ${dateTo}` : '--';

  const toggleSort = (key) => {
    setSort(prev => (prev.key === key ? { key, asc: !prev.asc } : { key, asc: key !== 'datetime' }));
  };

  const handleExport = async () => {
    if (!dateFrom || !dateTo) return;
    setExporting(true);
    try {
      await downloadSelfUseReport(dateFrom, dateTo);
    } catch (err) {
      setError(err?.message || '自用油报表导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="retail-page-wrap self-use-page">
      <div className="retail-filter-bar self-use-toolbar">
        <label>开始日期</label>
        <input
          className="retail-search-input self-use-date-input"
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={event => setDateFrom(event.target.value)}
        />
        <label>结束日期</label>
        <input
          className="retail-search-input self-use-date-input"
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={event => setDateTo(event.target.value)}
        />
        <label>车牌号</label>
        <input
          className="retail-search-input self-use-search-input"
          placeholder="搜索车牌号"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
        <button className="retail-report-btn" type="button" onClick={loadData} disabled={loading}>
          {loading ? '查询中...' : '查询'}
        </button>
        <button className="retail-report-btn self-use-export-btn" type="button" onClick={handleExport} disabled={exporting || loading}>
          {exporting ? '生成中...' : '导出 Excel'}
        </button>
        <span className="self-use-toolbar-meta">
          {dateRangeText}，{plateKeyword ? `车牌 ${plateKeyword}，` : ''}显示 {filteredRecords.length} / {records.length} 条
        </span>
      </div>

      {error && (
        <div className="self-use-error">
          {error}
        </div>
      )}

      <div className="self-use-kpi-row">
        <div className="retail-kpi-card c1">
          <div className="kpi-label">自用油记录</div>
          <div className="kpi-value">{metricNumber(summary.totalRecords).toLocaleString('zh-CN')}</div>
          <div className="kpi-unit">条</div>
          <div className="kpi-change">{plateKeyword ? `车牌 ${plateKeyword}` : '按原报表24口径'}</div>
        </div>
        <div className="retail-kpi-card c2">
          <div className="kpi-label">合计油量</div>
          <div className="kpi-value">{volumeKpi.value}</div>
          <div className="kpi-unit">{volumeKpi.unit}</div>
          <div className="kpi-change">吨位 {formatTonsKpi(totalTons)}</div>
        </div>
        <div className="retail-kpi-card c3">
          <div className="kpi-label">合计金额</div>
          <div className="kpi-value">{amountKpi.value}</div>
          <div className="kpi-unit">{amountKpi.unit}</div>
          <div className="kpi-change">索姆口径</div>
        </div>
        <div className="retail-kpi-card c4">
          <div className="kpi-label">涉及站点</div>
          <div className="kpi-value">{stationCount}</div>
          <div className="kpi-unit">站</div>
          <div className="kpi-change">{plateKeyword ? '当前车牌筛选' : '当前区间'}</div>
        </div>
      </div>

      <div className="retail-table-wrap self-use-table-wrap">
        <table className="retail-data-table self-use-table">
          <colgroup>
            <col className="self-use-col-date" />
            <col className="self-use-col-time" />
            <col className="self-use-col-station" />
            <col className="self-use-col-product" />
            <col className="self-use-col-plate" />
            <col className="self-use-col-volume" />
            <col className="self-use-col-tons" />
            <col className="self-use-col-amount" />
            <col className="self-use-col-density" />
          </colgroup>
          <thead>
            <tr>
              <SortHeader sortKey="datetime" currentSort={sort} onSort={toggleSort}>日期</SortHeader>
              <th>时间</th>
              <SortHeader sortKey="station" currentSort={sort} onSort={toggleSort}>站点</SortHeader>
              <SortHeader sortKey="product" currentSort={sort} onSort={toggleSort}>油品</SortHeader>
              <SortHeader sortKey="plate" currentSort={sort} onSort={toggleSort}>车牌号</SortHeader>
              <SortHeader sortKey="volume" currentSort={sort} onSort={toggleSort} className="num">油量(L)</SortHeader>
              <SortHeader sortKey="tons" currentSort={sort} onSort={toggleSort} className="num">吨位(t)</SortHeader>
              <SortHeader sortKey="amount" currentSort={sort} onSort={toggleSort} className="num">金额(сом)</SortHeader>
              <SortHeader sortKey="density" currentSort={sort} onSort={toggleSort} className="num">密度</SortHeader>
            </tr>
          </thead>
          <tbody>
            {filteredRecords.length === 0 ? (
              <EmptyRows loading={loading} error={error} />
            ) : filteredRecords.map(row => (
              <tr key={row.transactionKey || `${row.date}-${row.time}-${row.shopKey}-${row.plateNumber}`}>
                <td>{row.date || '--'}</td>
                <td>{row.time || '--'}</td>
                <td>
                  <span className="self-use-station-name">{row.stationName || '--'}</span>
                  {row.stationShort ? <span className="self-use-station-short">{row.stationShort}</span> : null}
                </td>
                <td>{row.productName || '--'}</td>
                <td>{row.plateNumber || '-'}</td>
                <td className="num">{fmtLiters(row.volume)}</td>
                <td className="num">{formatNumber(retailTonsOf(row), 3)}</td>
                <td className="num">{formatNumber(row.amount)}</td>
                <td className="num">{metricNumber(row.density) > 0 ? formatNumber(row.density, 4) : '--'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="9">
                合计记录 <strong>{metricNumber(summary.totalRecords).toLocaleString('zh-CN')}</strong> 条 |
                合计油量 <strong>{fmtLiters(summary.totalVolume)}</strong> L |
                合计吨位 <strong>{formatNumber(totalTons, 3)}</strong> t |
                合计金额 <strong>{formatNumber(summary.totalAmount)}</strong> сом
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
