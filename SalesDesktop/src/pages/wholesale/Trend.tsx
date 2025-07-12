import { useState } from 'react';
import { Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { CHART_PALETTE } from '@/theme/charts';

export default function Trend() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const trend = q.data?.dailyTrend ?? [];

  const trendOption = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, formatter: (p: any) => {
      const list = Array.isArray(p) ? p : [p];
      let html = `<b>${list[0]?.axisValue || ''}</b>`;
      list.forEach((item: any) => {
        html += `<br/>${item.marker} ${item.seriesName}: ${item.value}${item.seriesName === t('wholesale.amountCny') ? '¥万' : ' т'}`;
      });
      return html;
    } },
    legend: { data: [t('wholesale.export_wholesale'), t('wholesale.local_wholesale'), t('wholesale.unknown'), t('wholesale.transferClass'), t('wholesale.amountCny')], bottom: 0 },
    xAxis: { type: 'category' as const, name: t('common.date'), nameLocation: 'center' as const, nameGap: 30, data: trend.map((d) => d.date.slice(5)) },
    yAxis: [
      { type: 'value' as const, name: 'т' },
      { type: 'value' as const, name: '¥万' },
    ],
    series: [
      { name: t('wholesale.export_wholesale'), type: 'line' as const, data: trend.map((d) => d.exportTons) },
      { name: t('wholesale.local_wholesale'), type: 'line' as const, data: trend.map((d) => d.localTons) },
      { name: t('wholesale.unknown'), type: 'line' as const, lineStyle: { type: 'dashed' as const }, data: trend.map((d) => d.pendingTons) },
      { name: t('wholesale.transferClass'), type: 'line' as const, data: trend.map((d) => d.transferTons) },
      { name: t('wholesale.amountCny'), type: 'bar' as const, yAxisIndex: 1, data: trend.map((d) => Math.round(d.amountCny / 10000)) },
    ],
  };

  const trendColumns = [
    { title: t('common.date'), dataIndex: 'date', key: 'date' },
    { title: t('wholesale.export_wholesale'), dataIndex: 'exportTons', key: 'exportTons', render: (v: number) => `${v} т` },
    { title: t('wholesale.local_wholesale'), dataIndex: 'localTons', key: 'localTons', render: (v: number) => `${v} т` },
    { title: t('wholesale.unknown'), dataIndex: 'pendingTons', key: 'pendingTons', render: (v: number) => `${v} т` },
    { title: t('wholesale.transferClass'), dataIndex: 'transferTons', key: 'transferTons', render: (v: number) => `${v} т` },
    { title: t('wholesale.amountCny'), dataIndex: 'amountCny', key: 'amountCny', render: (v: number) => `¥${v.toLocaleString()}` },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      <ChartCard title={t('wholesale.dailyTrend')} loading={q.isLoading} option={trendOption} height={400} />
      <TableCard title={t('wholesale.dailyTrend')} columns={trendColumns} data={trend} rowKey="date" loading={q.isLoading} />
    </div>
  );
}
