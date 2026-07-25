import { useEffect, useState, useCallback } from 'react';
import { DatePicker, Button, Select, Space, Table } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getProcurementDetails, getProcurementProducts, ProcurementItem } from '@/api/procurement';

const { RangePicker } = DatePicker;

export default function Procurement() {
  const { t } = useTranslation();
  const [data, setData] = useState<ProcurementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [productName, setProductName] = useState<string | undefined>();
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProcurementDetails({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        product_name: productName,
        page, page_size: 50,
      });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } finally { setLoading(false); }
  }, [dates, page, productName]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    let active = true;
    getProcurementProducts()
      .then((items) => {
        if (active) setProductOptions(items);
      })
      .catch(() => {
        if (active) setProductOptions([]);
      });
    return () => { active = false; };
  }, []);

  const resetFilters = () => {
    setDates([dayjs().startOf('month'), dayjs()]);
    setProductName(undefined);
    setPage(1);
  };

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
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 200, render: (_: string, row: ProcurementItem) => row.senderName || '--' },
    { title: t('weighing.receiverName'), dataIndex: 'entityName', key: 'entityName', width: 200, render: (_: string, row: ProcurementItem) => row.entityName || '--' },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 110 },
    { title: t('common.source'), dataIndex: 'weighSource', key: 'weighSource', width: 120 },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: 150 },
  ];

  return (
    <div className="client-fit-page">
      <div className="page-toolbar client-fit-fixed">
        <h2>{t('nav.procurement')}</h2>
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={productName}
            placeholder={t('common.productName')}
            style={{ width: 220 }}
            options={productOptions}
            onChange={(value) => { setProductName(value); setPage(1); }}
          />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          <Button icon={<ReloadOutlined />} onClick={resetFilters}>{t('common.reset')}</Button>
        </Space>
      </div>
      <div className="client-fit-table-scroll">
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
          scroll={{ x: 'max-content' }}
          size="small"
        />
      </div>
    </div>
  );
}
