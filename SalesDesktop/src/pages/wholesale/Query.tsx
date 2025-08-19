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
    external_transport: 'geekblue',
    toll_processing: 'purple',
    processing: 'purple',
    procurement: 'orange',
    transfer: 'geekblue',
    unknown: 'default',
  };
  const classificationLabels: Record<string, string> = {
    transfer: '外运',
    external_transport: '外运',
    export_wholesale: '出口批发',
    local_wholesale: '本地批发',
    processing: '代加工',
    toll_processing: '代加工',
    procurement: '采购',
    unknown: '待识别',
  };
  const statusLabels: Record<string, string> = {
    matched: '已匹配',
    unmatched: '未匹配',
    needs_review: '待审核',
    approved: '已通过',
    pending: '待审核',
    rejected: '已拒绝',
  };
  const withStandard = (raw?: string, standard?: string) => {
    const rawValue = raw || standard || '--';
    if (!standard || standard === raw) return rawValue;
    return <span>{rawValue}<br /><small style={{ color: '#8c8c8c' }}>标准：{standard}</small></span>;
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', ellipsis: true },
    { title: '磅单号', dataIndex: 'weighSerialNo', key: 'weighSerialNo', ellipsis: true, render: (v: string) => v || '--' },
    {
      title: '货名',
      dataIndex: 'rawProductName',
      key: 'rawProductName',
      ellipsis: true,
      render: (_: string, row: WholesaleItem) => withStandard(row.rawProductName || row.productName, row.standardProductName),
    },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', ellipsis: true },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', ellipsis: true, render: (v: string) => v || '--' },
    {
      title: '收货单位',
      dataIndex: 'rawEntityName',
      key: 'rawEntityName',
      ellipsis: true,
      render: (_: string, row: WholesaleItem) => withStandard(row.rawEntityName || row.entityName, row.standardEntityName),
    },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 80 },
    {
      title: t('common.classification'), dataIndex: 'classification', key: 'classification', width: 100,
      render: (v: string) => <Tag color={classificationColors[v] || 'default'}>{classificationLabels[v] || v || '待识别'}</Tag>,
    },
    { title: '来源', dataIndex: 'weighSource', key: 'weighSource', ellipsis: true, render: (v: string) => v || '--' },
    { title: '匹配', dataIndex: 'matchStatus', key: 'matchStatus', width: 90, render: (v: string) => statusLabels[v] || v || '--' },
    { title: '审核', dataIndex: 'auditStatus', key: 'auditStatus', width: 90, render: (v: string) => statusLabels[v] || v || '--' },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true },
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
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        scroll={{ x: 1320, y: 'calc(100vh - 240px)' }} />
    </div>
  );
}
