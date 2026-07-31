import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  downloadProfitReport,
  downloadProfitYearReport,
  getMonths,
  getYears,
  getProfitMonthData,
  getProfitYearData,
} from '../../api/retail';
import { useAuth } from '../../hooks/useAuth';
import {
  formatCnyKpi,
  formatLitersKpiParts,
  formatSomKpiParts,
  formatTonsKpi,
  normalizeRetailMonthOptions,
  normalizeRetailYears,
  preferredRetailMonth,
  splitStationName,
} from '../../utils/retail-helpers';

const AMOUNT_KEYS = new Set([
  'salesAmount',
  'dieselSalesAmount',
  'purchaseAmount',
  'salary',
  'freight',
  'otherFees',
  'grossProfit',
  'netProfit',
  'income',
  'purchaseCost',
  'vat',
  'businessTax',
  'netProfitCny',
]);
function amount(value, digits = 2) {
  if (value == null || value === '') return '--';
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function compactKpiAmount(value) {
  const parts = formatSomKpiParts(value || 0);
  return { value: parts.value, unit: parts.unit };
}

function compactKpiLiters(value) {
  const parts = formatLitersKpiParts(value || 0);
  return { value: parts.value, unit: parts.unit };
}

function reasonLabel(reason) {
  if (reason === 'new_station') return '新开业按天';
  if (reason === 'no_operation') return '停业';
  return '整月';
}

function reasonClass(reason) {
  if (reason === 'new_station') return 'tag-yellow';
  if (reason === 'no_operation') return 'tag-gray';
  return 'tag-green';
}

function isNoOperationStation(row) {
  return row?.costProrationReason === 'no_operation' || Number(row?.operatingDays || 0) <= 0;
}

function summaryAmountCny(summary, key, yearRows) {
  if (!summary) return null;
  if (key === 'netProfit' && summary.netProfitCny != null) return summary.netProfitCny;
  if (Array.isArray(yearRows) && yearRows.length) {
    let total = 0;
    let hasValue = false;
    yearRows.forEach(row => {
      const avg = Number(row.avgCnyKgs || 0);
      const value = Number(row[key] || 0);
      if (row.active && avg > 0 && Number.isFinite(value)) {
        total += value / avg;
        hasValue = true;
      }
    });
    return hasValue ? total : null;
  }
  const avg = Number(summary.avgCnyKgs || 0);
  const value = Number(summary[key] || 0);
  return avg > 0 && Number.isFinite(value) ? value / avg : null;
}

function comparisonSummary(data) {
  const comparison = data?.comparison || {};
  return {
    mom: comparison.mom?.summary || null,
    yoy: comparison.yoy?.summary || null,
  };
}

function percentChange(current, previous) {
  if (current == null || current === '' || previous == null || previous === '') return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (Math.abs(prev) < 0.000001) {
    if (Math.abs(cur) < 0.000001) return { text: '0.0%', tone: 'neutral', arrow: '' };
    return { text: '--', tone: 'neutral', arrow: '' };
  }
  const percent = ((cur - prev) / Math.abs(prev)) * 100;
  const tone = percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral';
  const arrow = percent > 0 ? '↑' : percent < 0 ? '↓' : '';
  return { text: `${Math.abs(percent).toFixed(1)}%`, tone, arrow };
}

function CompareBadge({ label, item }) {
  if (!item) {
    return (
      <span className="profit-compare neutral">
        <span className="profit-compare-label">{label}</span>
        <span className="profit-compare-value">--</span>
      </span>
    );
  }
  return (
    <span className={`profit-compare ${item.tone}`}>
      <span className="profit-compare-label">{label}</span>
      <span className="profit-compare-value">{item.arrow}{item.text}</span>
    </span>
  );
}

function KpiCard({ className, title, main, unit, lead, compare }) {
  const cardClass = ['retail-kpi-card', compare ? 'has-compare' : '', className || '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cardClass}>
      <div className="profit-kpi-data">
        <div className="kpi-label">{title}</div>
        <div className="profit-kpi-main">
          <span className="kpi-value">{main}</span>
          <span className="kpi-unit">{unit}</span>
        </div>
        {lead ? <div className="profit-kpi-sub">{lead}</div> : null}
      </div>
      {compare ? <div className="kpi-change">{compare}</div> : null}
    </div>
  );
}

function SnapshotLine({ data }) {
  if (!data?.snapshotGeneratedAt) return null;
  return (
    <span className="profit-snapshot">
      {data.snapshotCached ? '快照读取' : '快照刷新'}：{data.snapshotGeneratedAt}
    </span>
  );
}

function EmptyState({ children }) {
  return (
    <div className="retail-panel profit-empty-state">
      {children}
    </div>
  );
}

function StationNameCell({ name, short }) {
  const lines = splitStationName(name, short);
  return (
    <span className="station-name-stack" title={lines.title}>
      <span className="station-name-primary">{lines.primary}</span>
      {lines.secondary ? <span className="station-name-secondary">{lines.secondary}</span> : null}
    </span>
  );
}

export default function ProfitPage() {
  const { user } = useAuth();
  const canExport = user?.role === 'admin';
  const today = new Date();
  const [mode, setMode] = useState('month');
  const [months, setMonths] = useState([]);
  const [ym, setYm] = useState('');
  const [year, setYear] = useState(today.getFullYear());
  const [yearOptions, setYearOptions] = useState(() => normalizeRetailYears([], today.getFullYear()));
  const [monthData, setMonthData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [compareData, setCompareData] = useState({ mom: null, yoy: null });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [downloading, setDownloading] = useState('');
  const [expandedShop, setExpandedShop] = useState(null);
  const loadSeqRef = useRef(0);

  const monthOptions = useMemo(
    () => normalizeRetailMonthOptions(months),
    [months],
  );

  useEffect(() => {
    let active = true;
    const yesterday = new Date(Date.now() - 86400000);
    const preferred = yesterday.toISOString().slice(0, 7);
    Promise.allSettled([getMonths(), getYears()])
      .then(([monthsResult, yearsResult]) => {
        if (!active) return;
        const normalized = normalizeRetailMonthOptions(
          monthsResult.status === 'fulfilled' && Array.isArray(monthsResult.value)
            ? monthsResult.value
            : [],
        );
        setMonths(normalized);
        const selected = preferredRetailMonth(normalized, preferred, preferred);
        setYm(selected);
        const years = normalizeRetailYears(yearsResult.status === 'fulfilled' ? yearsResult.value : [], today.getFullYear());
        setYearOptions(years);
        const selectedYear = Number(String(selected).slice(0, 4));
        setYear(years.includes(selectedYear) ? selectedYear : years[0]);
      });
    return () => { active = false; };
  }, []);

  const loadData = useCallback(async (refresh = false) => {
    if (!canExport) return;
    if (mode === 'month' && !ym) return;
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    setLoading(true);
    setLoadError('');
    try {
      if (mode === 'month') {
        const data = await getProfitMonthData(ym, { refresh });
        if (loadSeqRef.current === seq) {
          setMonthData(data);
          setCompareData(comparisonSummary(data));
          setExpandedShop(null);
        }
      } else {
        const data = await getProfitYearData(year, { refresh });
        if (loadSeqRef.current === seq) {
          setYearData(data);
          setCompareData(comparisonSummary(data));
        }
      }
    } catch (err) {
      if (loadSeqRef.current === seq) setLoadError(err.message || '利润核算数据加载失败');
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [canExport, mode, ym, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDownload = async () => {
    if (!canExport) return;
    const key = mode === 'month' ? 'month' : 'year';
    setDownloading(key);
    try {
      if (mode === 'month') await downloadProfitReport(ym);
      else await downloadProfitYearReport(year);
    } catch (err) {
      alert(err.message || '下载失败');
    } finally {
      setDownloading('');
    }
  };

  const summary = mode === 'month' ? monthData?.summary : yearData?.summary;
  const kpiRows = mode === 'year' ? yearData?.months : null;
  const salesKpi = compactKpiAmount(summary?.salesAmount);
  const volumeKpi = compactKpiLiters(summary?.volume);
  const dieselSalesKpi = compactKpiAmount(summary?.dieselSalesAmount);
  const dieselVolumeKpi = compactKpiLiters(summary?.dieselVolume);
  const purchaseKpi = compactKpiAmount(summary?.purchaseAmount);
  const salaryKpi = compactKpiAmount(summary?.salary);
  const otherKpi = compactKpiAmount(summary?.otherFees);
  const netProfitKpi = compactKpiAmount(summary?.netProfit);
  const cnyExtra = key => `人民币 ${formatCnyKpi(summaryAmountCny(summary, key, kpiRows))}`;
  const compareFor = key => ({
    mom: percentChange(summary?.[key], compareData.mom?.[key]),
    yoy: percentChange(summary?.[key], compareData.yoy?.[key]),
  });
  const kpiMeta = (key, lead, showCompare = true) => {
    const compare = showCompare ? compareFor(key) : null;
    return {
      lead,
      compare: showCompare ? (
        <div className="profit-compare-group">
          <CompareBadge label="环比" item={compare.mom} />
          <CompareBadge label="同比" item={compare.yoy} />
        </div>
      ) : null,
    };
  };

  const stationRows = useMemo(() => {
    return [...(monthData?.stations || [])]
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftClosed = isNoOperationStation(left.row);
        const rightClosed = isNoOperationStation(right.row);
        if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
        return left.index - right.index;
      })
      .map(item => item.row);
  }, [monthData]);

  const yearSummaryKeys = [
    ['volume', 3],
    ['salesAmount', 2],
    ['dieselSalesAmount', 2],
    ['purchaseAmount', 2],
    ['salary', 2],
    ['freight', 2],
    ['otherFees', 2],
    ['income', 2],
    ['purchaseCost', 2],
    ['vat', 2],
    ['businessTax', 2],
    ['netProfit', 2],
    ['tons', 3],
    ['avgCnyKgs', 4],
    ['netProfitCny', 2],
  ];

  if (!canExport) {
    return (
      <div className="retail-page-wrap profit-page">
        <EmptyState>当前账号没有利润核算权限。利润核算涉及维护成本、薪酬和报表下载，仅管理员可查看。</EmptyState>
      </div>
    );
  }

  return (
    <div className="retail-page-wrap profit-page">
      <div className="profit-toolbar retail-panel">
        <div className="profit-mode-tabs">
          <button className={`retail-view-tab${mode === 'month' ? ' active' : ''}`} onClick={() => setMode('month')}>月度利润核算</button>
          <button className={`retail-view-tab${mode === 'year' ? ' active' : ''}`} onClick={() => setMode('year')}>年度利润核算</button>
        </div>
        {mode === 'month' ? (
          <select className="retail-month-select" value={ym} onChange={e => setYm(e.target.value)}>
            {monthOptions.map(item => {
              const [y, m] = item.month.split('-');
              return <option key={item.month} value={item.month}>{y}年{Number(m)}月</option>;
            })}
            {!monthOptions.length && ym ? <option value={ym}>{ym}</option> : null}
          </select>
        ) : (
          <select className="retail-month-select" value={year} onChange={e => setYear(Number(e.target.value))}>
            {yearOptions.map(item => <option key={item} value={item}>{item}年</option>)}
          </select>
        )}
        <button className="retail-report-btn" disabled={loading} onClick={() => loadData(true)}>
          {loading ? '刷新中...' : '刷新快照'}
        </button>
        <button className="retail-report-btn profit-primary-btn" disabled={!!downloading || loading} onClick={handleDownload}>
          {downloading ? '下载中...' : (mode === 'month' ? '下载月度文件' : '下载年度总表')}
        </button>
        <div className="profit-toolbar-meta">
          {mode === 'month'
            ? (monthData ? `${monthData.queryStart} - ${monthData.queryEnd}` : ym)
            : `已纳入 ${yearData?.includedMonths || 0} 个月`}
          <SnapshotLine data={mode === 'month' ? monthData : yearData} />
        </div>
      </div>

      {loadError ? <EmptyState>{loadError}</EmptyState> : null}

      <div className="profit-kpi-grid-web">
        <KpiCard className="c1" title="累计销售额" main={salesKpi.value} unit={salesKpi.unit} {...kpiMeta('salesAmount', cnyExtra('salesAmount'))} />
        <KpiCard className="c2" title="累计销量" main={volumeKpi.value} unit={volumeKpi.unit} {...kpiMeta('volume', `吨位 ${formatTonsKpi(summary?.tons || 0)}`)} />
        <KpiCard className="c3" title="柴油销售额" main={dieselSalesKpi.value} unit={dieselSalesKpi.unit} {...kpiMeta('dieselSalesAmount', cnyExtra('dieselSalesAmount'))} />
        <KpiCard className="c4" title="柴油销量" main={dieselVolumeKpi.value} unit={dieselVolumeKpi.unit} {...kpiMeta('dieselVolume', `吨位 ${formatTonsKpi(summary?.dieselTons || 0)}`)} />
        <KpiCard className="c1" title="购油金额" main={purchaseKpi.value} unit={purchaseKpi.unit} {...kpiMeta('purchaseAmount', cnyExtra('purchaseAmount'))} />
        <KpiCard className="c2" title="薪酬" main={salaryKpi.value} unit={salaryKpi.unit} {...kpiMeta('salary', cnyExtra('salary'), false)} />
        <KpiCard className="c3" title="水电网警等" main={otherKpi.value} unit={otherKpi.unit} {...kpiMeta('otherFees', cnyExtra('otherFees'), false)} />
        <KpiCard className="c4" title="净利润" main={netProfitKpi.value} unit={netProfitKpi.unit} {...kpiMeta('netProfit', cnyExtra('netProfit'))} />
      </div>

      {mode === 'month' ? (
        <div className="retail-table-wrap profit-table-wrap">
          <table className="retail-data-table retail-profit-table">
            <thead>
              <tr>
                <th>站号</th>
                <th>站点名称</th>
                <th>营业天数</th>
                <th>成本规则</th>
                <th>销售量</th>
                <th>吨位</th>
                <th>销售金额</th>
                <th>购油金额</th>
                <th>薪酬</th>
                <th>运费</th>
                <th>水电网警等</th>
                <th>毛利</th>
                <th>净利润</th>
                <th>油品</th>
              </tr>
            </thead>
            <tbody>
              {loading && !stationRows.length ? (
                <tr><td colSpan={14}>正在加载月度利润核算数据...</td></tr>
              ) : stationRows.map(row => {
                const expanded = expandedShop === row.shopKey;
                return (
                  <Fragment key={row.shopKey}>
                    <tr key={row.shopKey} className={isNoOperationStation(row) ? 'profit-closed-row' : ''}>
                      <td>{row.shopKey}</td>
                      <td><StationNameCell name={row.name} /></td>
                      <td><span className={`retail-tag ${reasonClass(row.costProrationReason)}`}>{row.operatingDays}/{row.periodDays}</span></td>
                      <td><span className={`retail-tag ${reasonClass(row.costProrationReason)}`}>{reasonLabel(row.costProrationReason)}</span></td>
                      <td className="num">{amount(row.volume, 3)}</td>
                      <td className="num">{amount(row.tons, 3)}</td>
                      <td className="num">{amount(row.salesAmount)}</td>
                      <td className="num">{amount(row.purchaseAmount)}</td>
                      <td className="num" title={`标准：${amount(row.salaryBase)}`}>{amount(row.salary)}</td>
                      <td className="num">{amount(row.freight)}</td>
                      <td className="num">{amount(row.otherFees)}</td>
                      <td className="num">{amount(row.grossProfit)}</td>
                      <td className="num profit-strong">{amount(row.netProfit)}</td>
                      <td>
                        <button className="profit-expand-btn" onClick={() => setExpandedShop(expanded ? null : row.shopKey)}>
                          {expanded ? '收起' : '展开'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr key={`${row.shopKey}-products`} className="profit-product-row">
                        <td colSpan={14}>
                          <table className="retail-data-table retail-profit-table profit-product-table">
                            <thead>
                              <tr>
                                <th>油品</th>
                                <th>销售量</th>
                                <th>吨位</th>
                                <th>销售单价</th>
                                <th>销售金额</th>
                                <th>购油品名</th>
                                <th>购油单价</th>
                                <th>购油金额</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(row.rows || []).map(item => (
                                <tr key={`${row.shopKey}-${item.resourceKey}-${item.product}`}>
                                  <td>{item.product}</td>
                                  <td className="num">{amount(item.volume, 3)}</td>
                                  <td className="num">{amount(item.tons, 3)}</td>
                                  <td className="num">{item.salesPrice == null ? '--' : amount(item.salesPrice)}</td>
                                  <td className="num">{amount(item.salesAmount)}</td>
                                  <td>{item.purchaseProduct}</td>
                                  <td className="num">{amount(item.purchasePrice)}</td>
                                  <td className="num">{amount(item.purchaseAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="retail-table-wrap profit-table-wrap">
          <table className="retail-data-table retail-profit-table">
            <thead>
              <tr>
                <th>月份</th>
                <th>状态</th>
                <th>销售量</th>
                <th>销售金额</th>
                <th>柴油销售金额</th>
                <th>购油金额</th>
                <th>薪酬</th>
                <th>运费</th>
                <th>水电网警等</th>
                <th>收入</th>
                <th>购油成本</th>
                <th>增值税</th>
                <th>营业税</th>
                <th>净利润</th>
                <th>吨位</th>
                <th>汇率</th>
                <th>净利润人民币</th>
              </tr>
            </thead>
            <tbody>
              {loading && !(yearData?.months || []).length ? (
                <tr><td colSpan={17}>正在加载年度利润核算数据...</td></tr>
              ) : (yearData?.months || []).map(row => (
                <tr key={row.month} className={!row.active ? 'profit-closed-row' : ''}>
                  <td>{row.monthName}</td>
                  <td><span className={`retail-tag ${row.active ? 'tag-green' : 'tag-gray'}`}>{row.active ? '有数据' : '无数据'}</span></td>
                  <td className="num">{row.volume == null ? '--' : amount(row.volume, 3)}</td>
                  <td className="num">{row.salesAmount == null ? '--' : amount(row.salesAmount)}</td>
                  <td className="num">{row.dieselSalesAmount == null ? '--' : amount(row.dieselSalesAmount)}</td>
                  <td className="num">{row.purchaseAmount == null ? '--' : amount(row.purchaseAmount)}</td>
                  <td className="num">{row.salary == null ? '--' : amount(row.salary)}</td>
                  <td className="num">{row.freight == null ? '--' : amount(row.freight)}</td>
                  <td className="num">{row.otherFees == null ? '--' : amount(row.otherFees)}</td>
                  <td className="num">{row.income == null ? '--' : amount(row.income)}</td>
                  <td className="num">{row.purchaseCost == null ? '--' : amount(row.purchaseCost)}</td>
                  <td className="num">{row.vat == null ? '--' : amount(row.vat)}</td>
                  <td className="num">{row.businessTax == null ? '--' : amount(row.businessTax)}</td>
                  <td className="num profit-strong">{row.netProfit == null ? '--' : amount(row.netProfit)}</td>
                  <td className="num">{row.tons == null ? '--' : amount(row.tons, 3)}</td>
                  <td className="num">{row.avgCnyKgs == null ? '--' : amount(row.avgCnyKgs, 4)}</td>
                  <td className="num">{row.netProfitCny == null ? '--' : amount(row.netProfitCny)}</td>
                </tr>
              ))}
            </tbody>
            {yearData ? (
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td />
                  {yearSummaryKeys.map(([key, digits]) => (
                    <td key={key} className={`num ${AMOUNT_KEYS.has(key) ? 'profit-strong' : ''}`}>
                      {key === 'avgCnyKgs' && yearData.summary?.[key] == null ? '--' : amount(yearData.summary?.[key], digits)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}
