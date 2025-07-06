import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Statistic, Table, Card, DatePicker, Input, Button, Space, Tag, Select } from 'antd';
import { SearchOutlined, ReloadOutlined, EditOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getWeighingList, WeighingItem } from '@/api/weighing';
import WeighingVerifyModal from '@/components/WeighingVerifyModal';

const { RangePicker } = DatePicker;

const classificationMeta: Record<string, { color: string; labelKey: string }> = {
  export_wholesale: { color: 'blue', labelKey: 'exportWholesale' },
  external_transport: { color: 'green', labelKey: 'externalTransport' },
  procurement: { color: 'orange', labelKey: 'procurement' },
  toll_processing: { color: 'purple', labelKey: 'tollProcessing' },
  unknown: { color: 'default', labelKey: 'unknown' },
};

export default function WeighingList() {
  const { t } = useTranslation();
  const [data, setData] = useState<WeighingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [vehicleNo, setVehicleNo] = useState('');
  const [status, setStatus] = useState<string>('');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [verifyRecord, setVerifyRecord] = useState<WeighingItem | null>(null);

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
      setData(res.data.items);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }, [dates, vehicleNo, status, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalTons = data.reduce((s, i) => s + (i.netWeight || 0), 0);

  const columns = [
    { title: t('weighing.weighSerialNo'), dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: 130 },
    { title: t('weighing.businessDate'), dataIndex: 'businessDate', key: 'businessDate', width: 100 },
    { title: t('weighing.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 120 },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', ellipsis: true },
    { title: t('weighing.receiverName'), dataIndex: 'receiverName', key: 'receiverName', ellipsis: true },
    { title: t('weighing.rawProductName'), dataIndex: 'rawProductName', key: 'rawProductName', width: 150, render: (v: string) => t(`product.${v}`, { defaultValue: v }) },
    { title: t('weighing.grossWeight'), dataIndex: 'grossWeight', key: 'grossWeight', width: 90 },
    { title: t('weighing.tareWeight'), dataIndex: 'tareWeight', key: 'tareWeight', width: 90 },
    { title: t('weighing.netWeight'), dataIndex: 'netWeight', key: 'netWeight', width: 90 },
    {
      title: t('weighing.classification'), dataIndex: 'classification', key: 'classification', width: 100,
      render: (v: string) => {
        const meta = classificationMeta[v] || classificationMeta.unknown;
        return <Tag color={meta.color}>{t(`weighing.${meta.labelKey}`)}</Tag>;
      },
    },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true, width: 150 },
    {
      title: t('common.edit'), key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: WeighingItem) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => setVerifyRecord(record)} />
      ),
    },
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title={t('common.total')} value={total} suffix={t('common.rows')} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('weighing.netWeight')} value={Math.round(totalTons)} suffix="т" /></Card></Col>
      </Row>
      <Card
        title={t('weighing.title')}
        extra={
          <Space>
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
            <Input placeholder={t('weighing.vehicleNo')} value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} style={{ width: 120 }} />
            <Select value={status} onChange={setStatus} style={{ width: 120 }} allowClear placeholder={t('common.status')}>
              <Select.Option value="matched">{t('common.matched')}</Select.Option>
              <Select.Option value="unmatched">{t('common.unmatched')}</Select.Option>
              <Select.Option value="needs_review">{t('common.needsReview')}</Select.Option>
            </Select>
            <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setStatus(''); setVehicleNo(''); fetchData(); }}>{t('common.reset')}</Button>
            <Button icon={<DownloadOutlined />} onClick={() => {
              const ym = dates[0].format('YYYY-MM');
              window.open(`http://198.51.100.10:8080/api/export/wholesale/details/${ym}`, '_blank');
            }}>{t('common.export')}</Button>
          </Space>
        }
      >
        <Table
          dataSource={data}
          columns={columns}
          rowKey={(r) => `${r.source}-${r.id}`}
          loading={loading}
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
          scroll={{ x: 1400 }}
          size="small"
        />
        <WeighingVerifyModal
          record={verifyRecord}
          visible={!!verifyRecord}
          onClose={() => setVerifyRecord(null)}
          onSuccess={() => { setPage(1); fetchData(); }}
        />
      </Card>
    </div>
  );
}
