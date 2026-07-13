import { useEffect, useState, useCallback, type Key } from 'react';
import { Row, Col, Statistic, Table, Card, DatePicker, Input, Button, Space, Tag, Select, message } from 'antd';
import { SearchOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { batchReviewWeighing, getWeighingList, WeighingItem } from '@/api/weighing';
import { downloadWholesaleDetails } from '@/api/export';
import { useAuth } from '@/contexts/AuthContext';

const { RangePicker } = DatePicker;

const normalizeClassification = (value?: string) => {
  if (value === 'external_transport') return 'transfer';
  if (value === 'toll_processing') return 'processing';
  return value || 'unknown';
};

const classificationMeta: Record<string, { color: string; labelKey: string }> = {
  transfer: { color: 'geekblue', labelKey: 'wholesale.transferClass' },
  export_wholesale: { color: 'blue', labelKey: 'wholesale.export_wholesale' },
  local_wholesale: { color: 'cyan', labelKey: 'wholesale.local_wholesale' },
  processing: { color: 'purple', labelKey: 'wholesale.processing' },
  procurement: { color: 'orange', labelKey: 'wholesale.procurement' },
  unknown: { color: 'default', labelKey: 'wholesale.unknown' },
};
const classificationOptions = ['transfer', 'export_wholesale', 'local_wholesale', 'processing', 'procurement', 'unknown'];
const reviewStatusMeta: Record<string, { color: string; labelKey: string }> = {
  pending: { color: 'gold', labelKey: 'weighing.reviewStatus.pending' },
  approved: { color: 'green', labelKey: 'weighing.reviewStatus.approved' },
  rejected: { color: 'red', labelKey: 'weighing.reviewStatus.rejected' },
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

export default function WeighingList() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canVerify = can('weighing:verify');
  const canExport = can('weighing:export');
  const [data, setData] = useState<WeighingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [vehicleNo, setVehicleNo] = useState('');
  const [status, setStatus] = useState<string>('');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [selectedRows, setSelectedRows] = useState<WeighingItem[]>([]);
  const [batchClassification, setBatchClassification] = useState<string>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWeighingList({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        vehicle_no: vehicleNo || undefined,
        status: status || undefined,
        page,
        page_size: 50,
      });
      setData(res.items);
      setTotal(res.total);
      setTotalWeight(res.totalWeight || 0);
      setSelectedRowKeys([]);
      setSelectedRows([]);
    } finally {
      setLoading(false);
    }
  }, [dates, vehicleNo, status, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = useCallback(async () => {
    try {
      const ym = dates[0].format('YYYY-MM');
      await downloadWholesaleDetails(ym);
      message.success(t('common.downloadStarted'));
    } catch {
      message.error(t('common.downloadFailed'));
    }
  }, [dates, t]);

  const totalKg = totalWeight;
  const selectedCount = selectedRows.length;
  const runBatchReview = async (action: 'approve' | 'reject' | 'classify') => {
    if (!selectedRows.length) {
      message.warning(t('common.selectRowsFirst'));
      return;
    }
    if (action === 'classify' && !batchClassification) {
      message.warning(t('weighing.selectClassification'));
      return;
    }
    setLoading(true);
    try {
      const res = await batchReviewWeighing({
        action,
        classification: action === 'classify' ? batchClassification : undefined,
        records: selectedRows.map((row) => ({ source: row.source, id: row.id, classification: row.classification })),
      });
      message.success(t('common.batchDone', { count: res.successCount ?? selectedRows.length }));
      await fetchData();
    } finally {
      setLoading(false);
    }
  };

  const twoLineText = (value?: string | number | null) => (
    <span className="weighing-list-two-line">{value === null || value === undefined || value === '' ? '--' : value}</span>
  );
  const sourceLabel = (value?: string) => {
    const raw = String(value || 'unknown').trim();
    const normalized = sourceAliases[raw.toLowerCase()] || raw;
    return <span className="weighing-list-two-line">{t(`wholesale.sources.${normalized}`, { defaultValue: value || '--' })}</span>;
  };
  const weightText = (value?: number | null) => (
    value === null || value === undefined ? '--' : Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })
  );

  const columns = [
    { title: t('weighing.weighSerialNo'), dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: '9%', responsive: ['lg' as const], render: twoLineText },
    { title: t('weighing.businessDate'), dataIndex: 'businessDate', key: 'businessDate', width: '7%', responsive: ['md' as const] },
    { title: t('weighing.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: '6%', render: twoLineText },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: '13%', render: twoLineText },
    { title: t('weighing.receiverName'), dataIndex: 'receiverName', key: 'receiverName', width: '14%', render: twoLineText },
    { title: t('weighing.rawProductName'), dataIndex: 'rawProductName', key: 'rawProductName', width: '9%', render: (v: string) => twoLineText(t(`product.${v}`, { defaultValue: v || '--' })) },
    { title: t('weighing.grossWeight'), dataIndex: 'grossWeight', key: 'grossWeight', width: '5%', responsive: ['xl' as const], render: weightText },
    { title: t('weighing.tareWeight'), dataIndex: 'tareWeight', key: 'tareWeight', width: '5%', responsive: ['xl' as const], render: weightText },
    { title: t('weighing.netWeight'), dataIndex: 'netWeight', key: 'netWeight', width: '6%', render: weightText },
    {
      title: t('weighing.classification'), dataIndex: 'classification', key: 'classification', width: '6%',
      render: (v: string) => {
        const normalized = normalizeClassification(v);
        const meta = classificationMeta[normalized];
        if (meta) return <Tag color={meta.color}>{t(meta.labelKey)}</Tag>;
        // 兜底：未知/其他分类值仍显示可读标签
        return <Tag color="default">{t(`wholesale.${v}`, { defaultValue: v || t('weighing.unknown') })}</Tag>;
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: '6%',
      render: (value: string) => {
        const meta = reviewStatusMeta[value] || reviewStatusMeta.pending;
        return <Tag color={meta.color}>{t(meta.labelKey)}</Tag>;
      },
    },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: '8%', responsive: ['lg' as const], render: twoLineText },
    { title: t('common.source'), dataIndex: 'source', key: 'source', width: '7%', responsive: ['lg' as const], render: sourceLabel },
  ];

  return (
    <div className="client-fit-page">
      <Row gutter={[16, 16]} className="client-fit-fixed">
        <Col xs={12} lg={6}><Card size="small"><Statistic title={t('common.rows')} value={total} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title={t('weighing.netWeight')} value={Math.round(totalKg)} suffix="kg" /></Card></Col>
      </Row>
      <Card
        title={t('weighing.title')}
        className="client-fit-table-card"
        extra={
          <Space wrap>
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
            <Input placeholder={t('weighing.vehicleNo')} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} style={{ width: 120 }} />
            <Select value={status} onChange={setStatus} style={{ width: 120 }} allowClear placeholder={t('common.status')}>
              <Select.Option value="pending">{t('weighing.reviewStatus.pending')}</Select.Option>
              <Select.Option value="approved">{t('weighing.reviewStatus.approved')}</Select.Option>
              <Select.Option value="rejected">{t('weighing.reviewStatus.rejected')}</Select.Option>
            </Select>
            <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setStatus(''); setVehicleNo(''); fetchData(); }}>{t('common.reset')}</Button>
            {canExport && (
              <Button icon={<DownloadOutlined />} onClick={handleExport}>{t('common.export')}</Button>
            )}
          </Space>
        }
      >
        {canVerify && (
          <Space wrap className="client-fit-card-fixed">
            <Tag color={selectedCount ? 'blue' : 'default'}>{t('common.selectedCount', { count: selectedCount })}</Tag>
            <Button disabled={!selectedCount} onClick={() => runBatchReview('approve')}>{t('weighing.batchApprove')}</Button>
            <Button danger disabled={!selectedCount} onClick={() => runBatchReview('reject')}>{t('weighing.batchReject')}</Button>
            <Select
              allowClear
              placeholder={t('weighing.classification')}
              value={batchClassification}
              onChange={setBatchClassification}
              style={{ width: 170 }}
              options={classificationOptions.map((value) => ({
                value,
                label: t(classificationMeta[value]?.labelKey || `wholesale.${value}`, { defaultValue: value }),
              }))}
            />
            <Button disabled={!selectedCount || !batchClassification} onClick={() => runBatchReview('classify')}>{t('weighing.batchClassify')}</Button>
          </Space>
        )}
        <div className="client-fit-table-scroll">
          <Table
            className="weighing-list-table"
            dataSource={data}
            columns={columns}
            rowKey={(r) => `${r.source}-${r.id}`}
            rowSelection={canVerify ? {
              selectedRowKeys,
              onChange: (keys, rows) => {
                setSelectedRowKeys(keys);
                setSelectedRows(rows);
              },
            } : undefined}
            loading={loading}
            pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
            tableLayout="fixed"
            size="small"
          />
        </div>
      </Card>
    </div>
  );
}
