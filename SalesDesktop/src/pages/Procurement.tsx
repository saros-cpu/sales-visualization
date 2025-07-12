import { useEffect, useState, useCallback } from 'react';
import { Card, Table, DatePicker, Button, Space, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getProcurementDetails, ProcurementItem } from '@/api/procurement';

const { RangePicker } = DatePicker;

export default function Procurement() {
  const { t } = useTranslation();
  const [data, setData] = useState<ProcurementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProcurementDetails({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page, page_size: 50,
      });
      setData(res.data.items);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [dates, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', ellipsis: true },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', ellipsis: true, render: (v: string) => t(`product.${v}`, { defaultValue: v }) },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', ellipsis: true },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 80, render: (v: number) => v != null ? `${Math.round(v * 1000).toLocaleString()} kg` : '-' },
    { title: t('common.source'), dataIndex: 'weighSource', key: 'weighSource', ellipsis: true },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true },
  ];

  return (
    <Card
      title={t('nav.procurement')}
      extra={
        <Space>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
        </Space>
      }
    >
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        scroll={{ x: 900 }} />
    </Card>
  );
}
