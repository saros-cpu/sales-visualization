import { useEffect, useState, useCallback } from 'react';
import { DatePicker, Button, Space, Table } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getProcurementDetails, ProcurementItem } from '@/api/procurement';

const { RangePicker } = DatePicker;

export default function Procurement() {
  const { t } = useTranslation();
  const [data, setData] = useState<ProcurementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProcurementDetails({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page, page_size: 50,
      });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } finally { setLoading(false); }
  }, [dates, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const renderProductName = (_: string, row: ProcurementItem) => {
    const standard = row.standardProductName || row.productName;
    const raw = row.rawProductName;
    if (raw && standard && raw !== standard) {
      return <span>{standard}<br /><small style={{ color: '#8c8c8c' }}>{raw}</small></span>;
    }
    return standard || raw || '--';
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', width: 140 },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 190, render: renderProductName },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 140 },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 110 },
    { title: t('common.source'), dataIndex: 'weighSource', key: 'weighSource', width: 120 },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: 150 },
  ];

  return (
    <div>
      <div className="page-toolbar">
        <h2>{t('nav.procurement')}</h2>
          <Space wrap>
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
            <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchData(); }}>{t('common.reset')}</Button>
          </Space>
      </div>
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
          scroll={{ x: 1400, y: 'calc(100vh - 300px)' }}
          size="small"
        />
    </div>
  );
}
