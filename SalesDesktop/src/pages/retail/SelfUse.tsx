import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button, Space, Input, Alert, DatePicker, Table } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getSelfUseByRange } from '@/api/retail';
import { API_HOST } from '@/api/http';
import { useNameI18n } from '@/utils/i18nNames';
import { useAuth } from '@/contexts/AuthContext';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function SelfUse() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { product, station } = useNameI18n();
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSelfUseByRange(
        dates[0].format('YYYY-MM-DD'),
        dates[1].format('YYYY-MM-DD'),
      );
      setData(res);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [dates]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!data?.records) return [];
    if (!search) return data.records;
    const q = search.toLowerCase();
    return data.records.filter(r => String(r.plateNumber || '').toLowerCase().includes(q));
  }, [data, search]);

  const columns = [
    { title: t('common.date'), dataIndex: 'date', key: 'date', defaultSortOrder: 'descend' as const, sorter: (a: any, b: any) => a.date.localeCompare(b.date) },
    { title: t('common.time'), dataIndex: 'time', key: 'time' },
    { title: t('retail.station'), dataIndex: 'stationName', key: 'stationName', render: (_: string, r: any) => station({ name: r.stationName, short: r.stationShort }) },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', render: (v: string | number) => product(String(v || '')) },
    { title: t('retail.plateNumber'), dataIndex: 'plateNumber', key: 'plateNumber', render: (v: string | number) => String(v || '-') },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', sorter: (a: any, b: any) => a.volume - b.volume, render: (v: number) => `${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}L` },
  ];

  const summary = data?.summary;

  return (
    <div>
      {error && <Alert type="error" message={error.message} closable style={{ marginBottom: 12 }} />}
      <Space wrap style={{ marginBottom: 16 }}>
        <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
        <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
        <Input.Search placeholder={t('retail.searchPlate')} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} allowClear />
        {canExport && (
          <Button onClick={() => {
            const token = localStorage.getItem('accessToken') || '';
            const date_from = dates[0].format('YYYY-MM-DD');
            const date_to = dates[1].format('YYYY-MM-DD');
            const url = `/api/export/self-use?date_from=${date_from}&date_to=${date_to}`;
            if ((window as any).electronAPI?.downloadFile) {
              (window as any).electronAPI.downloadFile(`${API_HOST}${url}`, `自用油_${date_from}_to_${date_to}.xlsx`, token);
            } else {
              const a = document.createElement('a');
              a.href = token ? `${url}&token=${token}` : url;
              a.download = `自用油_${date_from}_to_${date_to}.xlsx`;
              a.click();
            }
          }}>{t('common.excelExport')}</Button>
        )}
      </Space>
      {summary && (
        <Space style={{ marginBottom: 12, color: '#666' }}>
          <span>{t('common.total', { count: summary.totalRecords })} {t('retail.volume')} {summary.totalVolume.toLocaleString()}L</span>
        </Space>
      )}
      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="transactionKey"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showTotal: (count) => t('common.total', { count }) }}
        scroll={{ x: 'max-content', y: 'calc(100vh - 320px)' }}
      />
    </div>
  );
}
