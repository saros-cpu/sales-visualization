import { useEffect, useState, useCallback } from 'react';
import { Card, Table, DatePicker, Button, Space, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getWholesaleDetails, WholesaleItem } from '@/api/wholesale';

const { RangePicker } = DatePicker;

export default function Wholesale() {
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
      setData(res.data.items);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [dates, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const classificationColors: Record<string, string> = {
    export_wholesale: 'blue', external_transport: 'green', toll_processing: 'purple',
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', ellipsis: true },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', ellipsis: true, render: (v: string) => t(`product.${v}`, { defaultValue: v }) },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', ellipsis: true },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', ellipsis: true },
    { title: t('common.customerName'), dataIndex: 'entityName', key: 'entityName', ellipsis: true },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 80 },
    {
      title: t('common.classification'), dataIndex: 'classification', key: 'classification', width: 100,
      render: (v: string) => <Tag color={classificationColors[v] || 'default'}>{v}</Tag>,
    },
    { title: t('common.transportMode'), dataIndex: 'transportMode', key: 'transportMode', ellipsis: true, render: (v: string) => t(`transport.${v}`, { defaultValue: v }) },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true },
  ];

  return (
    <Card
      title={t('nav.wholesale')}
      extra={
        <Space>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
        </Space>
      }
    >
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        scroll={{ x: 1000 }} />
    </Card>
  );
}
