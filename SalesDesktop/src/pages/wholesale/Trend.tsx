import { useState } from 'react';
import { Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { CHART_AXIS, CHART_PALETTE } from '@/theme/charts';

type TrendRow = {
  date?: string;
  month?: string;
  exportTons?: number;
  localTons?: number;
  pendingTons?: number;
  transferTons?: number;
  processingTons?: number;
  procurementTons?: number;
  amountCny?: number;
};

export default function Trend() {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const trend = (month ? (q.data?.dailyTrend ?? []) : ((q.data?.monthlyTrend?.length ? q.data.monthlyTrend : q.data?.dailyTrend) ?? [])) as TrendRow[];
  const periodKey = month ? 'date' : 'month';
  const trendLabel = (item: TrendRow) => (month ? item.date : item.month) || item.date || item.month || '';
  const showPending = trend.some((d) => Number(d.pendingTons || 0) > 0);
  const showProcessing = trend.some((d) => Number(d.processingTons || 0) > 0);
  const showProcurement = trend.some((d) => Number(d.procurementTons || 0) > 0);
  const legendData = [
    t('wholesale.export_wholesale'),
    t('wholesale.local_wholesale'),
    ...(showPending ? [t('wholesale.unknown')] : []),
    t('wholesale.transferClass'),
    ...(showProcessing ? [t('wholesale.processing')] : []),
    ...(showProcurement ? [t('wholesale.procurement')] : []),
    t('wholesale.amountCny'),
  ];
  const series = [
    { name: t('wholesale.export_wholesale'), type: 'line' as const, data: trend.map((d) => d.exportTons || 0) },
    { name: t('wholesale.local_wholesale'), type: 'line' as const, data: trend.map((d) => d.localTons || 0) },
    ...(showPending ? [{ name: t('wholesale.unknown'), type: 'line' as const, lineStyle: { type: 'dashed' as const }, data: trend.map((d) => d.pendingTons || 0) }] : []),
    { name: t('wholesale.transferClass'), type: 'line' as const, data: trend.map((d) => d.transferTons || 0) },
    ...(showProcessing ? [{ name: t('wholesale.processing'), type: 'line' as const, data: trend.map((d) => d.processingTons || 0) }] : []),
    ...(showProcurement ? [{ name: t('wholesale.procurement'), type: 'line' as const, data: trend.map((d) => d.procurementTons || 0) }] : []),
    { name: t('wholesale.amountCny'), type: 'bar' as const, yAxisIndex: 1, data: trend.map((d) => Math.round(Number(d.amountCny || 0) / 10000)) },
  ];
  const isRu = i18n.language.startsWith('ru');
  const tonsUnit = isRu ? 'т' : CHART_AXIS.tons;
  const amountUnit = isRu ? '10 тыс. CNY' : CHART_AXIS.wanCny;

  const trendOption = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, formatter: (p: any) => {
      const list = Array.isArray(p) ? p : [p];
      let html = `<b>${list[0]?.axisValue || ''}</b>`;
      list.forEach((item: any) => {
        const unit = item.seriesName === t('wholesale.amountCny') ? amountUnit : tonsUnit;
        html += `<br/>${item.marker} ${item.seriesName}: ${item.value}${isRu ? ' ' : ''}${unit}`;
      });
      return html;
    } },
    legend: { data: legendData, bottom: 0 },
    xAxis: { type: 'category' as const, data: trend.map((d) => trendLabel(d).slice(5) || trendLabel(d)) },
    yAxis: [
      { type: 'value' as const, name: tonsUnit },
      { type: 'value' as const, name: amountUnit },
    ],
    series,
  };

  const trendColumns = [
    { title: month ? t('common.date') : t('common.month', { defaultValue: '月份' }), dataIndex: periodKey, key: periodKey },
    { title: t('wholesale.export_wholesale'), dataIndex: 'exportTons', key: 'exportTons', render: (v: number) => `${v || 0} т` },
    { title: t('wholesale.local_wholesale'), dataIndex: 'localTons', key: 'localTons', render: (v: number) => `${v || 0} т` },
    ...(showPending ? [{ title: t('wholesale.unknown'), dataIndex: 'pendingTons', key: 'pendingTons', render: (v: number) => `${v || 0} т` }] : []),
    { title: t('wholesale.transferClass'), dataIndex: 'transferTons', key: 'transferTons', render: (v: number) => `${v || 0} т` },
    ...(showProcessing ? [{ title: t('wholesale.processing'), dataIndex: 'processingTons', key: 'processingTons', render: (v: number) => `${v || 0} т` }] : []),
    ...(showProcurement ? [{ title: t('wholesale.procurement'), dataIndex: 'procurementTons', key: 'procurementTons', render: (v: number) => `${v || 0} т` }] : []),
    { title: t('wholesale.amountCny'), dataIndex: 'amountCny', key: 'amountCny', render: (v: number) => `¥${Number(v || 0).toLocaleString()}` },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      <ChartCard title={month ? t('wholesale.dailyTrend') : t('wholesale.monthlyTrend', { defaultValue: '月度趋势' })} loading={q.isLoading} option={trendOption} height={400} />
      <TableCard title={month ? t('wholesale.dailyTrend') : t('wholesale.monthlyTrend', { defaultValue: '月度趋势' })} columns={trendColumns} data={trend} rowKey={(row) => trendLabel(row as TrendRow)} loading={q.isLoading} pageSize={31} scrollY={320} />
    </div>
  );
}
