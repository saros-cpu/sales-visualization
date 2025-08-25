import { useEffect, useState, useCallback } from 'react';
import { Table, DatePicker, Button, Space, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getWholesaleDetails, WholesaleItem } from '@/api/wholesale';

const { RangePicker } = DatePicker;

export default function Query() {
  const { t } = useTranslation();
  const [data, setData] = useState<WholesaleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWholesaleDetails({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page, page_size: 50,
      });
      setData(res.items);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [dates, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const classificationColors: Record<string, string> = {
    export_wholesale: 'blue',
    local_wholesale: 'cyan',
    processing: 'purple',
    procurement: 'orange',
    transfer: 'geekblue',
    unknown: 'default',
  };
  const normalizeClassification = (value?: string) => {
    if (value === 'external_transport') return 'transfer';
    if (value === 'toll_processing') return 'processing';
    return value || 'unknown';
  };
  const classificationLabelKeys: Record<string, string> = {
    transfer: 'wholesale.transferClass',
    export_wholesale: 'wholesale.export_wholesale',
    local_wholesale: 'wholesale.local_wholesale',
    processing: 'wholesale.processing',
    procurement: 'wholesale.procurement',
    unknown: 'wholesale.unknown',
  };
  const sourceAliases: Record<string, string> = {
    kj_weighing: 'storagedistrict',
    storage_district: 'storagedistrict',
    lpg_weighing: 'lpg',
    lpg_storage: 'lpg',
    south_CTY-30: 'south_CTY-30_depot',
    CTY-30: 'south_CTY-30_depot',
    CTY-30_depot: 'south_CTY-30_depot',
    north_CTY-22-LAT: 'north_CTY-22-LAT_depot',
    CTY-22-LAT: 'north_CTY-22-LAT_depot',
    CTY-22-LAT_depot: 'north_CTY-22-LAT_depot',
  };
  const sourceLabel = (value?: string) => {
    const raw = String(value || 'unknown').trim();
    const normalized = sourceAliases[raw.toLowerCase()] || raw;
    return <span className="wholesale-query-two-line">{t(`wholesale.sources.${normalized}`, { defaultValue: value || '--' })}</span>;
  };
  const withStandard = (raw?: string, standard?: string) => {
    const rawValue = raw || standard || '--';
    if (!standard || standard === raw) return <span className="wholesale-query-two-line">{rawValue}</span>;
    return <span className="wholesale-query-two-line">{rawValue}<br /><small style={{ color: '#8c8c8c' }}>{t('aliases.standardName')}：{standard}</small></span>;
  };
  const twoLineText = (value?: string) => <span className="wholesale-query-two-line">{value || '--'}</span>;

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', width: '7%', ellipsis: true, responsive: ['md' as const] },
    { title: t('weighing.weighSerialNo'), dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: '11%', responsive: ['lg' as const], render: twoLineText },
    {
      title: t('weighing.rawProductName'),
      dataIndex: 'rawProductName',
      key: 'rawProductName',
      width: '10%',
      render: (_: string, row: WholesaleItem) => withStandard(row.rawProductName || row.productName, row.standardProductName),
    },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: '7%', ellipsis: true },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: '14%', render: twoLineText },
    {
      title: t('weighing.receiverName'),
      dataIndex: 'rawEntityName',
      key: 'rawEntityName',
      width: '16%',
      render: (_: string, row: WholesaleItem) => withStandard(row.rawEntityName || row.entityName, row.standardEntityName),
    },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: '7%', align: 'center' as const, render: (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) },
    {
      title: t('common.classification'), dataIndex: 'classification', key: 'classification',
      width: '7%',
      align: 'center' as const,
      render: (v: string) => {
        const normalized = normalizeClassification(v);
        return <Tag color={classificationColors[normalized] || 'default'}>{t(classificationLabelKeys[normalized], { defaultValue: normalized })}</Tag>;
      },
    },
    { title: t('common.source'), dataIndex: 'weighSource', key: 'weighSource', width: '8%', responsive: ['lg' as const], render: sourceLabel },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: '13%', responsive: ['xl' as const], render: twoLineText },
  ];

  return (
    <div>
      <div className="page-toolbar">
        <h2>{t('wholesale.query')}</h2>
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
        </Space>
      </div>
      <Table className="wholesale-query-table" dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        tableLayout="fixed" />
    </div>
  );
}
