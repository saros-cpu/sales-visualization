import { useEffect, useState } from 'react';
import { Table, Card, Tabs, Tag, Space, Spin, Alert, Button, Modal, Form, Select, Input, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import client, { getProductAliasesList, getEntityAliasesList, createProductAlias, deleteProductAlias, createEntityAlias, deleteEntityAlias } from '@/api/client';

export default function Aliases() {
  const { t } = useTranslation();
  const [productList, setProductList] = useState<any[]>([]);
  const [entityList, setEntityList] = useState<any[]>([]);
  const [productOpts, setProductOpts] = useState<{value: number; label: string}[]>([]);
  const [entityTypeOpts] = useState([
    { value: 'retail_station', label: t('aliases.retailStation') },
    { value: 'own_depot', label: t('aliases.ownDepot') },
    { value: 'wholesale_customer', label: t('aliases.wholesaleCustomer') },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addModal, setAddModal] = useState<'product' | 'entity' | null>(null);
  const [form] = Form.useForm();

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [pList, eList, pOpts] = await Promise.all([
        getProductAliasesList(),
        getEntityAliasesList(),
        client.get('/aliases/products'),
      ]);
      setProductList(pList);
      setEntityList(eList);
      const opts = (pOpts.data || []).map((p: any) => ({ value: p.id, label: p.displayName }));
      opts.sort((a: any, b: any) => a.label.localeCompare(b.label));
      setProductOpts(opts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleAdd = async () => {
    const vals = await form.validateFields();
    const type = addModal;
    try {
      if (type === 'product') {
        await createProductAlias(vals.productId, vals.aliasName);
      } else {
        await createEntityAlias(vals.entityType, '', vals.standardName, vals.aliasName);
      }
      message.success(t('common.save'));
      setAddModal(null);
      form.resetFields();
      fetchAll();
    } catch (e: any) {
      message.error(e.response?.data?.message || t('common.error'));
    }
  };

  const handleDelete = async (type: 'product' | 'entity', id: number) => {
    try {
      if (type === 'product') await deleteProductAlias(id);
      else await deleteEntityAlias(id);
      message.success(t('common.delete'));
      fetchAll();
    } catch {
      message.error(t('common.error'));
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;

  const actionCol = {
    title: t('common.action'), key: 'action', width: 80,
    render: (_: unknown, record: any) => (
      <Popconfirm title={t('common.confirm')} onConfirm={() => handleDelete(record._type, record.id)}>
        <Button type="link" danger size="small" icon={<DeleteOutlined />} />
      </Popconfirm>
    ),
  };

  const productColumns = [
    { title: t('common.product'), dataIndex: 'displayName', key: 'displayName', width: 200 },
    { title: t('aliases.aliasName'), dataIndex: 'aliasName', key: 'aliasName' },
    actionCol,
  ];

  const entityColumns = [
    { title: t('common.name'), dataIndex: 'standardName', key: 'standardName', width: 200 },
    { title: t('common.type'), dataIndex: 'entityType', key: 'entityType', width: 150, render: (v: string) => {
      const labels: Record<string, string> = { retail_station: t('aliases.retailStation'), own_depot: t('aliases.ownDepot'), wholesale_customer: t('aliases.wholesaleCustomer') };
      return labels[v] || v;
    }},
    { title: t('aliases.aliasName'), dataIndex: 'aliasName', key: 'aliasName' },
    actionCol,
  ];

  return (
    <Card title={t('nav.aliases')} extra={<Space>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { setAddModal('product'); form.resetFields(); }}>
        {t('aliases.addProductAlias')}
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { setAddModal('entity'); form.resetFields(); }}>
        {t('aliases.addEntityAlias')}
      </Button>
    </Space>}>
      <Tabs items={[
        { key: 'products', label: t('aliases.productAliases'), children: (
          <Table dataSource={productList.map((r) => ({ ...r, _type: 'product' }))} columns={productColumns} rowKey="id" pagination={false} size="small" />
        )},
        { key: 'entities', label: t('aliases.entityAliases'), children: (
          <Table dataSource={entityList.map((r) => ({ ...r, _type: 'entity' }))} columns={entityColumns} rowKey="id" pagination={false} size="small" />
        )},
      ]} />

      <Modal title={addModal === 'product' ? t('aliases.addProductAlias') : t('aliases.addEntityAlias')} open={!!addModal} onOk={handleAdd} onCancel={() => setAddModal(null)}
        okText={t('common.save')} cancelText={t('common.cancel')}>
        <Form form={form} layout="vertical">
          {addModal === 'product' ? (
            <>
              <Form.Item name="productId" label={t('common.product')} rules={[{ required: true }]}>
                <Select showSearch placeholder={t('common.select')} options={productOpts} filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                } />
              </Form.Item>
              <Form.Item name="aliasName" label={t('aliases.aliasName')} rules={[{ required: true }]}>
                <Input placeholder={t('common.input')} />
              </Form.Item>
            </>
          ) : (
            <>
              <Form.Item name="entityType" label={t('common.type')} rules={[{ required: true }]}>
                <Select placeholder={t('common.select')} options={entityTypeOpts} />
              </Form.Item>
              <Form.Item name="standardName" label={t('common.name')} rules={[{ required: true }]}>
                <Input placeholder={t('common.input')} />
              </Form.Item>
              <Form.Item name="aliasName" label={t('aliases.aliasName')} rules={[{ required: true }]}>
                <Input placeholder={t('common.input')} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
