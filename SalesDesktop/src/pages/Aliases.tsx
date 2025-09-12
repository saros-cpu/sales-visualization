import { useEffect, useMemo, useState, type Key } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import client, {
  createEntityAlias,
  createProductAlias,
  deleteEntityAlias,
  deleteProductAlias,
  getEntityAliasesList,
  getProductAliasesList,
  getUnmatchedAliases,
  ignoreUnmatchedAliases,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

interface ProductAliasRecord {
  id: number;
  productId: number;
  displayName: string;
  aliasName: string;
}

interface EntityAliasRecord {
  id: number;
  entityType: string;
  entityCode?: string;
  standardName: string;
  aliasName: string;
}

interface UnmatchedAliasRecord {
  key: string;
  kind: 'product' | 'entity';
  rawName: string;
  count: number;
  latestDate?: string;
  sources: string[];
}

export default function Aliases() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [productList, setProductList] = useState<ProductAliasRecord[]>([]);
  const [entityList, setEntityList] = useState<EntityAliasRecord[]>([]);
  const [unmatchedList, setUnmatchedList] = useState<UnmatchedAliasRecord[]>([]);
  const [selectedUnmatchedKeys, setSelectedUnmatchedKeys] = useState<Key[]>([]);
  const [selectedUnmatchedRows, setSelectedUnmatchedRows] = useState<UnmatchedAliasRecord[]>([]);
  const [productOpts, setProductOpts] = useState<{ value: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [entityModalOpen, setEntityModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productForm] = Form.useForm();
  const [entityForm] = Form.useForm();

  const canCreate = can('aliases:create');
  const canDelete = can('aliases:delete');

  const entityTypeOptions = useMemo(() => [
    { value: 'retail_station', label: t('aliases.retailStation') },
    { value: 'own_depot', label: t('aliases.ownDepot') },
    { value: 'wholesale_customer', label: t('aliases.wholesaleCustomer') },
  ], [t]);

  const entityTypeLabel = (value: string) => entityTypeOptions.find((item) => item.value === value)?.label || value;
  const sourceLabel = (value: string) => t(`aliases.sources.${value}`, { defaultValue: value });

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [products, entities, productOptions, unmatched] = await Promise.all([
        getProductAliasesList(),
        getEntityAliasesList(),
        client.get('/aliases/products'),
        getUnmatchedAliases(),
      ]);
      setProductList(Array.isArray(products) ? products : []);
      setEntityList(Array.isArray(entities) ? entities : []);
      const productCandidates = Array.isArray(unmatched?.products) ? unmatched.products : [];
      const entityCandidates = Array.isArray(unmatched?.entities) ? unmatched.entities : [];
      setUnmatchedList([
        ...productCandidates.map((item: any) => ({ ...item, key: `product:${item.rawName}`, kind: 'product' as const })),
        ...entityCandidates.map((item: any) => ({ ...item, key: `entity:${item.rawName}`, kind: 'entity' as const })),
      ]);
      setSelectedUnmatchedKeys([]);
      setSelectedUnmatchedRows([]);
      const productRows = Array.isArray(productOptions.data)
        ? productOptions.data
        : Array.isArray(productOptions)
          ? productOptions
          : [];
      const opts = productRows.map((product: any) => ({
        value: product.id,
        label: product.displayName,
      }));
      opts.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
      setProductOpts(opts);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const openProductModal = (aliasName?: string) => {
    productForm.resetFields();
    if (aliasName) productForm.setFieldsValue({ aliasName });
    setProductModalOpen(true);
  };

  const openEntityModal = (aliasName?: string) => {
    entityForm.resetFields();
    entityForm.setFieldsValue({ entityType: 'wholesale_customer', aliasName, standardName: aliasName });
    setEntityModalOpen(true);
  };

  const saveProductAlias = async () => {
    const values = await productForm.validateFields();
    setSaving(true);
    try {
      await createProductAlias(values.productId, values.aliasName);
      message.success(t('common.created'));
      setProductModalOpen(false);
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const saveEntityAlias = async () => {
    const values = await entityForm.validateFields();
    setSaving(true);
    try {
      await createEntityAlias(values.entityType, values.entityCode || '', values.standardName, values.aliasName);
      message.success(t('common.created'));
      setEntityModalOpen(false);
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (kind: 'product' | 'entity', id: number) => {
    Modal.confirm({
      title: t('common.deleteConfirm'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        if (kind === 'product') await deleteProductAlias(id);
        else await deleteEntityAlias(id);
        message.success(t('common.deleted'));
        await fetchAll();
      },
    });
  };

  const ignoreSelectedAliases = () => {
    if (!selectedUnmatchedRows.length) {
      message.warning(t('common.selectRowsFirst'));
      return;
    }
    Modal.confirm({
      title: t('aliases.ignoreSelectedConfirm', { count: selectedUnmatchedRows.length }),
      okText: t('aliases.ignoreSelected'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setSaving(true);
        try {
          const result = await ignoreUnmatchedAliases(
            selectedUnmatchedRows.map((row) => ({ kind: row.kind, rawName: row.rawName })),
          );
          message.success(t('aliases.ignoredCount', { count: result.ignoredCount ?? selectedUnmatchedRows.length }));
          await fetchAll();
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const unmatchedColumns: ColumnsType<UnmatchedAliasRecord> = [
    {
      title: t('common.type'),
      dataIndex: 'kind',
      key: 'kind',
      width: 120,
      render: (value: UnmatchedAliasRecord['kind']) => (
        <Tag color={value === 'product' ? 'blue' : 'green'}>
          {value === 'product' ? t('common.product') : t('common.entityName')}
        </Tag>
      ),
    },
    { title: t('aliases.rawName'), dataIndex: 'rawName', key: 'rawName', width: 260 },
    { title: t('common.rows'), dataIndex: 'count', key: 'count', width: 100 },
    { title: t('aliases.latestDate'), dataIndex: 'latestDate', key: 'latestDate', width: 140, render: (value: string) => value || '-' },
    {
      title: t('common.source'),
      dataIndex: 'sources',
      key: 'sources',
      width: 180,
      render: (sources: string[]) => (
        <Space size={4} wrap>
          {(sources || []).map((source) => <Tag key={source}>{sourceLabel(source)}</Tag>)}
        </Space>
      ),
    },
    ...(canCreate ? [{
      title: t('common.action'),
      key: 'action',
      width: 170,
      render: (_: unknown, record: UnmatchedAliasRecord) => (
        record.kind === 'product'
          ? <Button type="link" size="small" onClick={() => openProductModal(record.rawName)}>{t('aliases.resolveAsProduct')}</Button>
          : <Button type="link" size="small" onClick={() => openEntityModal(record.rawName)}>{t('aliases.resolveAsEntity')}</Button>
      ),
    }] as ColumnsType<UnmatchedAliasRecord> : []),
  ];

  const productColumns: ColumnsType<ProductAliasRecord> = [
    { title: t('common.product'), dataIndex: 'displayName', key: 'displayName', width: 240 },
    { title: t('aliases.aliasName'), dataIndex: 'aliasName', key: 'aliasName', width: 260 },
    ...(canDelete ? [{
      title: t('common.action'),
      key: 'action',
      width: 90,
      render: (_: unknown, record: ProductAliasRecord) => (
        <Button danger type="link" size="small" icon={<DeleteOutlined />} onClick={() => confirmDelete('product', record.id)} />
      ),
    }] as ColumnsType<ProductAliasRecord> : []),
  ];

  const entityColumns: ColumnsType<EntityAliasRecord> = [
    { title: t('common.entityType'), dataIndex: 'entityType', key: 'entityType', width: 150, render: (value: string) => <Tag>{entityTypeLabel(value)}</Tag> },
    { title: t('aliases.standardName'), dataIndex: 'standardName', key: 'standardName', width: 240 },
    { title: t('aliases.aliasName'), dataIndex: 'aliasName', key: 'aliasName', width: 260 },
    { title: t('aliases.entityCode'), dataIndex: 'entityCode', key: 'entityCode', width: 140, render: (value: string) => value || '-' },
    ...(canDelete ? [{
      title: t('common.action'),
      key: 'action',
      width: 90,
      render: (_: unknown, record: EntityAliasRecord) => (
        <Button danger type="link" size="small" icon={<DeleteOutlined />} onClick={() => confirmDelete('entity', record.id)} />
      ),
    }] as ColumnsType<EntityAliasRecord> : []),
  ];

  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;

  return (
    <Card
      title={t('nav.aliases')}
      loading={loading}
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>{t('common.reset')}</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openProductModal()}>{t('aliases.addProductAlias')}</Button>}
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEntityModal()}>{t('aliases.addEntityAlias')}</Button>}
        </Space>
      )}
    >
      <Tabs
        items={[
          {
            key: 'unmatched',
            label: t('aliases.pendingAliases'),
            children: (
              <>
                {canCreate && (
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Tag color={selectedUnmatchedRows.length ? 'blue' : 'default'}>
                      {t('common.selectedCount', { count: selectedUnmatchedRows.length })}
                    </Tag>
                    <Button disabled={!selectedUnmatchedRows.length} loading={saving} onClick={ignoreSelectedAliases}>
                      {t('aliases.ignoreSelected')}
                    </Button>
                  </Space>
                )}
                <Table
                  rowKey="key"
                  size="small"
                  dataSource={unmatchedList}
                  columns={unmatchedColumns}
                  rowSelection={canCreate ? {
                    selectedRowKeys: selectedUnmatchedKeys,
                    onChange: (keys, rows) => {
                      setSelectedUnmatchedKeys(keys);
                      setSelectedUnmatchedRows(rows);
                    },
                  } : undefined}
                  pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('common.total', { count: total }) }}
                  scroll={{ x: 980, y: 'calc(100vh - 350px)' }}
                />
              </>
            ),
          },
          {
            key: 'products',
            label: t('aliases.productAliases'),
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={productList}
                columns={productColumns}
                pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('common.total', { count: total }) }}
                scroll={{ x: 720, y: 'calc(100vh - 310px)' }}
              />
            ),
          },
          {
            key: 'entities',
            label: t('aliases.entityAliases'),
            children: (
              <Table
                rowKey="id"
                size="small"
                dataSource={entityList}
                columns={entityColumns}
                pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('common.total', { count: total }) }}
                scroll={{ x: 900, y: 'calc(100vh - 310px)' }}
              />
            ),
          },
        ]}
      />

      <Modal
        title={t('aliases.addProductAlias')}
        open={productModalOpen}
        onCancel={() => setProductModalOpen(false)}
        onOk={saveProductAlias}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={productForm} layout="vertical">
          <Form.Item name="productId" label={t('common.product')} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={productOpts} />
          </Form.Item>
          <Form.Item name="aliasName" label={t('aliases.aliasName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('aliases.addEntityAlias')}
        open={entityModalOpen}
        onCancel={() => setEntityModalOpen(false)}
        onOk={saveEntityAlias}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={entityForm} layout="vertical">
          <Form.Item name="entityType" label={t('common.entityType')} rules={[{ required: true }]}>
            <Select options={entityTypeOptions} />
          </Form.Item>
          <Form.Item name="standardName" label={t('aliases.standardName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="aliasName" label={t('aliases.aliasName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="entityCode" label={t('aliases.entityCode')}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
