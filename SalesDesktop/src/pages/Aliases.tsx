import { useEffect, useMemo, useState, type Key } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import {
  createEntityAlias,
  createProductAlias,
  deleteEntityAlias,
  deleteProductAlias,
  getEntityAliasesList,
  getProductAliasOptions,
  getProductAliasesList,
  getUnmatchedAliases,
  getWholesaleCustomers,
  ignoreUnmatchedAliases,
  mergeWholesaleCustomerAlias,
  saveWholesaleCustomer,
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

interface CustomerRecord {
  id: number;
  name: string;
  normalizedName: string;
  customerType: 'local_wholesale' | 'export_wholesale' | 'unknown' | string;
  contractCount: number;
  detailCount: number;
  detailTons: number;
  createdAt?: string;
  updatedAt?: string;
}

interface UnmatchedAliasRecord {
  key: string;
  kind: 'product' | 'entity';
  rawName: string;
  count: number;
  latestDate?: string;
  sources: string[];
}

type PendingNameKind = 'product' | 'wholesale_customer' | 'retail_station' | 'own_depot';
type CustomerListFilter = 'classified' | 'all' | 'unknown' | 'local_wholesale' | 'export_wholesale';
type AliasTabKey = 'unmatched' | 'products' | 'customers' | 'entities';

interface BatchResolveRow {
  key: string;
  rawName: string;
  standardName: string;
  kind: PendingNameKind;
  count: number;
  latestDate?: string;
  productId?: number;
  customerType?: 'local_wholesale' | 'export_wholesale' | 'unknown' | string;
  error?: string;
}

const INTERNAL_USE_ENTITY_CODE = 'internal_use';
const INTERNAL_USE_STANDARD_NAME = '内部用油';

export default function Aliases() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [productList, setProductList] = useState<ProductAliasRecord[]>([]);
  const [entityList, setEntityList] = useState<EntityAliasRecord[]>([]);
  const [customerList, setCustomerList] = useState<CustomerRecord[]>([]);
  const [customerTypeFilter, setCustomerTypeFilter] = useState<CustomerListFilter>('classified');
  const [unmatchedList, setUnmatchedList] = useState<UnmatchedAliasRecord[]>([]);
  const [selectedUnmatchedKeys, setSelectedUnmatchedKeys] = useState<Key[]>([]);
  const [selectedUnmatchedRows, setSelectedUnmatchedRows] = useState<UnmatchedAliasRecord[]>([]);
  const [productOpts, setProductOpts] = useState<{ value: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [entityModalOpen, setEntityModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerMergeModalOpen, setCustomerMergeModalOpen] = useState(false);
  const [customerMergeSource, setCustomerMergeSource] = useState<CustomerRecord | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchResolveRow[]>([]);
  const [activeTab, setActiveTab] = useState<AliasTabKey>('unmatched');
  const [saving, setSaving] = useState(false);
  const [productForm] = Form.useForm();
  const [entityForm] = Form.useForm();
  const [customerForm] = Form.useForm();
  const [customerMergeForm] = Form.useForm();

  const canCreate = can('aliases:create');
  const canDelete = can('aliases:delete');

  const entityTypeOptions = useMemo(() => [
    { value: 'retail_station', label: t('aliases.retailStation') },
    { value: 'own_depot', label: t('aliases.ownDepot') },
  ], [t]);
  const customerTypeOptions = useMemo(() => [
    { value: 'unknown', label: t('aliases.customerTypes.unknown') },
    { value: 'local_wholesale', label: t('aliases.customerTypes.local_wholesale') },
    { value: 'export_wholesale', label: t('aliases.customerTypes.export_wholesale') },
  ], [t]);
  const customerFilterOptions = useMemo(() => [
    { value: 'classified', label: t('aliases.customerFilters.classified') },
    { value: 'local_wholesale', label: t('aliases.customerTypes.local_wholesale') },
    { value: 'export_wholesale', label: t('aliases.customerTypes.export_wholesale') },
    { value: 'unknown', label: t('aliases.customerTypes.unknown') },
    { value: 'all', label: t('aliases.customerFilters.all') },
  ], [t]);

  const entityTypeLabel = (value: string) => entityTypeOptions.find((item) => item.value === value)?.label || value;
  const normalizedCustomerType = (value: string) => (value === 'local_wholesale' || value === 'export_wholesale' ? value : 'unknown');
  const customerTypeLabel = (value: string) => t(`aliases.customerTypes.${normalizedCustomerType(value)}`, { defaultValue: value || '-' });
  const customerTypeColor = (value: string) => {
    if (value === 'export_wholesale') return 'blue';
    if (value === 'local_wholesale') return 'cyan';
    return 'default';
  };
  const sourceLabel = (value: string) => t(`aliases.sources.${value}`, { defaultValue: value });
  const pendingNameKind = (record: UnmatchedAliasRecord): PendingNameKind => {
    if (record.kind === 'product') return 'product';
    return 'wholesale_customer';
  };
  const pendingNameKindColor = (value: PendingNameKind) => {
    if (value === 'product') return 'blue';
    if (value === 'retail_station') return 'green';
    if (value === 'own_depot') return 'purple';
    return 'cyan';
  };
  const pendingNameKindLabel = (value: PendingNameKind) => t(`aliases.pendingKinds.${value}`, { defaultValue: value });
  const pendingKindOptions = useMemo(() => [
    { value: 'product', label: pendingNameKindLabel('product') },
    { value: 'wholesale_customer', label: pendingNameKindLabel('wholesale_customer') },
    { value: 'retail_station', label: pendingNameKindLabel('retail_station') },
    { value: 'own_depot', label: pendingNameKindLabel('own_depot') },
  ], [t]);
  const customerMergeTargetOptions = useMemo(() => (
    customerList
      .filter((item) => item.id !== customerMergeSource?.id)
      .map((item) => ({
        value: item.id,
        label: `${item.name} · ${customerTypeLabel(item.customerType)}`,
      }))
  ), [customerList, customerMergeSource, t]);

  const inferProductId = (rawName: string) => {
    const text = String(rawName || '').toLowerCase();
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '');
    const options = productOpts.map((item) => ({ ...item, text: normalize(String(item.label || '')) }));
    const findBy = (patterns: string[]) => options.find((item) => patterns.some((pattern) => item.text.includes(pattern)))?.value;
    if (/-35|дт-?35|дт\s*-35/.test(text)) return findBy(['-35', '35']);
    if (/спбт|сжиж|газ|ãàç|gaz|lpg|液化/.test(text)) return findBy(['спбт', 'сжиж', 'газ', 'lpg', '液化']);
    if (/95/.test(text)) return findBy(['95']);
    if (/92/.test(text)) return findBy(['92']);
    if (/80/.test(text)) return findBy(['80']);
    if (/д\/?т|диз|diesel|柴油/.test(text)) return findBy(['д/т', 'дт', 'диз', 'diesel', '柴油']);
    const exact = options.find((item) => item.text === normalize(rawName));
    if (exact) return exact.value;
    return options.find((item) => item.text.includes(normalize(rawName)) || normalize(rawName).includes(item.text))?.value;
  };

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [products, entities, customers, productOptions, unmatched] = await Promise.all([
        getProductAliasesList(),
        getEntityAliasesList(),
        getWholesaleCustomers(customerTypeFilter === 'all' ? undefined : { customerType: customerTypeFilter }),
        getProductAliasOptions(),
        getUnmatchedAliases(),
      ]);
      setProductList(Array.isArray(products) ? products : []);
      setEntityList(Array.isArray(entities) ? entities : []);
      setCustomerList(Array.isArray(customers) ? customers : []);
      const productCandidates = Array.isArray(unmatched?.products) ? unmatched.products : [];
      const entityCandidates = Array.isArray(unmatched?.entities) ? unmatched.entities : [];
      setUnmatchedList([
        ...productCandidates.map((item: any) => ({ ...item, key: `product:${item.rawName}`, kind: 'product' as const })),
        ...entityCandidates.map((item: any) => ({ ...item, key: `entity:${item.rawName}`, kind: 'entity' as const })),
      ]);
      setSelectedUnmatchedKeys([]);
      setSelectedUnmatchedRows([]);
      const opts = Array.isArray(productOptions) ? [...productOptions] : [];
      opts.sort((a: any, b: any) => String(a.label).localeCompare(String(b.label)));
      setProductOpts(opts);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [customerTypeFilter]);

  const openProductModal = (aliasName?: string) => {
    productForm.resetFields();
    if (aliasName) productForm.setFieldsValue({ aliasName });
    setProductModalOpen(true);
  };

  const openEntityModal = (aliasName?: string, entityType = 'retail_station') => {
    entityForm.resetFields();
    entityForm.setFieldsValue({ entityType, aliasName, standardName: aliasName });
    setEntityModalOpen(true);
  };

  const openCustomerModal = (record?: Partial<CustomerRecord>) => {
    customerForm.resetFields();
    customerForm.setFieldsValue({
      name: record?.name || '',
      customerType: record?.customerType || 'unknown',
    });
    setCustomerModalOpen(true);
  };

  const openCustomerMergeModal = (record: CustomerRecord) => {
    setCustomerMergeSource(record);
    customerMergeForm.resetFields();
    customerMergeForm.setFieldsValue({ aliasName: record.name });
    setCustomerMergeModalOpen(true);
  };

  const saveProductAlias = async () => {
    const values = await productForm.validateFields();
    setSaving(true);
    try {
      await createProductAlias(values.productId, values.aliasName);
      message.success(t('common.created'));
      setProductModalOpen(false);
      setActiveTab('products');
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
      setActiveTab('entities');
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const saveCustomer = async () => {
    const values = await customerForm.validateFields();
    setSaving(true);
    try {
      await saveWholesaleCustomer(values.name, values.customerType);
      message.success(t('common.saved'));
      setCustomerModalOpen(false);
      setActiveTab('customers');
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const saveCustomerMerge = async () => {
    if (!customerMergeSource) return;
    const values = await customerMergeForm.validateFields();
    setSaving(true);
    try {
      await mergeWholesaleCustomerAlias(customerMergeSource.id, values.targetCustomerId, values.aliasName || customerMergeSource.name);
      message.success(t('aliases.aliasMerged'));
      setCustomerMergeModalOpen(false);
      setCustomerMergeSource(null);
      setActiveTab('customers');
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const markCustomerAsInternalUse = (record: CustomerRecord) => {
    Modal.confirm({
      title: t('aliases.markInternalUseConfirm', { name: record.name }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setSaving(true);
        try {
          await createEntityAlias('own_depot', INTERNAL_USE_ENTITY_CODE, INTERNAL_USE_STANDARD_NAME, record.name);
          message.success(t('aliases.markedInternalUse'));
          setActiveTab('customers');
          await fetchAll();
        } finally {
          setSaving(false);
        }
      },
    });
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

  const openBatchResolveModal = () => {
    const targets = selectedUnmatchedRows.length ? selectedUnmatchedRows : unmatchedList;
    if (!targets.length) {
      message.warning(t('common.noData'));
      return;
    }
    setBatchRows(targets.map((record) => {
      const kind = pendingNameKind(record);
      return {
        key: record.key,
        rawName: record.rawName,
        standardName: record.rawName,
        kind,
        count: record.count,
        latestDate: record.latestDate,
        productId: kind === 'product' ? inferProductId(record.rawName) : undefined,
        customerType: 'unknown',
      };
    }));
    setBatchModalOpen(true);
  };

  const updateBatchRow = (key: string, patch: Partial<BatchResolveRow>) => {
    setBatchRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch, error: undefined } : row)));
  };

  const confirmBatchResolve = async () => {
    const missingProduct = batchRows.find((row) => row.kind === 'product' && !row.productId);
    if (missingProduct) {
      message.error(t('aliases.productRequired'));
      return;
    }
    const missingStandardName = batchRows.find((row) => row.kind !== 'product' && !row.standardName.trim());
    if (missingStandardName) {
      message.error(t('aliases.standardNameRequired'));
      return;
    }
    setSaving(true);
    const failures: Record<string, string> = {};
    try {
      for (const row of batchRows) {
        try {
          if (row.kind === 'product') {
            await createProductAlias(Number(row.productId), row.rawName);
          } else if (row.kind === 'wholesale_customer') {
            const standardName = row.standardName.trim();
            const saved = await saveWholesaleCustomer(standardName, row.customerType || 'unknown');
            if (standardName !== row.rawName.trim()) {
              await createEntityAlias('wholesale_customer', String(saved?.id || ''), standardName, row.rawName);
            }
          } else {
            await createEntityAlias(row.kind, '', row.standardName.trim(), row.rawName);
          }
        } catch (error: any) {
          failures[row.key] = error?.message || t('common.failed');
        }
      }
      if (Object.keys(failures).length > 0) {
        setBatchRows((prev) => prev.map((row) => ({ ...row, error: failures[row.key] })));
        message.error(t('aliases.batchResolvePartial', { count: Object.keys(failures).length }));
      } else {
        message.success(t('aliases.batchResolveSuccess', { count: batchRows.length }));
        setBatchModalOpen(false);
        setBatchRows([]);
        await fetchAll();
      }
    } finally {
      setSaving(false);
    }
  };

  const unmatchedColumns: ColumnsType<UnmatchedAliasRecord> = [
    {
      title: t('aliases.pendingNameType'),
      dataIndex: 'kind',
      key: 'kind',
      width: 120,
      render: (_: UnmatchedAliasRecord['kind'], record: UnmatchedAliasRecord) => {
        const kind = pendingNameKind(record);
        return (
          <Tag color={pendingNameKindColor(kind)}>
            {pendingNameKindLabel(kind)}
          </Tag>
        );
      },
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
      width: 260,
      render: (_: unknown, record: UnmatchedAliasRecord) => {
        if (record.kind === 'product') {
          return <Button type="link" size="small" onClick={() => openProductModal(record.rawName)}>{t('aliases.resolveAsProduct')}</Button>;
        }
        const kind = pendingNameKind(record);
        if (kind === 'wholesale_customer') {
          return (
            <Space size={4} wrap>
              <Button type="link" size="small" onClick={() => openCustomerModal({ name: record.rawName, customerType: 'unknown' })}>
                {t('aliases.resolveAsCustomer')}
              </Button>
              <Button type="link" size="small" onClick={() => openEntityModal(record.rawName, 'retail_station')}>{t('aliases.resolveAsEntity')}</Button>
            </Space>
          );
        }
        return (
          <Button type="link" size="small" onClick={() => openEntityModal(record.rawName, kind)}>
            {t('aliases.resolveAsEntity')}
          </Button>
        );
      },
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

  const customerColumns: ColumnsType<CustomerRecord> = [
    { title: t('common.customerName'), dataIndex: 'name', key: 'name', width: 280 },
    {
      title: t('aliases.customerType'),
      dataIndex: 'customerType',
      key: 'customerType',
      width: 150,
      render: (value: string) => <Tag color={customerTypeColor(value)}>{customerTypeLabel(value)}</Tag>,
    },
    { title: t('aliases.contractCount'), dataIndex: 'contractCount', key: 'contractCount', width: 120 },
    { title: t('aliases.detailCount'), dataIndex: 'detailCount', key: 'detailCount', width: 120 },
    { title: t('aliases.detailTons'), dataIndex: 'detailTons', key: 'detailTons', width: 130, render: (value: number) => `${value ?? 0} t` },
    { title: t('materials.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', width: 170, render: (value: string, record) => value || record.createdAt || '-' },
    ...(canCreate ? [{
      title: t('common.action'),
      key: 'action',
      width: 260,
      render: (_: unknown, record: CustomerRecord) => (
        <Space size={4} wrap>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openCustomerModal(record)} />
          <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => openCustomerMergeModal(record)}>
            {t('aliases.mergeAlias')}
          </Button>
          {normalizedCustomerType(record.customerType) === 'unknown' && (
            <Button type="link" size="small" onClick={() => markCustomerAsInternalUse(record)}>
              {t('aliases.markInternalUse')}
            </Button>
          )}
        </Space>
      ),
    }] as ColumnsType<CustomerRecord> : []),
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
      title={t('nav.referenceMaintenance')}
      loading={loading}
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>{t('common.reset')}</Button>
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openCustomerModal()}>{t('aliases.addWholesaleCustomer')}</Button>}
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openProductModal()}>{t('aliases.addProductAlias')}</Button>}
          {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEntityModal(undefined, 'retail_station')}>{t('aliases.addEntityAlias')}</Button>}
        </Space>
      )}
    >
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as AliasTabKey)}
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
                    <Button type="primary" disabled={!unmatchedList.length} loading={saving} onClick={openBatchResolveModal}>
                      {t('aliases.oneClickResolve')}
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
                  scroll={{ x: 1100, y: 'calc(100vh - 350px)' }}
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
            key: 'customers',
            label: t('aliases.wholesaleCustomers'),
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Select
                    style={{ width: 180 }}
                    value={customerTypeFilter}
                    options={customerFilterOptions}
                    onChange={(value: CustomerListFilter) => setCustomerTypeFilter(value)}
                  />
                </Space>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={customerList}
                  columns={customerColumns}
                  pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('common.total', { count: total }) }}
                  scroll={{ x: 1260, y: 'calc(100vh - 350px)' }}
                />
              </>
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
        title={t('aliases.addWholesaleCustomer')}
        open={customerModalOpen}
        onCancel={() => setCustomerModalOpen(false)}
        onOk={saveCustomer}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={customerForm} layout="vertical">
          <Form.Item name="name" label={t('common.customerName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="customerType" label={t('aliases.customerType')} rules={[{ required: true }]}>
            <Select options={customerTypeOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('aliases.mergeAlias')}
        open={customerMergeModalOpen}
        onCancel={() => {
          setCustomerMergeModalOpen(false);
          setCustomerMergeSource(null);
        }}
        onOk={saveCustomerMerge}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Alert type="info" showIcon message={t('aliases.mergeCustomerHint')} style={{ marginBottom: 12 }} />
        <Form form={customerMergeForm} layout="vertical">
          <Form.Item label={t('aliases.aliasSource')}>
            <Input value={customerMergeSource?.name || ''} disabled />
          </Form.Item>
          <Form.Item name="aliasName" label={t('aliases.aliasName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="targetCustomerId" label={t('aliases.targetCustomer')} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={customerMergeTargetOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t('aliases.batchResolveTitle')}
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        onOk={confirmBatchResolve}
        confirmLoading={saving}
        width={980}
        destroyOnHidden
      >
        <Alert type="info" showIcon message={t('aliases.batchResolveHint')} style={{ marginBottom: 12 }} />
        <Table<BatchResolveRow>
          rowKey="key"
          size="small"
          dataSource={batchRows}
          pagination={false}
          scroll={{ x: 920, y: 420 }}
          columns={[
            {
              title: t('aliases.pendingNameType'),
              dataIndex: 'kind',
              width: 160,
              render: (_: PendingNameKind, record) => (
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  value={record.kind}
                  options={pendingKindOptions}
                  onChange={(kind: PendingNameKind) => updateBatchRow(record.key, {
                    kind,
                    productId: kind === 'product' ? inferProductId(record.rawName) : undefined,
                    customerType: kind === 'wholesale_customer' ? (record.customerType || 'unknown') : undefined,
                  })}
                />
              ),
            },
            { title: t('aliases.rawName'), dataIndex: 'rawName', width: 240 },
            {
              title: t('aliases.standardName'),
              dataIndex: 'standardName',
              width: 240,
              render: (_: string, record) => (
                record.kind === 'product'
                  ? <span>-</span>
                  : <Input size="small" value={record.standardName} onChange={(event) => updateBatchRow(record.key, { standardName: event.target.value })} />
              ),
            },
            {
              title: t('aliases.targetProduct'),
              dataIndex: 'productId',
              width: 210,
              render: (_: number, record) => (
                record.kind === 'product'
                  ? <Select size="small" showSearch optionFilterProp="label" style={{ width: '100%' }} value={record.productId} options={productOpts} onChange={(productId) => updateBatchRow(record.key, { productId })} />
                  : <span>-</span>
              ),
            },
            {
              title: t('aliases.customerType'),
              dataIndex: 'customerType',
              width: 160,
              render: (_: string, record) => (
                record.kind === 'wholesale_customer'
                  ? <Select size="small" style={{ width: '100%' }} value={record.customerType || 'unknown'} options={customerTypeOptions} onChange={(customerType) => updateBatchRow(record.key, { customerType })} />
                  : <span>-</span>
              ),
            },
            { title: t('common.rows'), dataIndex: 'count', width: 80 },
            { title: t('aliases.latestDate'), dataIndex: 'latestDate', width: 120, render: (value) => value || '-' },
            {
              title: t('common.status'),
              dataIndex: 'error',
              width: 160,
              render: (value: string) => value ? <Tag color="red">{value}</Tag> : <Tag color="green">{t('common.ok')}</Tag>,
            },
            {
              title: t('common.action'),
              key: 'action',
              width: 90,
              render: (_: unknown, record) => (
                <Button danger type="link" size="small" onClick={() => setBatchRows((prev) => prev.filter((row) => row.key !== record.key))}>
                  {t('aliases.removeFromBatch')}
                </Button>
              ),
            },
          ]}
        />
      </Modal>

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
