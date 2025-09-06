import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Form, Input, InputNumber, message, Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  getManagementOverview,
  saveCockpitTemplate,
  saveDictionaryItem,
  updateSystemConfig,
  type CockpitComponent,
  type CockpitTemplate,
  type DictionaryItem,
  type KpiDefinition,
  type SystemConfigItem,
} from '@/api/management';
import { useApiQuery } from '@/hooks/useApi';

const { Text } = Typography;

const roleOptions = [
  { value: 'admin', label: 'admin' },
  { value: 'leadership', label: 'leadership' },
  { value: 'operator', label: 'operator' },
  { value: 'sales_manager', label: 'sales_manager' },
  { value: 'sales_staff', label: 'sales_staff' },
  { value: 'procurement_staff', label: 'procurement_staff' },
  { value: 'loading_staff', label: 'loading_staff' },
  { value: 'finance_staff', label: 'finance_staff' },
  { value: 'viewer', label: 'viewer' },
];

function localTitle(item: { titleZh?: string; titleRu?: string; labelZh?: string; labelRu?: string }, language: string) {
  if (language.startsWith('ru')) return item.titleRu || item.labelRu || item.titleZh || item.labelZh || '-';
  return item.titleZh || item.labelZh || item.titleRu || item.labelRu || '-';
}

function CockpitConfigTab({
  templates,
  catalog,
  onSaved,
}: {
  templates: CockpitTemplate[];
  catalog: KpiDefinition[];
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [draft, setDraft] = useState<CockpitTemplate | null>(null);
  const metricOptions = catalog.map(item => ({
    value: item.key,
    label: `${localTitle(item, i18n.language)} (${item.group})`,
  }));

  useEffect(() => {
    const next = templates.find(item => item.templateKey === selectedKey) || templates[0];
    setSelectedKey(next?.templateKey);
    setDraft(next ? JSON.parse(JSON.stringify(next)) : null);
  }, [templates, selectedKey]);

  const components = draft?.config?.components || [];

  const updateComponent = (id: string, patch: Partial<CockpitComponent>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      config: {
        ...draft.config,
        components: components.map(item => item.id === id ? { ...item, ...patch } : item),
      },
    });
  };

  const addComponent = (type: CockpitComponent['type']) => {
    if (!draft) return;
    const metricKey = type === 'kpi' ? catalog[0]?.key : undefined;
    const item: CockpitComponent = {
      id: `${type}_${Date.now()}`,
      type,
      metricKey,
      span: type === 'retail_alert' ? 24 : 6,
      visible: true,
    };
    setDraft({ ...draft, config: { ...draft.config, components: [...components, item] } });
  };

  const removeComponent = (id: string) => {
    if (!draft) return;
    setDraft({ ...draft, config: { ...draft.config, components: components.filter(item => item.id !== id) } });
  };

  const save = async () => {
    if (!draft) return;
    await saveCockpitTemplate(draft);
    message.success(t('common.saved'));
    onSaved();
  };

  if (!draft) return <Text type="secondary">{t('cockpit.noTemplate')}</Text>;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Text type="secondary">{t('management.template')}</Text>
          <Select
            value={draft.templateKey}
            onChange={setSelectedKey}
            style={{ width: '100%', marginTop: 6 }}
            options={templates.map(item => ({ value: item.templateKey, label: localTitle(item, i18n.language) }))}
          />
        </Col>
        <Col xs={24} lg={8}>
          <Text type="secondary">{t('management.visibleRoles')}</Text>
          <Select
            mode="multiple"
            value={draft.roleScope?.roles || []}
            onChange={(roles) => setDraft({ ...draft, roleScope: { roles } })}
            options={roleOptions}
            style={{ width: '100%', marginTop: 6 }}
          />
        </Col>
        <Col xs={24} lg={8}>
          <Text type="secondary">{t('common.status')}</Text>
          <div style={{ marginTop: 8 }}>
            <Switch
              checked={draft.isActive !== false}
              onChange={(checked) => setDraft({ ...draft, isActive: checked })}
            />
          </div>
        </Col>
      </Row>
      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={() => addComponent('kpi')}>{t('management.addKpi')}</Button>
        <Button icon={<PlusOutlined />} onClick={() => addComponent('retail_alert')}>{t('management.addRetailAlert')}</Button>
        <Button icon={<SaveOutlined />} type="primary" onClick={save}>{t('common.save')}</Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        dataSource={components}
        pagination={false}
        columns={[
          { title: t('common.type'), dataIndex: 'type', width: 140, render: (_: string, row) => (
            <Select
              value={row.type}
              onChange={(type) => updateComponent(row.id, { type, span: type === 'retail_alert' ? 24 : row.span, metricKey: type === 'kpi' ? row.metricKey || catalog[0]?.key : undefined })}
              options={[
                { value: 'kpi', label: t('management.kpiCard') },
                { value: 'retail_alert', label: t('management.retailAlertCard') },
              ]}
              style={{ width: 130 }}
            />
          ) },
          { title: t('management.metric'), dataIndex: 'metricKey', render: (_: string, row) => row.type === 'kpi' ? (
            <Select value={row.metricKey} onChange={(metricKey) => updateComponent(row.id, { metricKey })} options={metricOptions} style={{ width: '100%' }} />
          ) : <Tag>{t('retail.alert')}</Tag> },
          { title: t('management.span'), dataIndex: 'span', width: 110, render: (_: number, row) => (
            <Select value={row.span || 6} onChange={(span) => updateComponent(row.id, { span })} options={[6, 8, 12, 24].map(value => ({ value, label: value }))} style={{ width: 86 }} />
          ) },
          { title: t('common.active'), dataIndex: 'visible', width: 90, render: (_: boolean, row) => (
            <Switch checked={row.visible !== false} onChange={(visible) => updateComponent(row.id, { visible })} />
          ) },
          { title: t('common.adminOnly'), dataIndex: 'adminOnly', width: 110, render: (_: boolean, row) => (
            <Switch checked={Boolean(row.adminOnly)} onChange={(adminOnly) => updateComponent(row.id, { adminOnly })} />
          ) },
          { title: t('common.action'), width: 90, render: (_: unknown, row) => <Button danger size="small" onClick={() => removeComponent(row.id)}>{t('common.delete')}</Button> },
        ]}
      />
    </Space>
  );
}

function ConfigTab({ configs, onSaved }: { configs: SystemConfigItem[]; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(Object.fromEntries(configs.map(item => [item.configKey, item.configValue || ''])));
  }, [configs]);

  const save = async (item: SystemConfigItem) => {
    await updateSystemConfig(item.configKey, values[item.configKey] ?? '');
    message.success(t('common.saved'));
    onSaved();
  };

  return (
    <Table
      size="small"
      rowKey="configKey"
      dataSource={configs}
      pagination={{ pageSize: 20 }}
      columns={[
        { title: t('common.type'), dataIndex: 'groupKey', width: 140, render: (value) => <Tag>{value}</Tag> },
        { title: t('common.name'), render: (_, row) => localTitle(row, i18n.language) },
        { title: t('management.configKey'), dataIndex: 'configKey', width: 260 },
        { title: t('management.configValue'), dataIndex: 'configValue', width: 260, render: (_, row) => (
          <Input value={values[row.configKey]} disabled={row.isSecret} onChange={(event) => setValues(prev => ({ ...prev, [row.configKey]: event.target.value }))} />
        ) },
        { title: t('common.action'), width: 100, render: (_, row) => <Button size="small" onClick={() => save(row)}>{t('common.save')}</Button> },
      ]}
    />
  );
}

function DictionaryTab({ items, onSaved }: { items: DictionaryItem[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DictionaryItem | null>(null);
  const [form] = Form.useForm();

  const openModal = (item?: DictionaryItem) => {
    const next = item || { dictType: '', itemCode: '', labelZh: '', labelRu: '', sortOrder: 0, isActive: true };
    setEditing(next);
    form.setFieldsValue(next);
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    await saveDictionaryItem({ ...(editing || {}), ...values });
    message.success(t('common.saved'));
    setModalOpen(false);
    onSaved();
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => openModal()}>{t('common.add')}</Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        dataSource={items}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: t('common.type'), dataIndex: 'dictType', width: 180 },
          { title: t('common.code'), dataIndex: 'itemCode', width: 180 },
          { title: t('common.nameZh'), dataIndex: 'labelZh' },
          { title: t('common.nameRu'), dataIndex: 'labelRu' },
          { title: t('common.active'), dataIndex: 'isActive', width: 90, render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? t('common.yes') : t('common.no')}</Tag> },
          { title: t('common.action'), width: 90, render: (_, row) => <Button size="small" onClick={() => openModal(row)}>{t('common.edit')}</Button> },
        ]}
      />
      <Modal open={modalOpen} title={t('management.dictionaryItem')} onOk={save} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="dictType" label={t('common.type')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="itemCode" label={t('common.code')} rules={[{ required: true }]}>
            <Input disabled={Boolean(editing?.id)} />
          </Form.Item>
          <Form.Item name="labelZh" label={t('common.nameZh')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="labelRu" label={t('common.nameRu')}>
            <Input />
          </Form.Item>
          <Form.Item name="sortOrder" label={t('management.sortOrder')}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label={t('common.active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function ManagementCenter() {
  const { t } = useTranslation();
  const query = useApiQuery(['management-overview'], getManagementOverview);
  const data = query.data;

  if (query.error) {
    return <Card title={t('nav.managementCenter')}><Text type="danger">{(query.error as Error).message}</Text></Card>;
  }

  return (
    <Card title={t('nav.managementCenter')} loading={query.isLoading}>
      <Tabs
        items={[
          {
            key: 'cockpit',
            label: t('management.cockpitConfig'),
            children: <CockpitConfigTab templates={data?.templates || []} catalog={data?.kpiCatalog || []} onSaved={() => query.refetch()} />,
          },
          {
            key: 'dictionary',
            label: t('management.dictionary'),
            children: <DictionaryTab items={data?.dictionaryItems || []} onSaved={() => query.refetch()} />,
          },
          {
            key: 'configs',
            label: t('management.systemConfig'),
            children: <ConfigTab configs={data?.configs || []} onSaved={() => query.refetch()} />,
          },
          {
            key: 'recycle',
            label: t('management.recycleBin'),
            children: (
              <Table
                size="small"
                rowKey="id"
                dataSource={data?.recycleItems || []}
                pagination={{ pageSize: 20 }}
                columns={[
                  { title: t('management.sourceTable'), dataIndex: 'sourceTable', width: 180 },
                  { title: t('management.sourceId'), dataIndex: 'sourceId', width: 120 },
                  { title: t('common.name'), dataIndex: 'title' },
                  { title: t('common.status'), dataIndex: 'restoreStatus', width: 120 },
                  { title: t('management.deletedAt'), dataIndex: 'deletedAt', width: 180 },
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
