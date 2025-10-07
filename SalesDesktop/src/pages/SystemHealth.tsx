import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, message, Popconfirm, Row, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getSystemHealth, runAutomationTask, type AutomationTaskKey } from '@/api/system';
import KpiCard, { KpiGrid } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

const { Text } = Typography;

function statusColor(status?: string) {
  if (status === 'ok' || status === 'success') return 'green';
  if (status === 'failed' || status === 'error') return 'red';
  return 'orange';
}

export default function SystemHealth() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const query = useApiQuery(['system-health'], getSystemHealth, { refetchInterval: 60000 });
  const [runningTask, setRunningTask] = useState<AutomationTaskKey | null>(null);
  const data = query.data || {};
  const cacheItems = data.cache?.items || [];
  const apiRecent = data.api?.recent || [];
  const apiTop = data.api?.topPaths24h || [];
  const automation = data.automation || [];
  const ai = data.ai || {};
  const canRunAutomation = user?.role === 'admin' || can('system_health:manage');

  const serviceCards = useMemo(() => Object.entries(data.services || {}).map(([key, value]: [string, any]) => ({
    key,
    status: value?.status || 'unknown',
  })), [data.services]);
  const automationActions: Array<{ task: AutomationTaskKey; label: string }> = [
    { task: 'exchange_rates', label: t('systemHealth.runExchangeRates') },
    { task: 'market_watch', label: t('systemHealth.runMarketWatch') },
    { task: 'retail_snapshots', label: t('systemHealth.runRetailSnapshots') },
    { task: 'all', label: t('systemHealth.runAllTasks') },
  ];

  const handleRunTask = async (task: AutomationTaskKey) => {
    setRunningTask(task);
    try {
      const result = await runAutomationTask(task);
      const retailStatus = result?.results?.retailSnapshots?.status;
      const hasFailed = Object.values(result?.results || {}).some((item: any) => item?.status === 'failed');
      if (hasFailed) {
        message.warning(t('systemHealth.runWarning'));
      } else {
        message.success(retailStatus === 'queued' || retailStatus === 'running' ? t('systemHealth.runQueued') : t('systemHealth.runSuccess'));
      }
      await query.refetch();
    } catch (err: any) {
      message.error(err?.message || t('systemHealth.runFailed'));
    } finally {
      setRunningTask(null);
    }
  };

  return (
    <Card
      title={t('systemHealth.title')}
      extra={<Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('common.update')}</Button>}
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><KpiCard title={t('systemHealth.overall')} value={data.status || '-'} tone={data.status === 'ok' ? 'success' : 'warning'} /></Col>
        <Col xs={24} sm={8}><KpiCard title={t('systemHealth.apiFailed24h')} value={data.api?.failed24h ?? 0} goodWhen="down" tone={(data.api?.failed24h ?? 0) > 0 ? 'danger' : 'success'} /></Col>
        <Col xs={24} sm={8}><KpiCard title={t('systemHealth.aiFailed7d')} value={ai.failed7d ?? 0} goodWhen="down" tone={(ai.failed7d ?? 0) > 0 ? 'danger' : 'success'} /></Col>
      </Row>
      <Tabs
        items={[
          {
            key: 'services',
            label: t('systemHealth.services'),
            children: (
              <Row gutter={[16, 16]}>
                {serviceCards.map(item => (
                  <Col xs={24} sm={8} key={item.key}>
                    <Card size="small">
                      <Space>
                        <Text>{t(`systemHealth.service.${item.key}`, { defaultValue: item.key })}</Text>
                        <Tag color={statusColor(item.status)}>{item.status}</Tag>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            ),
          },
          {
            key: 'api',
            label: t('systemHealth.api'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Table
                  size="small"
                  rowKey="path"
                  dataSource={apiTop}
                  pagination={false}
                  columns={[
                    { title: t('systemHealth.path'), dataIndex: 'path' },
                    { title: t('systemHealth.calls'), dataIndex: 'calls', width: 100 },
                    { title: t('systemHealth.failed'), dataIndex: 'failed', width: 100 },
                    { title: t('systemHealth.avgDuration'), dataIndex: 'avg_duration_ms', width: 130, render: (v: any) => `${Math.round(Number(v || 0))} ms` },
                  ]}
                />
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={apiRecent}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    { title: t('common.time'), dataIndex: 'created_at', width: 170 },
                    { title: t('auditLogs.operator'), dataIndex: 'username', width: 120 },
                    { title: t('common.module'), dataIndex: 'module_key', width: 120 },
                    { title: t('systemHealth.path'), dataIndex: 'path' },
                    { title: t('common.status'), dataIndex: 'status_code', width: 90 },
                    { title: t('systemHealth.duration'), dataIndex: 'duration_ms', width: 100, render: (v: any) => v ? `${v} ms` : '-' },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'cache',
            label: t('systemHealth.cache'),
            children: (
              <Table
                size="small"
                rowKey="key"
                dataSource={cacheItems}
                pagination={false}
                columns={[
                  { title: t('systemHealth.cacheItem'), dataIndex: 'label', width: 180 },
                  { title: t('common.status'), dataIndex: 'valid', width: 100, render: (_: any, row: any) => <Tag color={row.exists && row.valid ? 'green' : 'red'}>{row.exists && row.valid ? t('common.ok') : t('common.failed')}</Tag> },
                  { title: t('systemHealth.updatedAt'), dataIndex: 'updatedAt', width: 170 },
                  { title: t('systemHealth.size'), dataIndex: 'size', width: 100 },
                  { title: t('systemHealth.error'), dataIndex: 'error', render: (v: any, row: any) => v || (row.missingKeys?.length ? row.missingKeys.join(', ') : '-') },
                ]}
              />
            ),
          },
          {
            key: 'automation',
            label: t('systemHealth.automation'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {canRunAutomation && (
                  <>
                    <Alert type="info" showIcon message={t('systemHealth.manualRunHint')} />
                    <Space wrap>
                      {automationActions.map(item => (
                        <Popconfirm
                          key={item.task}
                          title={t('systemHealth.runConfirm')}
                          okText={t('common.confirm')}
                          cancelText={t('common.cancel')}
                          onConfirm={() => handleRunTask(item.task)}
                        >
                          <Button
                            icon={<PlayCircleOutlined />}
                            loading={runningTask === item.task}
                            disabled={Boolean(runningTask) && runningTask !== item.task}
                          >
                            {item.label}
                          </Button>
                        </Popconfirm>
                      ))}
                    </Space>
                  </>
                )}
                <Table
                  size="small"
                  rowKey="task_name"
                  dataSource={automation}
                  pagination={false}
                  columns={[
                    { title: t('systemHealth.taskName'), dataIndex: 'task_name', render: (v: string) => t(`systemHealth.task.${v}`, { defaultValue: v }) },
                    { title: t('common.status'), dataIndex: 'status', width: 120, render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag> },
                    { title: t('systemHealth.startedAt'), dataIndex: 'started_at', width: 170 },
                    { title: t('systemHealth.finishedAt'), dataIndex: 'finished_at', width: 170 },
                    { title: t('systemHealth.error'), dataIndex: 'error' },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'ai',
            label: t('systemHealth.ai'),
            children: (
              <KpiGrid items={[
                { key: 'configured', title: t('systemHealth.aiConfigured'), value: ai.configured ? t('common.yes') : t('common.no'), tone: ai.configured ? 'success' : 'warning', span: 8 },
                { key: 'model', title: t('systemHealth.aiModel'), value: ai.model || '-', span: 8 },
                { key: 'calls', title: t('systemHealth.aiCalls7d'), value: ai.total7d ?? 0, span: 8 },
                { key: 'duration', title: t('systemHealth.aiAvgDuration'), value: ai.avgDurationMs ?? 0, suffix: 'ms', span: 8 },
                { key: 'last', title: t('systemHealth.aiLastCalled'), value: ai.lastCalledAt || '-', span: 8 },
              ]} />
            ),
          },
        ]}
      />
    </Card>
  );
}
