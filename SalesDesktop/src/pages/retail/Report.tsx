import { useState, useMemo } from 'react';
import { Button, Space, Tabs, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getMonthly } from '@/api/retail';
import { exportExcel } from '@/api/export';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';
import { useAuth } from '@/contexts/AuthContext';

export default function Report() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { region, station } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const monthQ = useApiQuery(['retail', 'monthly', ym], () => getMonthly(ym));
  const data = monthQ.data;
  const stations = data?.stations ?? [];
  const regions = data?.regions ?? {};
  const cashOf = (row: any) => Number(row?.cash ?? row?.cashSales ?? 0);
  const cardOf = (row: any) => Number(row?.card ?? row?.cardSales ?? 0);
  const amountOf = (row: any) => Number(row?.amount ?? row?.totalSales ?? 0);
  const wan = (value: number) => `${Math.round(Number(value || 0) / 10000)}${t('common.wan')}`;
  const paymentAmountUnit = `${t('common.wan')} сом`;
  const paymentAmountTitle = (label: string) => `${label} (${paymentAmountUnit})`;
  const paymentAmountText = (value: number) => Number(value || 0).toLocaleString();
  const cardRatio = (row: any) => {
    const amount = amountOf(row);
    return amount > 0 ? `${Math.round((cardOf(row) / amount) * 100)}%` : '-';
  };
  const statusText = (row: any) => {
    const value = row?.statusType || row?.closedReason || row?.status || '';
    const key = String(value || '').toLowerCase();
    if (['normal', 'active', 'open', 'operating', '在营', '正常营业', '正在营业'].includes(key)) return { text: '在营', color: 'green' };
    if (['renovation', 'renovating', 'repair', 'maintenance', '装修', '装修停业', '装修/维修'].includes(key) || key.includes('装修')) return { text: '装修', color: 'orange' };
    if (['suspended', 'closed', 'inactive', '停业', '关闭', '暂停营业'].includes(key) || key.includes('停业')) return { text: '停业', color: 'red' };
    return { text: row?.statusLabel || row?.status || '--', color: 'default' };
  };

  const stationColumns = [
    { title: t('retail.station'), dataIndex: 'name', key: 'name', sorter: (a: any, b: any) => a.name.localeCompare(b.name), render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', render: (v: string) => region(v) },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', sorter: (a: any, b: any) => amountOf(a) - amountOf(b), render: (v: number) => wan(v) },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${Math.round(v).toLocaleString()}L` },
    { title: t('retail.cash'), key: 'cash', render: (_: any, r: any) => wan(cashOf(r)) },
    { title: t('retail.card'), key: 'card', render: (_: any, r: any) => wan(cardOf(r)) },
    { title: t('retail.cardRatio'), key: 'cardRatio', render: (_: any, r: any) => cardRatio(r) },
    { title: t('retail.status'), dataIndex: 'status', key: 'status', render: (_: string, row: any) => {
      const status = statusText(row);
      return <Tag color={status.color}>{status.text}</Tag>;
    } },
  ];

  const regionColumns = [
    { title: t('retail.region'), dataIndex: 'name', key: 'name', render: (v: string) => region(v) },
    { title: t('retail.station'), dataIndex: 'stationCount', key: 'stationCount' },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', sorter: (a: any, b: any) => amountOf(a) - amountOf(b), render: (v: number) => wan(v) },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${Math.round(v).toLocaleString()}L` },
    { title: t('retail.cash'), key: 'cash', render: (_: any, r: any) => wan(cashOf(r)) },
    { title: t('retail.card'), key: 'card', render: (_: any, r: any) => wan(cardOf(r)) },
    { title: t('retail.cardRatio'), key: 'cardRatio', render: (_: any, r: any) => cardRatio(r) },
  ];

  const regionData = useMemo(() =>
    Object.entries(regions).map(([name, r]: [string, any]) => ({ name, ...r })),
    [regions],
  );

  const paymentData = useMemo(() =>
    stations.map((s: any) => ({
      key: s.shopKey, name: s.name, short: s.short, region: s.region,
      cash: Math.round(cashOf(s) / 10000), card: Math.round(cardOf(s) / 10000),
      total: Math.round((cashOf(s) + cardOf(s)) / 10000),
      cashRatio: amountOf(s) > 0 ? `${Math.round((cashOf(s) / amountOf(s)) * 100)}%` : '-',
      cardRatio: cardRatio(s),
    })),
    [stations],
  );

  const paymentColumns = [
    { title: t('retail.station'), dataIndex: 'name', key: 'name', align: 'center' as const, render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', align: 'center' as const, render: (v: string) => region(v) },
    { title: paymentAmountTitle(t('retail.cash')), dataIndex: 'cash', key: 'cash', align: 'center' as const, render: paymentAmountText },
    { title: paymentAmountTitle(t('retail.card')), dataIndex: 'card', key: 'card', align: 'center' as const, render: paymentAmountText },
    { title: paymentAmountTitle(t('common.totalAmount')), dataIndex: 'total', key: 'total', align: 'center' as const, render: paymentAmountText },
    { title: t('retail.cardRatio'), dataIndex: 'cardRatio', key: 'cardRatio', align: 'center' as const },
  ];

  const onExport = () => exportExcel(ym);

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
        {canExport && <Button onClick={onExport}>{t('common.excelExport')}</Button>}
      </Space>
      <Tabs items={[
        { key: 'station', label: t('retail.byStation'), children: (
          <Table columns={stationColumns} dataSource={stations} rowKey="shopKey" loading={monthQ.isLoading} size="small" pagination={{ pageSize: 20, showTotal: (tot) => t('common.total', { count: tot }) }} scroll={{ x: 'max-content', y: 'calc(100vh - 380px)' }} />
        )},
        { key: 'region', label: t('retail.byRegion'), children: (
          <Table columns={regionColumns} dataSource={regionData} rowKey="name" loading={monthQ.isLoading} size="small" pagination={false} scroll={{ x: 'max-content' }} />
        )},
        { key: 'payment', label: t('retail.byPayment'), children: (
          <Table columns={paymentColumns} dataSource={paymentData} rowKey="key" loading={monthQ.isLoading} size="small" pagination={{ pageSize: 20, showTotal: (tot) => t('common.total', { count: tot }) }} scroll={{ x: 'max-content', y: 'calc(100vh - 380px)' }} />
        )},
      ]} />
    </div>
  );
}
