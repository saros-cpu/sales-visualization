import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, App, Button, Card, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, FileExcelOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import StationNameStack from '@/components/ui/StationNameStack';
import {
  downloadProfitReport,
  downloadProfitYearReport,
  getProfitMonthData,
  getProfitYearData,
  type ProfitProductRow,
  type ProfitStationSummary,
  type ProfitYearMonthRow,
  type ProfitMonthData,
  type ProfitYearData,
  type ProfitSummary,
} from '@/api/export';
import { useAuth } from '@/contexts/AuthContext';
import { useRetailYears } from '@/hooks/useRetailYears';
import {
  formatRetailCnyKpi,
  formatRetailTonsKpi,
  numericMetric,
} from '@/utils/retailMetrics';

const { Text } = Typography;
type ProfitAmountKey = 'salesAmount' | 'dieselSalesAmount' | 'purchaseAmount' | 'salary' | 'otherFees' | 'netProfit';
type ProfitCompareKey = ProfitAmountKey | 'volume' | 'dieselVolume';
type ProfitCompareData = { mom: ProfitSummary | null; yoy: ProfitSummary | null };
type ProfitCompareItem = { text: string; tone: 'up' | 'down' | 'neutral'; arrow: string };
type ProfitKpiParts = { value: string; unit: string };

function resolveKpiLocale(language?: string) {
  return language?.startsWith('ru') ? 'ru-RU' : 'zh-CN';
}

function compactKpiNumber(value: number, divisor: number, locale: string, maximumFractionDigits: number) {
  return (value / divisor).toLocaleString(locale, { maximumFractionDigits });
}

function formatSomKpiParts(value: unknown, language?: string): ProfitKpiParts {
  const numeric = numericMetric(value);
  const locale = resolveKpiLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 100000000) {
      return { value: compactKpiNumber(numeric, 100000000, 'ru-RU', 2), unit: 'млрд сом' };
    }
    if (Math.abs(numeric) >= 1000000) {
      return { value: compactKpiNumber(numeric, 1000000, 'ru-RU', 1), unit: 'млн сом' };
    }
    return { value: numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 }), unit: 'сом' };
  }
  if (Math.abs(numeric) >= 100000000) {
    return { value: compactKpiNumber(numeric, 100000000, 'zh-CN', 2), unit: '亿索姆' };
  }
  if (Math.abs(numeric) >= 10000) {
    return { value: compactKpiNumber(numeric, 10000, 'zh-CN', 1), unit: '万索姆' };
  }
  return { value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: '索姆' };
}

function formatLitersKpiParts(value: unknown, language?: string): ProfitKpiParts {
  const numeric = numericMetric(value);
  const locale = resolveKpiLocale(language);
  if (locale === 'ru-RU') {
    if (Math.abs(numeric) >= 1000) {
      return { value: compactKpiNumber(numeric, 1000, 'ru-RU', 1), unit: 'тыс. л' };
    }
    return { value: numeric.toLocaleString('ru-RU', { maximumFractionDigits: 0 }), unit: 'л' };
  }
  if (Math.abs(numeric) >= 10000) {
    return { value: compactKpiNumber(numeric, 10000, 'zh-CN', 1), unit: '万L' };
  }
  return { value: numeric.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: 'L' };
}

function amount(value?: number | null, digits = 2) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function reasonColor(reason?: string) {
  if (reason === 'new_station') return 'orange';
  if (reason === 'no_operation') return 'default';
  return 'green';
}

function isNoOperationStation(row: ProfitStationSummary) {
  return row.costProrationReason === 'no_operation' || Number(row.operatingDays || 0) <= 0;
}

function comparisonSummary(data?: ProfitMonthData | ProfitYearData | null): ProfitCompareData {
  return {
    mom: data?.comparison?.mom?.summary || null,
    yoy: data?.comparison?.yoy?.summary || null,
  };
}


function percentChange(current?: number | null, previous?: number | null): ProfitCompareItem | null {
  if (current == null || previous == null) return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (Math.abs(prev) < 0.000001) {
    if (Math.abs(cur) < 0.000001) return { text: '0.0%', tone: 'neutral', arrow: '' };
    return null;
  }
  const percent = ((cur - prev) / Math.abs(prev)) * 100;
  const tone = percent > 0 ? 'up' : percent < 0 ? 'down' : 'neutral';
  const arrow = percent > 0 ? '↑' : percent < 0 ? '↓' : '';
  return { text: `${Math.abs(percent).toFixed(1)}%`, tone, arrow };
}

function CompareBadge({ label, item }: { label: string; item: ProfitCompareItem | null }) {
  return (
    <span className={`profit-kpi-compare ${item?.tone || 'neutral'}`}>
      <span className="profit-kpi-compare-label">{label}</span>
      <span className="profit-kpi-compare-value">{item ? `${item.arrow}${item.text}` : '--'}</span>
    </span>
  );
}

function ProfitKpiCard({
  title,
  value,
  unit,
  lead,
  compare,
}: {
  title: ReactNode;
  value: string;
  unit: string;
  lead: ReactNode;
  compare?: ReactNode;
}) {
  return (
    <Card size="small" className={`profit-kpi-card${compare ? ' has-compare' : ''}`}>
      <div className="profit-kpi-data">
        <div className="profit-kpi-title">{title}</div>
        <div className="profit-kpi-main">
          <span className="profit-kpi-value">{value}</span>
          <span className="profit-kpi-unit">{unit}</span>
        </div>
        <div className="profit-kpi-sub">{lead}</div>
      </div>
      {compare ? <div className="profit-kpi-change">{compare}</div> : null}
    </Card>
  );
}

export default function ProfitView() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const { user } = useAuth();
  const canExport = user?.role === 'admin';
  const now = dayjs();
  const [mode, setMode] = useState('month');
  const { year, setYear, yearOptions } = useRetailYears(now.year());
  const [month, setMonth] = useState(now.month() + 1);
  const [downloading, setDownloading] = useState('');
  const [loading, setLoading] = useState(false);
  const [monthData, setMonthData] = useState<ProfitMonthData | null>(null);
  const [yearData, setYearData] = useState<ProfitYearData | null>(null);
  const [compareData, setCompareData] = useState<ProfitCompareData>({ mom: null, yoy: null });
  const loadSeq = useRef(0);

  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const loadData = useCallback(async (refresh = false) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    if (!canExport) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'month') {
        const nextData = await getProfitMonthData(ym, refresh);
        if (loadSeq.current === seq) {
          setMonthData(nextData);
          setCompareData(comparisonSummary(nextData));
        }
      } else {
        const nextData = await getProfitYearData(year, refresh);
        if (loadSeq.current === seq) {
          setYearData(nextData);
          setCompareData(comparisonSummary(nextData));
        }
      }
    } catch (e: any) {
      if (loadSeq.current === seq) message.error(e?.message || t('common.failed'));
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [canExport, message, mode, t, year, ym]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onDownload = async (key: string, task: () => Promise<unknown>) => {
    setDownloading(key);
    try {
      await task();
      message.success(t('common.downloadStarted'));
    } catch (e: any) {
      message.error(e?.message || t('common.downloadFailed'));
    } finally {
      setDownloading('');
    }
  };

  const monthColumns = useMemo<ColumnsType<ProfitStationSummary>>(() => [
    { title: t('profit.stationNo'), dataIndex: 'shopKey' },
    { title: t('profit.stationName'), dataIndex: 'name', render: (_: string, row) => <StationNameStack name={row.name} className="profit-station-name" /> },
    {
      title: t('profit.operatingDays'),
      render: (_, row) => (
        <Tag color={reasonColor(row.costProrationReason)}>
          {row.operatingDays}/{row.periodDays}
        </Tag>
      ),
    },
    {
      title: t('profit.costRule'),
      dataIndex: 'costProrationReason',
      render: (v) => <Tag color={reasonColor(v)}>{t(`profit.reason.${v || 'full_month'}`)}</Tag>,
    },
    { title: t('retail.volume'), dataIndex: 'volume', render: (v) => amount(v, 3) },
    { title: t('retail.totalTons'), dataIndex: 'tons', render: (v) => amount(v, 3) },
    { title: t('retail.amount'), dataIndex: 'salesAmount', render: (v) => amount(v) },
    { title: t('profit.purchaseAmount'), dataIndex: 'purchaseAmount', render: (v) => amount(v) },
    { title: t('profit.salary'), dataIndex: 'salary', render: (v, row) => <span title={`${t('profit.baseValue')}: ${amount(row.salaryBase)}`}>{amount(v)}</span> },
    { title: t('profit.freight'), dataIndex: 'freight', render: (v) => amount(v) },
    { title: t('profit.otherFees'), dataIndex: 'otherFees', render: (v) => amount(v) },
    { title: t('profit.grossProfit'), dataIndex: 'grossProfit', render: (v) => amount(v) },
    { title: t('profit.netProfit'), dataIndex: 'netProfit', render: (v) => amount(v) },
  ], [t]);

  const productColumns = useMemo<ColumnsType<ProfitProductRow>>(() => [
    { title: t('common.productName'), dataIndex: 'product' },
    { title: t('retail.volume'), dataIndex: 'volume', render: (v) => amount(v, 3) },
    { title: t('retail.totalTons'), dataIndex: 'tons', render: (v) => amount(v, 3) },
    { title: t('profit.salesPrice'), dataIndex: 'salesPrice', render: (v) => v == null ? '-' : amount(v) },
    { title: t('retail.amount'), dataIndex: 'salesAmount', render: (v) => amount(v) },
    { title: t('profit.purchaseProduct'), dataIndex: 'purchaseProduct' },
    { title: t('profit.purchasePrice'), dataIndex: 'purchasePrice', render: (v) => amount(v) },
    { title: t('profit.purchaseAmount'), dataIndex: 'purchaseAmount', render: (v) => amount(v) },
  ], [t]);

  const yearColumns = useMemo<ColumnsType<ProfitYearMonthRow>>(() => [
    { title: t('retail.month'), dataIndex: 'monthName' },
    { title: t('profit.status'), dataIndex: 'active', render: (v) => v ? <Tag color="green">{t('common.ok')}</Tag> : <Tag>{t('common.noData')}</Tag> },
    { title: t('retail.volume'), dataIndex: 'volume', render: (v) => v == null ? '-' : amount(v, 3) },
    { title: t('retail.amount'), dataIndex: 'salesAmount', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.dieselSalesAmount'), dataIndex: 'dieselSalesAmount', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.purchaseAmount'), dataIndex: 'purchaseAmount', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.salary'), dataIndex: 'salary', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.freight'), dataIndex: 'freight', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.otherFees'), dataIndex: 'otherFees', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.income'), dataIndex: 'income', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.purchaseCost'), dataIndex: 'purchaseCost', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.vat'), dataIndex: 'vat', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.businessTax'), dataIndex: 'businessTax', render: (v) => v == null ? '-' : amount(v) },
    { title: t('profit.netProfit'), dataIndex: 'netProfit', render: (v) => v == null ? '-' : amount(v) },
    { title: t('retail.totalTons'), dataIndex: 'tons', render: (v) => v == null ? '-' : amount(v, 3) },
    { title: t('profit.avgCnyKgs'), dataIndex: 'avgCnyKgs', render: (v) => v == null ? '-' : amount(v, 4) },
    { title: t('profit.netProfitCny'), dataIndex: 'netProfitCny', render: (v) => v == null ? '-' : amount(v) },
  ], [t]);

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
  ] as const;

  const cnyLabel = i18n.language.startsWith('ru') ? 'CNY' : '人民币';

  const summaryAmountCny = (summary: ProfitMonthData['summary'] | ProfitYearData['summary'] | undefined, key: ProfitAmountKey) => {
    if (!summary) return null;
    if (key === 'netProfit' && summary.netProfitCny != null) return summary.netProfitCny;
    if (mode === 'year' && yearData?.months?.length) {
      let total = 0;
      let hasValue = false;
      for (const row of yearData.months) {
        const avg = Number(row.avgCnyKgs || 0);
        const value = Number((row as unknown as Record<string, unknown>)[key] || 0);
        if (row.active && avg > 0 && Number.isFinite(value)) {
          total += value / avg;
          hasValue = true;
        }
      }
      return hasValue ? total : null;
    }
    const avg = Number(summary.avgCnyKgs || 0);
    const value = Number((summary as unknown as Record<string, unknown>)[key] || 0);
    return avg > 0 && Number.isFinite(value) ? value / avg : null;
  };

  const cnyExtraText = (summary: ProfitMonthData['summary'] | ProfitYearData['summary'] | undefined, key: ProfitAmountKey) => (
    `${cnyLabel} ${formatRetailCnyKpi(summaryAmountCny(summary, key), i18n.language)}`
  );

  const compareFor = (summary: ProfitMonthData['summary'] | ProfitYearData['summary'] | undefined, key: ProfitCompareKey) => ({
    mom: percentChange(summary?.[key], compareData.mom?.[key]),
    yoy: percentChange(summary?.[key], compareData.yoy?.[key]),
  });

  const kpiCompare = (
    summary: ProfitMonthData['summary'] | ProfitYearData['summary'] | undefined,
    key: ProfitCompareKey,
    showCompare = true,
  ) => {
    const compare = showCompare ? compareFor(summary, key) : null;
    if (!showCompare) return null;
    return (
      <span className="profit-kpi-compare-group">
        <CompareBadge label={t('common.mom')} item={compare?.mom || null} />
        <CompareBadge label={t('common.yoy')} item={compare?.yoy || null} />
      </span>
    );
  };

  const renderSummary = (summary?: ProfitMonthData['summary'] | ProfitYearData['summary']) => {
    const salesKpi = formatSomKpiParts(summary?.salesAmount ?? 0, i18n.language);
    const volumeKpi = formatLitersKpiParts(summary?.volume ?? 0, i18n.language);
    const dieselSalesKpi = formatSomKpiParts(summary?.dieselSalesAmount ?? 0, i18n.language);
    const dieselVolumeKpi = formatLitersKpiParts(summary?.dieselVolume ?? 0, i18n.language);
    const purchaseKpi = formatSomKpiParts(summary?.purchaseAmount ?? 0, i18n.language);
    const salaryKpi = formatSomKpiParts(summary?.salary ?? 0, i18n.language);
    const otherKpi = formatSomKpiParts(summary?.otherFees ?? 0, i18n.language);
    const netProfitKpi = formatSomKpiParts(summary?.netProfit ?? 0, i18n.language);
    return (
      <div className="profit-kpi-grid">
        <ProfitKpiCard title={t('retail.totalSales')} value={salesKpi.value} unit={salesKpi.unit} lead={cnyExtraText(summary, 'salesAmount')} compare={kpiCompare(summary, 'salesAmount')} />
        <ProfitKpiCard title={t('retail.totalLiters')} value={volumeKpi.value} unit={volumeKpi.unit} lead={`${t('retail.totalTons')} ${formatRetailTonsKpi(summary?.tons ?? 0, i18n.language)}`} compare={kpiCompare(summary, 'volume')} />
        <ProfitKpiCard title={t('profit.dieselSalesAmount')} value={dieselSalesKpi.value} unit={dieselSalesKpi.unit} lead={cnyExtraText(summary, 'dieselSalesAmount')} compare={kpiCompare(summary, 'dieselSalesAmount')} />
        <ProfitKpiCard title={t('profit.dieselVolume')} value={dieselVolumeKpi.value} unit={dieselVolumeKpi.unit} lead={`${t('retail.totalTons')} ${formatRetailTonsKpi(summary?.dieselTons ?? 0, i18n.language)}`} compare={kpiCompare(summary, 'dieselVolume')} />
        <ProfitKpiCard title={t('profit.purchaseAmount')} value={purchaseKpi.value} unit={purchaseKpi.unit} lead={cnyExtraText(summary, 'purchaseAmount')} compare={kpiCompare(summary, 'purchaseAmount')} />
        <ProfitKpiCard title={t('profit.salary')} value={salaryKpi.value} unit={salaryKpi.unit} lead={cnyExtraText(summary, 'salary')} />
        <ProfitKpiCard title={t('profit.otherFees')} value={otherKpi.value} unit={otherKpi.unit} lead={cnyExtraText(summary, 'otherFees')} />
        <ProfitKpiCard title={t('profit.netProfit')} value={netProfitKpi.value} unit={netProfitKpi.unit} lead={cnyExtraText(summary, 'netProfit')} compare={kpiCompare(summary, 'netProfit')} />
      </div>
    );
  };

  const renderSnapshot = (data?: Pick<ProfitMonthData, 'snapshotGeneratedAt' | 'snapshotCached'> | Pick<ProfitYearData, 'snapshotGeneratedAt' | 'snapshotCached'> | null) => {
    if (!data?.snapshotGeneratedAt) return null;
    return (
      <Text type="secondary">
        {t(data.snapshotCached ? 'profit.snapshotCached' : 'profit.snapshotRefreshed', { time: data.snapshotGeneratedAt })}
      </Text>
    );
  };

  const monthStations = useMemo(() => {
    return [...(monthData?.stations || [])]
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftClosed = isNoOperationStation(left.row);
        const rightClosed = isNoOperationStation(right.row);
        if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
        return left.index - right.index;
      })
      .map(({ row }) => row);
  }, [monthData?.stations]);

  return (
    <div className="profit-view">
      {!canExport && (
        <Alert type="warning" message={t('profit.noPermission')} showIcon style={{ marginBottom: 12 }} />
      )}

      <Tabs
        className="profit-tabs"
        activeKey={mode}
        onChange={setMode}
        items={[
          {
            key: 'month',
            label: t('profit.monthlyTitle'),
            children: (
              <div className="profit-tab-panel">
                <div className="profit-fixed-section">
                  <Space wrap>
                    <Select value={year} onChange={setYear} style={{ width: 100 }}>
                      {yearOptions.map((y) => (
                        <Select.Option key={y} value={y}>{y}</Select.Option>
                      ))}
                    </Select>
                    <Select value={month} onChange={setMonth} style={{ width: 100 }}>
                      {Array.from({ length: 12 }, (_, i) => (
                        <Select.Option key={i + 1} value={i + 1}>{i + 1}{t('common.month')}</Select.Option>
                      ))}
                    </Select>
                    <Button icon={<ReloadOutlined />} disabled={!canExport} loading={loading && mode === 'month'} onClick={() => loadData(true)}>
                      {t('profit.refreshSnapshot')}
                    </Button>
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      disabled={!canExport}
                      loading={downloading === 'month'}
                      onClick={() => onDownload('month', () => downloadProfitReport(ym))}
                    >
                      {t('profit.downloadMonth')}
                    </Button>
                  </Space>
                  <Space wrap>
                    <Text type="secondary">{monthData ? `${monthData.queryStart} - ${monthData.queryEnd}` : ym}</Text>
                    {renderSnapshot(monthData)}
                  </Space>
                  {renderSummary(monthData?.summary)}
                </div>
                <div className="profit-table-scroll">
                  <Table
                    rowKey="shopKey"
                    size="small"
                    loading={loading && mode === 'month'}
                    columns={monthColumns}
                    dataSource={monthStations}
                    scroll={{ x: 'max-content' }}
                    tableLayout="auto"
                    pagination={{ pageSize: 30, showSizeChanger: false }}
                    expandable={{
                      expandedRowRender: (record) => (
                        <Table
                          rowKey={(row) => `${record.shopKey}-${row.resourceKey}`}
                          size="small"
                          columns={productColumns}
                          dataSource={record.rows || []}
                          pagination={false}
                          scroll={{ x: 'max-content' }}
                          tableLayout="auto"
                        />
                      ),
                    }}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'year',
            label: t('profit.yearlyTitle'),
            children: (
              <div className="profit-tab-panel">
                <div className="profit-fixed-section">
                  <Space wrap>
                    <Select value={year} onChange={setYear} style={{ width: 100 }}>
                      {yearOptions.map((y) => (
                        <Select.Option key={y} value={y}>{y}</Select.Option>
                      ))}
                    </Select>
                    <Button icon={<ReloadOutlined />} disabled={!canExport} loading={loading && mode === 'year'} onClick={() => loadData(true)}>
                      {t('profit.refreshSnapshot')}
                    </Button>
                    <Button
                      type="primary"
                      icon={<FileExcelOutlined />}
                      disabled={!canExport}
                      loading={downloading === 'year'}
                      onClick={() => onDownload('year', () => downloadProfitYearReport(year))}
                    >
                      {t('profit.downloadYear')}
                    </Button>
                  </Space>
                  <Space wrap>
                    <Text type="secondary">{t('profit.includedMonths', { count: yearData?.includedMonths || 0 })}</Text>
                    {renderSnapshot(yearData)}
                  </Space>
                  {renderSummary(yearData?.summary)}
                </div>
                <div className="profit-table-scroll">
                  <Table
                    rowKey="month"
                    size="small"
                    loading={loading && mode === 'year'}
                    columns={yearColumns}
                    dataSource={yearData?.months || []}
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    tableLayout="auto"
                    summary={() => yearData ? (
                      <Table.Summary fixed>
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0}>{t('profit.total')}</Table.Summary.Cell>
                          <Table.Summary.Cell index={1} />
                          {yearSummaryKeys.map(([key, digits], index) => (
                            <Table.Summary.Cell key={key} index={index + 2} align="center">
                              {key === 'avgCnyKgs' && (yearData.summary as any)[key] == null ? '-' : amount((yearData.summary as any)[key], digits)}
                            </Table.Summary.Cell>
                          ))}
                        </Table.Summary.Row>
                      </Table.Summary>
                    ) : null}
                  />
                </div>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
