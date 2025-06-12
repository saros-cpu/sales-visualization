import { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, InputNumber, message, Tag, Progress, Popconfirm, Select, DatePicker } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getContracts, createContract, updateContract, getContractExecution, Contract } from '@/api/contracts';

export default function Contracts() {
  const { t } = useTranslation();
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [execModalOpen, setExecModalOpen] = useState(false);
  const [execData, setExecData] = useState<Contract | null>(null);
  const [execMonthly, setExecMonthly] = useState<Array<{ yearMonth: string; executedTons: number }>>([]);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    getContracts({ company, sort_by: 'contractNo', sort_dir: 'asc', page, page_size: 50 })
      .then((res) => { setData(res.items); setTotal(res.total); })
      .finally(() => setLoading(false));
  }, [company, page]);

  const openAdd = () => {
    setEditing(null); form.resetFields(); setModalOpen(true);
  };

  const openEdit = (record: Contract) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const openExec = async (record: Contract) => {
    setExecData(record);
    try {
      const res = await getContractExecution(record.id);
      setExecMonthly(res.data.monthly || []);
    } catch { setExecMonthly([]); }
    setExecModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (values.signedDate && dayjs(values.signedDate).isAfter(dayjs())) {
      message.error(t('common.noFutureDate'));
      return;
    }
    setSubmitting(true);
    try {
      if (editing) {
        await updateContract(editing.id, values);
        message.success(t('common.updated'));
      } else {
        await createContract(values);
        message.success(t('common.created'));
      }
      setModalOpen(false);
      setPage(1);
      const res = await getContracts({ company, sort_by: 'contractNo', sort_dir: 'desc', page: 1, page_size: 50 });
      setData(res.items); setTotal(res.total);
    } finally { setSubmitting(false); }
  };

  const columns = [
    { title: t('common.contractNo'), dataIndex: 'contractNo', key: 'contractNo', width: 150 },
    { title: t('common.customerName'), dataIndex: 'customerName', key: 'customerName', width: 180 },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 100, render: (v: string) => t(`product.${v}`, { defaultValue: v }) },
    { title: t('common.signedDate'), dataIndex: 'signedDate', key: 'signedDate', width: 100 },
    { title: t('common.effectiveStart'), dataIndex: 'effectiveStart', key: 'effectiveStart', width: 100 },
    { title: t('common.effectiveEnd'), dataIndex: 'effectiveEnd', key: 'effectiveEnd', width: 100 },
    { title: t('common.plannedTons'), dataIndex: 'quantityTons', key: 'quantityTons', width: 100 },
    { title: t('common.executedTons'), dataIndex: 'executedTons', key: 'executedTons', width: 100 },
    {
      title: t('common.executionRate'), key: 'rate', width: 150,
      render: (_: unknown, r: Contract) => {
        const pct = r.quantityTons > 0 ? Math.min(100, Math.round((r.executedTons / r.quantityTons) * 100)) : 0;
        const color = pct === 0 ? '#ff4d4f' : pct >= 100 ? '#52c41a' : '#1677ff';
        return <Progress percent={pct} size="small" strokeColor={color} />;
      },
    },
    {
      title: t('common.edit'), key: 'action', width: 120,
      render: (_: unknown, r: Contract) => (
        <Space>
          <Button type="link" size="small" icon={<BarChartOutlined />} onClick={() => openExec(r)} />
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
        </Space>
      ),
    },
  ];

  return (
    <Card
      title={t('nav.contracts')} loading={loading}
      extra={
        <Space>
          <Select value={company} onChange={setCompany} style={{ width: 180 }}>
            <Select.Option value="">{t('common.all')}</Select.Option>
            <Select.Option value="Example,EX">{t('contracts.exCompany')}</Select.Option>
            <Select.Option value="油气公司,CUSTOMER-S-АББР">{t('contracts.customerSCompany')}</Select.Option>
          </Select>
          <Button icon={<PlusOutlined />} type="primary" onClick={openAdd}>{t('common.addContract')}</Button>
        </Space>
      }
    >
      <Table dataSource={data} columns={columns} rowKey="id" size="small" pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }} scroll={{ x: 1200 }} />

      <Modal title={editing ? t('common.editContract') : t('common.addContract')} open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={handleSubmit} confirmLoading={submitting} width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="contractNo" label={t('common.contractNo')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="customerName" label={t('common.customerName')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="productName" label={t('retail.product')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="appendixNo" label={t('common.appendixNo')}><Input /></Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="signedDate" label={t('common.signedDate')} rules={[{
              validator: (_, value) =>
                !value || !dayjs(value).isAfter(dayjs())
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('common.noFutureDate'))),
            }]}>
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="effectiveStart" label={t('common.effectiveStart')}><Input placeholder="YYYY-MM-DD" /></Form.Item>
            <Form.Item name="effectiveEnd" label={t('common.effectiveEnd')}><Input placeholder="YYYY-MM-DD" /></Form.Item>
          </Space>
          <Form.Item name="salesType" label={t('common.salesType')}><Input /></Form.Item>
          <Space>
            <Form.Item name="quantityTons" label={t('common.plannedTons')}><InputNumber style={{ width: 180 }} /></Form.Item>
            <Form.Item name="amountOriginal" label={t('common.originalAmount')}><InputNumber style={{ width: 180 }} /></Form.Item>
            <Form.Item name="currency" label={t('common.currency')}><Input style={{ width: 100 }} /></Form.Item>
          </Space>
          <Form.Item name="remark" label={t('common.remark')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`${t('common.execDashboard')} - ${execData?.contractNo || ''}`} open={execModalOpen} onCancel={() => setExecModalOpen(false)} footer={null} width={600}>
        <p>{t('common.customerName')}: {execData?.customerName} | {t('retail.product')}: {t(`product.${execData?.productName}`, { defaultValue: execData?.productName })} | {t('common.plannedTons')}: {execData?.quantityTons}</p>
        <Table dataSource={execMonthly} rowKey="yearMonth" size="small" pagination={false}
          columns={[
            { title: t('common.month'), dataIndex: 'yearMonth', key: 'yearMonth' },
            { title: t('common.executedTons'), dataIndex: 'executedTons', key: 'executedTons' },
          ]} />
      </Modal>
    </Card>
  );
}
