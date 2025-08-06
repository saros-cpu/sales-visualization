import { useState, useMemo } from 'react';
import { Button, Space, Input, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getSelfUse } from '@/api/retail';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';

export default function SelfUse() {
  const { t } = useTranslation();
  const { product } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useApiQuery(['retail', 'self-use', ym], () => getSelfUse(ym));

  const filtered = useMemo(() => {
    if (!data?.records) return [];
    if (!search) return data.records;
    const q = search.toLowerCase();
    return data.records.filter(r => r.plateNumber.toLowerCase().includes(q));
  }, [data, search]);

  const columns = [
    { title: t('common.date'), dataIndex: 'date', key: 'date', defaultSortOrder: 'descend' as const, sorter: (a: any, b: any) => a.date.localeCompare(b.date) },
    { title: t('retail.station'), dataIndex: 'stationName', key: 'stationName' },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', render: (v: string) => product(v) },
    { title: t('retail.plateNumber'), dataIndex: 'plateNumber', key: 'plateNumber', render: (v: string) => v || '-' },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}L` },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', sorter: (a: any, b: any) => a.amount - b.amount, render: (v: number) => `${v.toLocaleString(undefined, { minimumFractionDigits: 2 })} сом` },
  ];

  const summary = data?.summary;

  return (
    <div>
      {error && <Alert type="error" message={error.message} closable style={{ marginBottom: 12 }} />}
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
        <Input.Search placeholder={t('retail.searchPlate')} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} allowClear />
        <Button onClick={() => {
          const token = localStorage.getItem('accessToken') || '';
          const url = `http://198.51.100.10:8080/api/export/self-use/${ym}`;
          if ((window as any).electronAPI?.downloadFile) {
            (window as any).electronAPI.downloadFile(url, `自用油_${ym}.xlsx`, token);
          } else {
            const a = document.createElement('a');
            a.href = token ? `${url}?token=${token}` : url;
            a.download = `自用油_${ym}.xlsx`;
            a.click();
          }
        }}>{t('common.excelExport')}</Button>
      </Space>
      {summary && (
        <Space style={{ marginBottom: 12, color: '#666' }}>
          <span>{t('common.total')}: {t('retail.volume')} {summary.totalVolume.toLocaleString()}L / {t('retail.amount')} {summary.totalAmount.toLocaleString()} сом</span>
        </Space>
      )}
      <TableCard
        title={`${t('retail.selfUse')} - ${ym}`}
        columns={columns}
        data={filtered}
        rowKey="transactionKey"
        loading={isLoading}
      />
    </div>
  );
}
