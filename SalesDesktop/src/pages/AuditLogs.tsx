import { useEffect, useState } from 'react';
import { Button, Card, DatePicker, Drawer, Form, Input, message, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { exportAuditLogs, getAuditLogs, type AuditLogQuery, type AuditLogRecord } from '@/api/auditLogs';
import { useAuth } from '@/contexts/AuthContext';

const { RangePicker } = DatePicker;
const { Text } = Typography;

const moduleKeys = [
  'dashboard', 'retail', 'wholesale', 'exchange', 'train_entry', 'procurement',
  'contracts', 'materials', 'transfer_loss', 'map', 'users', 'departments',
  'roles', 'organization', 'aliases', 'weighing', 'audit_logs',
];
const actionKeys = [
  'view', 'login', 'logout', 'change_password', 'create', 'update', 'delete',
  'verify', 'batch_verify', 'approve', 'status', 'permissions', 'data_scopes',
  'reset_password', 'export', 'manage',
];
const roleKeys = [
  'admin', 'leadership', 'operator', 'auditor', 'viewer', 'sales_manager',
  'sales_staff', 'procurement_staff', 'loading_staff', 'finance_staff',
];
const presetKeys = ['all', 'today', 'failed', 'data_view', 'permission', 'export'];

function prettyJson(value?: string | null) {
  if (!value) return '-';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default function AuditLogs() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [form] = Form.useForm();
  const [data, setData] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState<AuditLogQuery>({ page: 1, pageSize: 50 });
  const [preset, setPreset] = useState('all');
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<AuditLogRecord | null>(null);
  const canExport = can('audit_logs:export');

  const moduleLabel = (key?: string | null) => key ? t(`auditLogs.modules.${key}`, { defaultValue: key }) : '-';
  const actionLabel = (key?: string | null) => key ? t(`auditLogs.actions.${key}`, { defaultValue: key }) : '-';
  const roleLabel = (key?: string | null, fallback?: string | null) => key ? t(`auditLogs.roles.${key}`, { defaultValue: fallback || key }) : (fallback || '-');
  const presetLabel = (key: string) => t(`auditLogs.presets.${key}`, { defaultValue: key });

  const loadData = async (nextQuery: AuditLogQuery = query) => {
    setLoading(true);
    try {
      const res = await getAuditLogs(nextQuery);
      setData(res.items || []);
      setTotal(res.total || 0);
      setQuery(nextQuery);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const buildFilters = (page = 1, pageSize = query.pageSize || 50, activePreset = preset): AuditLogQuery => {
    const values = form.getFieldsValue();
    const dateRange = values.dateRange as [dayjs.Dayjs, dayjs.Dayjs] | undefined;
    return {
      page,
      pageSize,
      preset: activePreset === 'all' ? undefined : activePreset,
      moduleKey: values.moduleKey,
      actionKey: values.actionKey,
      roleCode: values.roleCode,
      departmentName: values.departmentName,
      username: values.username,
      success: values.success,
      dateFrom: dateRange?.[0]?.format('YYYY-MM-DD'),
      dateTo: dateRange?.[1]?.format('YYYY-MM-DD'),
    };
  };

  const handlePresetChange = (value: string | number) => {
    const nextPreset = String(value);
    setPreset(nextPreset);
    loadData(buildFilters(1, query.pageSize || 50, nextPreset));
  };

  const handleExport = async () => {
    const filters = buildFilters(1, query.pageSize || 50);
    delete filters.page;
    delete filters.pageSize;
    setExporting(true);
    try {
      await exportAuditLogs(filters);
      message.success(t('common.downloadStarted'));
    } catch {
      message.error(t('common.downloadFailed'));
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<AuditLogRecord> = [
    { title: t('common.time'), dataIndex: 'createdAt', key: 'createdAt', width: 170 },
    {
      title: t('auditLogs.operator'),
      key: 'operator',
      width: 150,
      render: (_, record) => record.displayName || record.username || '-',
    },
    {
      title: t('auditLogs.department'),
      dataIndex: 'departmentName',
      key: 'departmentName',
      width: 150,
      render: (value: string) => value || '-',
    },
    {
      title: t('auditLogs.role'),
      key: 'roleCode',
      width: 140,
      render: (_, record) => roleLabel(record.roleCode, record.roleName),
    },
    {
      title: t('common.module'),
      dataIndex: 'moduleKey',
      key: 'moduleKey',
      width: 140,
      render: (value: string) => <Tag color="blue">{moduleLabel(value)}</Tag>,
    },
    {
      title: t('common.action'),
      dataIndex: 'actionKey',
      key: 'actionKey',
      width: 130,
      render: (value: string) => <Tag>{actionLabel(value)}</Tag>,
    },
    { title: 'Method', dataIndex: 'method', key: 'method', width: 90 },
    {
      title: t('auditLogs.duration'),
      dataIndex: 'durationMs',
      key: 'durationMs',
      width: 100,
      render: (value: number | null) => value == null ? '-' : `${value} ms`,
    },
    { title: t('auditLogs.path'), dataIndex: 'path', key: 'path', width: 260, ellipsis: true },
    {
      title: t('common.status'),
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Tag color={record.success ? 'green' : 'red'}>
          {record.success ? t('common.success') : t('common.failed')} {record.statusCode}
        </Tag>
      ),
    },
    { title: 'IP', dataIndex: 'ipAddress', key: 'ipAddress', width: 140, render: (v: string) => v || '-' },
    {
      title: t('auditLogs.detail'),
      key: 'detail',
      width: 90,
      render: (_, record) => <Button type="link" size="small" onClick={() => setDetail(record)}>{t('auditLogs.detail')}</Button>,
    },
  ];

  return (
    <Card title={t('nav.auditLogs')}>
      <Segmented
        value={preset}
        options={presetKeys.map((key) => ({ value: key, label: presetLabel(key) }))}
        onChange={handlePresetChange}
        style={{ marginBottom: 12 }}
      />
      <Form form={form} layout="inline" style={{ marginBottom: 16, rowGap: 8 }}>
        <Form.Item name="moduleKey">
          <Select
            allowClear
            placeholder={t('common.module')}
            style={{ width: 150 }}
            options={moduleKeys.map((key) => ({ value: key, label: moduleLabel(key) }))}
          />
        </Form.Item>
        <Form.Item name="actionKey">
          <Select
            allowClear
            placeholder={t('common.action')}
            style={{ width: 150 }}
            options={actionKeys.map((key) => ({ value: key, label: actionLabel(key) }))}
          />
        </Form.Item>
        <Form.Item name="roleCode">
          <Select
            allowClear
            placeholder={t('auditLogs.role')}
            style={{ width: 150 }}
            options={roleKeys.map((key) => ({ value: key, label: roleLabel(key) }))}
          />
        </Form.Item>
        <Form.Item name="departmentName">
          <Input allowClear placeholder={t('auditLogs.department')} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="username">
          <Input allowClear placeholder={t('auditLogs.operator')} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="success">
          <Select
            allowClear
            placeholder={t('common.status')}
            style={{ width: 130 }}
            options={[
              { value: '1', label: t('common.success') },
              { value: '0', label: t('common.failed') },
            ]}
          />
        </Form.Item>
        <Form.Item name="dateRange">
          <RangePicker />
        </Form.Item>
        <Space>
          <Button type="primary" icon={<SearchOutlined />} onClick={() => loadData(buildFilters(1))}>{t('common.search')}</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); setPreset('all'); loadData({ page: 1, pageSize: query.pageSize || 50 }); }}>{t('common.reset')}</Button>
          {canExport && <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>{t('common.export')}</Button>}
        </Space>
      </Form>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={{
          current: query.page || 1,
          pageSize: query.pageSize || 50,
          total,
          showSizeChanger: true,
          showTotal: (count) => t('common.total', { count }),
        }}
        onChange={(pagination) => loadData(buildFilters(pagination.current || 1, pagination.pageSize || 50))}
        scroll={{ x: 1600, y: 'calc(100vh - 330px)' }}
      />
      <Drawer
        title={t('auditLogs.detail')}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={560}
      >
        {detail && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text strong>{detail.createdAt}</Text>
            <Text>{moduleLabel(detail.moduleKey)} / {actionLabel(detail.actionKey)}</Text>
            <Text>{detail.method} {detail.path}</Text>
            <Text>{t('auditLogs.operator')}: {detail.displayName || detail.username || '-'}</Text>
            <Text>{t('auditLogs.department')}: {detail.departmentName || '-'}</Text>
            <Text>{t('auditLogs.role')}: {roleLabel(detail.roleCode, detail.roleName)}</Text>
            <Text>{t('auditLogs.duration')}: {detail.durationMs == null ? '-' : `${detail.durationMs} ms`}</Text>
            <Text>IP: {detail.ipAddress || '-'}</Text>
            <Text strong>{t('auditLogs.requestQuery')}</Text>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 220, overflow: 'auto' }}>
              {prettyJson(detail.requestQuery)}
            </pre>
            <Text strong>{t('auditLogs.requestBody')}</Text>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', padding: 12, borderRadius: 6, maxHeight: 360, overflow: 'auto' }}>
              {prettyJson(detail.requestBody)}
            </pre>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
