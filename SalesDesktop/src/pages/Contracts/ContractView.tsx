import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, Select, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import { getContracts, Contract } from '@/api/contracts';
import { getWholesaleDetailFilterOptions } from '@/api/wholesale';

export default function ContractView() {
  const { t } = useTranslation();
  const [data, setData] = useState<Contract[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [company, setCompany] = useState('');
  const [loading, setLoading] = useState(false);
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);

  const fetchData = useCallback(async (p?: number) => {
    setLoading(true);
    try {
      const res = await getContracts({
        company: company || undefined,
        sort_by: 'contractNo', sort_dir: 'desc',
        page: p ?? page, page_size: 50,
      });
      setData(res.items);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, [company, page]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    getWholesaleDetailFilterOptions().then((options) => {
      setProductOptions(options.products || []);
      setCustomerOptions(options.companies || []);
    });
  }, []);

  const columns = useMemo(() => [
    { title: t('common.contractNo'), dataIndex: 'contractNo', key: 'contractNo', width: 150 },
    { title: t('common.appendixNo'), dataIndex: 'appendixNo', key: 'appendixNo', width: 120 },
    { title: t('common.customerName'), dataIndex: 'customerName', key: 'customerName', width: 180 },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 100 },
    { title: t('common.signedDate'), dataIndex: 'signedDate', key: 'signedDate', width: 100 },
    { title: t('common.effectiveStart'), dataIndex: 'effectiveStart', key: 'effectiveStart', width: 100 },
    { title: t('common.effectiveEnd'), dataIndex: 'effectiveEnd', key: 'effectiveEnd', width: 100 },
    { title: t('common.plannedTons'), dataIndex: 'quantityTons', key: 'quantityTons', width: 100 },
    { title: t('common.executedTons'), dataIndex: 'executedTons', key: 'executedTons', width: 100 },
  ], [t, productOptions, customerOptions]);

  return (
    <div className="client-fit-page">
      <Card
        size="small"
        title={t('nav.contractView')}
        className="contract-view-card client-fit-table-card"
        extra={
          <Select value={company} onChange={(v) => { setCompany(v ?? ''); setPage(1); }} style={{ width: 130 }} allowClear placeholder={t('common.all')}>
            <Select.Option value="Example">{t('contracts.exCompany')}</Select.Option>
            <Select.Option value="CUSTOMER-S-АББР">{t('contracts.customerSCompany')}</Select.Option>
          </Select>
        }
      >
        <div className="client-fit-table-scroll">
          <Table<Contract>
            dataSource={data}
            columns={columns as any}
            rowKey="id"
            loading={loading}
            size="small"
            pagination={{
              current: page,
              pageSize: 50,
              total,
              onChange: setPage,
              showTotal: (tot) => t('common.total', { count: tot }),
            }}
            scroll={{ x: 'max-content' }}
          />
        </div>
      </Card>
    </div>
  );
}
