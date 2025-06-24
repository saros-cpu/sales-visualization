import { useState } from 'react';
import { Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';

export default function Trend() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const trend = q.data?.dailyTrend ?? [];

  const trendOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: [t('wholesale.exportWholesale'), t('wholesale.localWholesale'), t('wholesale.unknown'), t('wholesale.transferClass'), t('wholesale.amountCny')], bottom: 0 },
    xAxis: { type: 'category' as const, data: trend.map((d) => d.date.slice(5)) },
    yAxis: [
      { type: 'value' as const, name: 'т' },
      { type: 'value' as const, name: '¥万' },
    ],
    series: [
      { name: t('wholesale.exportWholesale'), type: 'line' as const, data: trend.map((d) => d.exportTons) },
      { name: t('wholesale.localWholesale'), type: 'line' as const, data: trend.map((d) => d.localTons) },
      { name: t('wholesale.unknown'), type: 'line' as const, lineStyle: { type: 'dashed' as const }, data: trend.map((d) => d.pendingTons) },
      { name: t('wholesale.transferClass'), type: 'line' as const, data: trend.map((d) => d.transferTons) },
      { name: t('wholesale.amountCny'), type: 'bar' as const, yAxisIndex: 1, data: trend.map((d) => Math.round(d.amountCny / 10000)) },
    ],
  };

  const trendColumns = [
    { title: t('common.date'), dataIndex: 'date', key: 'date' },
    { title: t('wholesale.exportWholesale'), dataIndex: 'exportTons', key: 'exportTons', render: (v: number) => `${v} т` },
    { title: t('wholesale.localWholesale'), dataIndex: 'localTons', key: 'localTons', render: (v: number) => `${v} т` },
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
