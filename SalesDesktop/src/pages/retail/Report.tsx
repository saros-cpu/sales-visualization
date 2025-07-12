import { useState, useMemo } from 'react';
import { Row, Col, Button, Space, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getMonthly } from '@/api/retail';
import { exportExcel } from '@/api/export';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';

export default function Report() {
  const { t } = useTranslation();
  const { region, station } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const monthQ = useApiQuery(['retail', 'monthly', ym], () => getMonthly(ym));
  const data = monthQ.data;
  const stations = data?.stations ?? [];
  const regions = data?.regions ?? {};

  const stationColumns = [
    { title: t('retail.station'), dataIndex: 'name', key: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', render: (v: string) => region(v) },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', sorter: (a: any, b: any) => a.amount - b.amount, render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${Math.round(v).toLocaleString()}L` },
    { title: t('retail.cash'), dataIndex: 'cash', key: 'cash', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.card'), dataIndex: 'card', key: 'card', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.cardRatio'), key: 'cardRatio', render: (_: any, r: any) => r.amount > 0 ? `${Math.round((r.card / r.amount) * 100)}%` : '-' },
    { title: t('retail.status'), dataIndex: 'status', key: 'status' },
  ];

  const regionColumns = [
    { title: t('retail.region'), dataIndex: 'name', key: 'name', render: (v: string) => region(v) },
    { title: t('retail.station'), dataIndex: 'stationCount', key: 'stationCount' },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', sorter: (a: any, b: any) => a.amount - b.amount, render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${Math.round(v).toLocaleString()}L` },
    { title: t('retail.cash'), dataIndex: 'cash', key: 'cash', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.card'), dataIndex: 'card', key: 'card', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.cardRatio'), key: 'cardRatio', render: (_: any, r: any) => r.amount > 0 ? `${Math.round((r.card / r.amount) * 100)}%` : '-' },
  ];

  const regionData = useMemo(() =>
    Object.entries(regions).map(([name, r]: [string, any]) => ({ name, ...r })),
    [regions],
  );

  const paymentData = useMemo(() =>
    stations.map((s: any) => ({
      key: s.shopKey, name: s.name, short: s.short, region: s.region,
      cash: Math.round(s.cash / 10000), card: Math.round(s.card / 10000),
      total: Math.round((s.cash + s.card) / 10000),
      cashRatio: s.amount > 0 ? `${Math.round((s.cash / s.amount) * 100)}%` : '-',
      cardRatio: s.amount > 0 ? `${Math.round((s.card / s.amount) * 100)}%` : '-',
    })),
    [stations],
  );

  const paymentColumns = [
    { title: t('retail.station'), dataIndex: 'name', key: 'name', render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', render: (v: string) => region(v) },
    { title: t('retail.cash'), dataIndex: 'cash', key: 'cash' },
    { title: t('retail.card'), dataIndex: 'card', key: 'card' },
    { title: t('common.total'), dataIndex: 'total', key: 'total' },
    { title: t('retail.cardRatio'), dataIndex: 'cardRatio', key: 'cardRatio' },
  ];

  const onExport = () => exportExcel(ym);

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
        <Button onClick={onExport}>{t('common.excelExport')}</Button>
      </Space>
      <Tabs items={[
        { key: 'station', label: t('retail.byStation'), children: (
          <TableCard title={t('retail.byStation')} columns={stationColumns} data={stations} rowKey="shopKey" loading={monthQ.isLoading} />
        )},
        { key: 'region', label: t('retail.byRegion'), children: (
          <TableCard title={t('retail.byRegion')} columns={regionColumns} data={regionData} rowKey="name" loading={monthQ.isLoading} />
        )},
        { key: 'payment', label: t('retail.byPayment'), children: (
          <TableCard title={t('retail.byPayment')} columns={paymentColumns} data={paymentData} rowKey="key" loading={monthQ.isLoading} />
        )},
      ]} />
    </div>
  );
}
