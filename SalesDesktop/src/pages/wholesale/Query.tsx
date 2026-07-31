import { useCallback, useEffect, useState } from 'react';
import { Button, DatePicker, Input, message, Select, Space, Table, Tag } from 'antd';
import { DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  downloadWholesaleDetailsExport,
  getWholesaleDetailFilterOptions,
  getWholesaleDetails,
  type WholesaleItem,
} from '@/api/wholesale';
import BilingualName from '@/components/common/BilingualName';

const { RangePicker } = DatePicker;

const classificationColors: Record<string, string> = {
  export_wholesale: 'blue',
  local_wholesale: 'cyan',
  processing: 'purple',
  procurement: 'orange',
  transfer: 'geekblue',
  unknown: 'default',
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

const normalizeClassification = (value?: string) => {
  if (value === 'external_transport') return 'transfer';
  if (value === 'toll_processing') return 'processing';
  return value || 'unknown';
};

export default function Query() {
  const { t } = useTranslation();
  const [data, setData] = useState<WholesaleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [dataSource, setDataSource] = useState<'business' | 'weighing' | 'uploaded'>('business');
  const [vehicleNo, setVehicleNo] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [productName, setProductName] = useState('');
  const [companyOptions, setCompanyOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [productOptions, setProductOptions] = useState<Array<{ value: string; label: string }>>([]);

  const queryParams = useCallback((withPage = false) => ({
    data_source: dataSource,
    date_from: dates[0].format('YYYY-MM-DD'),
    date_to: dates[1].format('YYYY-MM-DD'),
    vehicle_no: vehicleNo.trim() || undefined,
    entity_name: companyName.trim() || undefined,
    product_name: productName.trim() || undefined,
    ...(withPage ? { page, page_size: 50 } : {}),
  }), [companyName, dataSource, dates, page, vehicleNo, productName]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWholesaleDetails(queryParams(true));
      setData(Array.isArray(res?.items) ? res.items : []);
      setTotal(Number(res?.total ?? 0));
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await downloadWholesaleDetailsExport(queryParams(false));
      message.success(t('common.downloadStarted'));
    } catch (err: any) {
      message.error(err?.message || t('common.downloadFailed'));
    } finally {
      setExporting(false);
    }
  }, [queryParams, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    getWholesaleDetailFilterOptions()
      .then((res) => {
        setCompanyOptions(res.companies || []);
        setProductOptions(res.products || []);
      })
      .catch(() => {
        setCompanyOptions([]);
        setProductOptions([]);
      });
  }, []);

  const sourceLabel = (value?: string, row?: WholesaleItem) => {
    const raw = String(value || row?.sourceType || row?.weighSource || 'unknown').trim();
    const normalized = sourceAliases[raw.toLowerCase()] || raw;
    return <span className="wholesale-query-two-line">{t(`wholesale.sources.${normalized}`, { defaultValue: raw || '--' })}</span>;
  };
  const withStandard = (raw?: string, standard?: string) => (
    <BilingualName value={standard} raw={raw} />
  );
  const twoLineText = (value?: string | number | null) => (
    <span className="wholesale-query-two-line">{value === null || value === undefined || value === '' ? '--' : value}</span>
  );
  const weightText = (value?: number | null) => (
    value === null || value === undefined ? '--' : Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })
  );

  const centerAlign = { align: 'center' as const };
  const columns = [
    { title: t('common.source'), dataIndex: 'sourceType', key: 'sourceType', width: 72, responsive: ['lg' as const], render: sourceLabel, ...centerAlign },
    { title: t('wholesaleEntry.sourceRow'), dataIndex: 'sourceRowNumber', key: 'sourceRowNumber', width: 56, responsive: ['xl' as const], render: twoLineText, ...centerAlign },
    { title: t('wholesaleEntry.entryDate'), dataIndex: 'businessDate', key: 'businessDate', width: 104, ...centerAlign },
    {
      title: t('common.productName'),
      dataIndex: 'rawProductName',
      key: 'rawProductName',
      width: 170,
      render: (_: string, row: WholesaleItem) => withStandard(row.rawProductName || row.productName, row.standardProductName),
      ...centerAlign,
    },
    { title: t('weighing.weighSerialNo'), dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: 124, responsive: ['lg' as const], render: twoLineText, ...centerAlign },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 108, render: twoLineText, ...centerAlign },
    {
      title: t('common.senderUnit'),
      dataIndex: 'senderName',
      key: 'senderName',
      width: 220,
      render: (_: string, row: WholesaleItem) => withStandard(row.senderName, row.standardSenderName),
      ...centerAlign,
    },
    {
      title: t('common.receiverUnit'),
      dataIndex: 'rawEntityName',
      key: 'rawEntityName',
      width: 240,
      render: (_: string, row: WholesaleItem) => withStandard(row.rawEntityName || row.entityName, row.standardEntityName),
      ...centerAlign,
    },
    { title: t('common.weightKg'), dataIndex: 'weightKg', key: 'weightKg', width: 92, render: weightText, ...centerAlign },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 92, render: weightText, ...centerAlign },
    {
      title: t('common.classification'),
      dataIndex: 'classification',
      key: 'classification',
      width: 104,
      render: (value: string) => {
        const normalized = normalizeClassification(value);
        return <Tag color={classificationColors[normalized] || 'default'}>{t(classificationLabelKeys[normalized], { defaultValue: normalized })}</Tag>;
      },
      ...centerAlign,
    },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', width: 150, responsive: ['xl' as const], render: twoLineText, ...centerAlign },
  ];

  return (
    <div className="client-fit-page">
      <div className="page-toolbar client-fit-fixed">
        <h2>{t('wholesale.query')}</h2>
        <Space wrap>
          <RangePicker value={dates} onChange={(value) => value && setDates(value as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Input
            allowClear
            value={vehicleNo}
            onChange={(event) => { setVehicleNo(event.target.value); setPage(1); }}
            placeholder={t('wholesale.vehicleFilter')}
            style={{ width: 150 }}
          />
          <Select
            allowClear
            showSearch
            value={companyName || undefined}
            onChange={(value) => { setCompanyName(value || ''); setPage(1); }}
            placeholder={t('wholesale.companyFilter')}
            optionFilterProp="label"
            options={companyOptions}
            style={{ width: 220 }}
          />
          <Select
            allowClear
            showSearch
            value={productName || undefined}
            onChange={(value) => { setProductName(value || ''); setPage(1); }}
            placeholder={t('wholesale.productFilter')}
            optionFilterProp="label"
            options={productOptions}
            style={{ width: 180 }}
          />
          <Select
            value={dataSource}
            onChange={(value) => { setDataSource(value); setPage(1); }}
            style={{ width: 150 }}
            options={[
              { value: 'business', label: t('wholesale.dataSources.business') },
              { value: 'weighing', label: t('wholesale.dataSources.weighing') },
              { value: 'uploaded', label: t('wholesale.dataSources.uploaded') },
            ]}
          />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>{t('common.export')}</Button>
        </Space>
      </div>
      <div className="client-fit-table-scroll">
        <Table
          className="wholesale-query-table"
          dataSource={data}
          columns={columns}
          rowKey={(row) => `${row.dataSource || 'business'}-${row.id}`}
          loading={loading}
          size="small"
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (count) => t('common.total', { count }) }}
        />
      </div>
    </div>
  );
}
