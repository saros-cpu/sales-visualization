import { useEffect, useState } from 'react';
import { Card, Tabs, Table, Button, Space, Modal, Form, Input, InputNumber, Select, message, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  getCategories, getMaterials, createMaterial, Material, MaterialCategory,
  getInboundList, createInbound, InboundRecord,
  getTransferOrders, createTransferOrder, updateOrderStatus, TransferOrder,
  getInventory, InventoryItem,
} from '@/api/materials';

function MaterialDictTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<Material[]>([]);
  const [cats, setCats] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [m, c] = await Promise.all([getMaterials(), getCategories()]);
    setData(m.data); setCats(c.data);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      await createMaterial(v);
      message.success(t('common.created'));
      setModalOpen(false); fetchData();
    } finally { setSubmitting(false); }
  };

  const columns = [
    { title: t('common.code'), dataIndex: 'material_code', key: 'material_code', width: 100 },
    { title: t('common.nameZh'), dataIndex: 'name_zh', key: 'name_zh' },
    { title: t('common.nameRu'), dataIndex: 'name_ru', key: 'name_ru' },
    { title: t('materials.category'), dataIndex: 'category_name', key: 'category_name', width: 100 },
    { title: t('common.spec'), dataIndex: 'specification', key: 'specification', ellipsis: true },
    { title: t('materials.unit'), dataIndex: 'unit', key: 'unit', width: 60 },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80 },
    { title: t('materials.status'), dataIndex: 'is_active', key: 'is_active', width: 70, render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? t('materials.active') : t('materials.inactive')}</Tag> },
  ];

  return (
    <div>
      <Button icon={<PlusOutlined />} type="primary" onClick={() => { form.resetFields(); setModalOpen(true); }} style={{ marginBottom: 16 }}>{t('common.addMaterial')}</Button>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 800 }} />
      <Modal title={t('common.addMaterial')} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSubmit} confirmLoading={submitting}>
        <Form form={form} layout="vertical">
          <Form.Item name="materialCode" label={t('common.code')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="categoryId" label={t('materials.category')} rules={[{ required: true }]}>
            <Select>{cats.map((c) => <Select.Option key={c.id} value={c.id}>{c.name_zh}</Select.Option>)}</Select>
          </Form.Item>
          <Form.Item name="nameZh" label={t('common.nameZh')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="nameRu" label={t('common.nameRu')}><Input /></Form.Item>
          <Form.Item name="specification" label={t('common.spec')}><Input /></Form.Item>
          <Space>
            <Form.Item name="unit" label={t('materials.unit')}><Input style={{ width: 100 }} /></Form.Item>
            <Form.Item name="unitPrice" label={t('common.unitPrice')}><InputNumber style={{ width: 150 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}

function InboundTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<InboundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const res = await getInboundList({ page, page_size: 50 });
    setData(res.data.items); setTotal(res.data.total);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, [page]);

  const handleSubmit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      await createInbound({ ...v, inboundDate: v.inboundDate || new Date().toISOString().slice(0, 10) });
      message.success(t('common.created'));
      setModalOpen(false); fetchData();
    } finally { setSubmitting(false); }
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'inbound_date', key: 'inbound_date', width: 100 },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name' },
    { title: t('common.warehouse'), dataIndex: 'depot_name', key: 'depot_name', width: 100 },
    { title: t('common.supplier'), dataIndex: 'supplier_name', key: 'supplier_name', ellipsis: true },
    { title: t('common.qty'), dataIndex: 'quantity', key: 'quantity', width: 80 },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80 },
    { title: t('common.totalAmount'), dataIndex: 'total_amount', key: 'total_amount', width: 100 },
    { title: t('common.invoiceNo'), dataIndex: 'invoice_no', key: 'invoice_no', width: 120 },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true, width: 150 },
  ];

  return (
    <div>
      <Button icon={<PlusOutlined />} type="primary" onClick={() => { form.resetFields(); setModalOpen(true); }} style={{ marginBottom: 16 }}>{t('common.addInbound')}</Button>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        scroll={{ x: 1000 }} />
      <Modal title={t('common.addInbound')} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSubmit} confirmLoading={submitting}>
        <Form form={form} layout="vertical">
          <Form.Item name="materialId" label={t('materials.name')} rules={[{ required: true }]}><Input type="number" /></Form.Item>
          <Form.Item name="quantity" label={t('common.qty')} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="supplierName" label={t('common.supplier')}><Input /></Form.Item>
          <Form.Item name="unitPrice" label={t('common.unitPrice')}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="totalAmount" label={t('common.totalAmount')}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="invoiceNo" label={t('common.invoiceNo')}><Input /></Form.Item>
          <Form.Item name="remark" label={t('common.remark')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function TransferOrdersTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<TransferOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const res = await getTransferOrders({ status: filterStatus, page, page_size: 50 });
    setData(res.data.items); setTotal(res.data.total);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, [page, filterStatus]);

  const handleSubmit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      await createTransferOrder(v);
      message.success(t('common.created'));
      setModalOpen(false); fetchData();
    } finally { setSubmitting(false); }
  };

  const handleStatusChange = async (id: number, status: string) => {
    await updateOrderStatus(id, status);
    message.success(t('common.statusUpdated'));
    fetchData();
  };

  const statusColors: Record<string, string> = { pending: 'orange', dispatched: 'blue', received: 'green', cancelled: 'red' };

  const columns = [
    { title: t('common.orderNo'), dataIndex: 'order_no', key: 'order_no', width: 130 },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name' },
    { title: t('common.fromWarehouse'), dataIndex: 'from_depot_name', key: 'from_depot_name', width: 100 },
    { title: t('common.toWarehouse'), dataIndex: 'to_depot_name', key: 'to_depot_name', width: 100 },
    { title: t('common.qty'), dataIndex: 'requested_qty', key: 'requested_qty', width: 80 },
    { title: t('common.transportMode'), dataIndex: 'transport_mode', key: 'transport_mode', width: 80 },
    { title: t('common.vehicleNo'), dataIndex: 'vehicle_no', key: 'vehicle_no', width: 120 },
    { title: t('common.driver'), dataIndex: 'driver_name', key: 'driver_name', width: 80 },
    {
      title: t('materials.status'), dataIndex: 'status', key: 'status', width: 100,
      render: (v: string, r: TransferOrder) => (
        <Space>
          <Tag color={statusColors[v]}>{v}</Tag>
          {v === 'pending' && <Button size="small" onClick={() => handleStatusChange(r.id, 'dispatched')}>{t('materials.ship')}</Button>}
          {v === 'dispatched' && <Button size="small" onClick={() => handleStatusChange(r.id, 'received')}>{t('materials.receive')}</Button>}
        </Space>
      ),
    },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true, width: 150 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select value={filterStatus} onChange={setFilterStatus} allowClear placeholder={t('common.filterStatus')} style={{ width: 120 }}>
          <Select.Option value="pending">{t('common.pending')}</Select.Option>
          <Select.Option value="dispatched">{t('common.dispatched')}</Select.Option>
          <Select.Option value="received">{t('common.received')}</Select.Option>
          <Select.Option value="cancelled">{t('common.cancelled')}</Select.Option>
        </Select>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => { form.resetFields(); setModalOpen(true); }}>{t('common.addTransfer')}</Button>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small"
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
        scroll={{ x: 1200 }} />
      <Modal title={t('common.addTransfer')} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSubmit} confirmLoading={submitting} width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="orderNo" label={t('common.orderNo')} rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="materialId" label={t('materials.name')} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Space>
            <Form.Item name="fromDepotId" label={t('common.fromWarehouse')} rules={[{ required: true }]}><InputNumber /></Form.Item>
            <Form.Item name="toDepotId" label={t('common.toWarehouse')} rules={[{ required: true }]}><InputNumber /></Form.Item>
          </Space>
          <Form.Item name="requestedQty" label={t('common.qty')} rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="transportMode" label={t('common.transportMode')}><Input placeholder="truck" /></Form.Item>
          <Space>
            <Form.Item name="vehicleNo" label={t('common.vehicleNo')}><Input /></Form.Item>
            <Form.Item name="driverName" label={t('common.driver')}><Input /></Form.Item>
          </Space>
          <Form.Item name="remark" label={t('common.remark')}><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function InventoryTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [depotId, setDepotId] = useState<number | undefined>();

  const fetchData = async () => {
    setLoading(true);
    const res = await getInventory(depotId);
    setData(res.data);
    setLoading(false);
  };
  useEffect(() => { fetchData(); }, [depotId]);

  const columns = [
    { title: t('common.warehouse'), dataIndex: 'depot_name', key: 'depot_name' },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name' },
    { title: t('materials.unit'), dataIndex: 'unit', key: 'unit', width: 60 },
    { title: t('materials.inventoryQty'), dataIndex: 'quantity', key: 'quantity', width: 100 },
    { title: t('materials.lastInbound'), dataIndex: 'last_inbound_at', key: 'last_inbound_at', width: 160 },
    { title: t('materials.updatedAt'), dataIndex: 'updated_at', key: 'updated_at', width: 160 },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select value={depotId} onChange={setDepotId} allowClear placeholder={t('common.filterWarehouse')} style={{ width: 150 }}>
          <Select.Option value={1}>{t('common.defaultWarehouse')}</Select.Option>
        </Select>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 800 }} />
    </div>
  );
}

export default function MaterialsPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('common.materialsManagement')}>
      <Tabs items={[
        { key: 'dict', label: t('common.materialDict'), children: <MaterialDictTab /> },
        { key: 'inbound', label: t('common.inboundMgmt'), children: <InboundTab /> },
        { key: 'orders', label: t('common.transferOrders'), children: <TransferOrdersTab /> },
        { key: 'inventory', label: t('common.inventory'), children: <InventoryTab /> },
      ]} />
    </Card>
  );
}
