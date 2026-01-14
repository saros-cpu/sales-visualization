import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, message, Popconfirm, Row, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { generateAccountingReports, getAccountingReportStatus, getSystemHealth, runAutomationTask, type AutomationTaskKey } from '@/api/system';
import KpiCard, { KpiGrid } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

const { Text } = Typography;

function statusColor(status?: string) {
  if (status === 'ok' || status === 'success') return 'green';
  if (status === 'failed' || status === 'error') return 'red';
  return 'orange';
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SystemHealth() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const query = useApiQuery(['system-health'], getSystemHealth, { refetchInterval: 60000 });
  const [runningTask, setRunningTask] = useState<AutomationTaskKey | null>(null);
  const [accountingDate, setAccountingDate] = useState(dayjs().subtract(1, 'day'));
  const [generatingAccounting, setGeneratingAccounting] = useState(false);
  const accountingDateText = accountingDate.format('YYYY-MM-DD');
  const accountingQuery = useApiQuery(
    ['accounting-report-status', accountingDateText],
    () => getAccountingReportStatus(accountingDateText),
    { refetchInterval: 60000 },
  );
  const data = query.data || {};
  const accounting = accountingQuery.data || {};
  const missingStations = accounting.missingStations || [];
  const generatedFiles = accounting.generatedFiles || [];
  const closedStations = accounting.closedStations || [];
  const accountingWarnings = accounting.warnings || [];
  const accountingSkipped = accounting.skipped || [];
  const cacheItems = data.cache?.items || [];
  const apiRecent = data.api?.recent || [];
  const apiTop = data.api?.topPaths24h || [];
  const automation = data.automation || [];
  const ai = data.ai || {};
  const knowledge = data.knowledge || {};
  const updater = data.updater || {};
  const updaterFiles = updater.files || [];
  const canRunAutomation = user?.role === 'admin' || can('system_health:manage');

  const serviceCards = useMemo(() => Object.entries(data.services || {}).map(([key, value]: [string, any]) => ({
    key,
    status: value?.status || 'unknown',
  })), [data.services]);
  const automationActions: Array<{ task: AutomationTaskKey; label: string }> = [
    { task: 'exchange_rates', label: t('systemHealth.runExchangeRates') },
    { task: 'market_watch', label: t('systemHealth.runMarketWatch') },
    { task: 'retail_snapshots', label: t('systemHealth.runRetailSnapshots') },
    { task: 'retail_accounting_reports', label: t('systemHealth.runRetailAccountingReports') },
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

  const handleGenerateAccounting = async () => {
    setGeneratingAccounting(true);
    try {
      const result = await generateAccountingReports(accountingDateText);
      const hasWarnings = result?.run?.status === 'failed' || (result?.status?.warnings || []).length > 0;
      if (hasWarnings || (result?.status?.missingCount || 0) > 0) {
        message.warning(t('systemHealth.accountingGenerateWarning'));
      } else {
        message.success(t('systemHealth.accountingGenerateSuccess'));
      }
      await accountingQuery.refetch();
      await query.refetch();
    } catch (err: any) {
      message.error(err?.message || t('systemHealth.accountingGenerateFailed'));
    } finally {
      setGeneratingAccounting(false);
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
            key: 'governance',
            label: t('systemHealth.governance'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Alert
                  showIcon
                  type={knowledge.status === 'ok' && updater.status === 'ok' ? 'success' : 'warning'}
                  message={knowledge.status === 'ok' && updater.status === 'ok'
                    ? t('systemHealth.governanceOk')
                    : t('systemHealth.governanceWarning')}
                  description={updater.downloadRoot ? t('systemHealth.updateRoot', { path: updater.downloadRoot }) : undefined}
                />
                <KpiGrid items={[
                  { key: 'attachments', title: t('systemHealth.attachmentCount'), value: knowledge.attachmentCount ?? 0, span: 6 },
                  { key: 'indexed', title: t('systemHealth.indexedCount'), value: knowledge.indexedCount ?? 0, tone: (knowledge.failedCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'pending', title: t('systemHealth.pendingCount'), value: knowledge.pendingCount ?? 0, tone: (knowledge.pendingCount ?? 0) > 0 ? 'warning' : 'success', span: 6 },
                  { key: 'failed', title: t('systemHealth.failedCount'), value: knowledge.failedCount ?? 0, goodWhen: 'down', tone: (knowledge.failedCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'unsupported', title: t('systemHealth.unsupportedCount'), value: knowledge.unsupportedCount ?? 0, span: 6 },
                  { key: 'missingFiles', title: t('systemHealth.missingFileCount'), value: knowledge.missingFileCount ?? 0, goodWhen: 'down', tone: (knowledge.missingFileCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'updateVersion', title: t('systemHealth.updateVersion'), value: updater.version || '-', span: 6 },
                  { key: 'lastExtracted', title: t('systemHealth.lastExtracted'), value: knowledge.lastExtractedAt || '-', span: 6 },
                ]} />
                {((knowledge.warnings || []).length > 0 || (updater.warnings || []).length > 0) && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t('systemHealth.governanceWarnings')}
                    description={[...(knowledge.warnings || []), ...(updater.warnings || [])].join(', ')}
                  />
                )}
                <Table
                  size="small"
                  rowKey="key"
                  dataSource={updaterFiles}
                  pagination={false}
                  title={() => t('systemHealth.updateFiles')}
                  columns={[
                    { title: t('systemHealth.updateFile'), dataIndex: 'label', width: 260 },
                    { title: t('common.status'), dataIndex: 'exists', width: 110, render: (_: any, row: any) => <Tag color={row.exists && row.valid ? 'green' : 'red'}>{row.exists && row.valid ? t('common.ok') : t('common.failed')}</Tag> },
                    { title: t('systemHealth.size'), dataIndex: 'size', width: 120, render: (v: number) => formatBytes(v) },
                    { title: t('systemHealth.updatedAt'), dataIndex: 'updatedAt', width: 170, render: (v: any) => v || '-' },
                    { title: t('systemHealth.error'), dataIndex: 'error', render: (v: any) => v || '-' },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'accounting',
            label: t('systemHealth.accountingReports'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Space wrap>
                  <span>{t('systemHealth.accountingDate')}</span>
                  <DatePicker
                    value={accountingDate}
                    allowClear={false}
                    disabledDate={(current) => Boolean(current && current.isAfter(dayjs(), 'day'))}
                    onChange={(value) => {
                      if (value) setAccountingDate(value);
                    }}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => accountingQuery.refetch()}
                    loading={accountingQuery.isFetching}
                  >
                    {t('common.update')}
                  </Button>
                  {canRunAutomation && (
                    <Popconfirm
                      title={t('systemHealth.accountingGenerateConfirm')}
                      okText={t('common.confirm')}
                      cancelText={t('common.cancel')}
                      onConfirm={handleGenerateAccounting}
                    >
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        loading={generatingAccounting}
                      >
                        {t('systemHealth.accountingGenerate')}
                      </Button>
                    </Popconfirm>
                  )}
                </Space>

                <Alert
                  showIcon
                  type={(accounting.missingCount || 0) > 0 ? 'warning' : accounting.status === 'ok' ? 'success' : 'info'}
                  message={(accounting.missingCount || 0) > 0
                    ? t('systemHealth.accountingMissingMessage', { count: accounting.missingCount })
                    : accounting.status === 'ok'
                      ? t('systemHealth.accountingOkMessage')
                      : t('systemHealth.accountingPendingMessage')}
                  description={accounting.outputDir ? t('systemHealth.accountingOutputDir', { path: accounting.outputDir }) : undefined}
                />

                <KpiGrid items={[
                  { key: 'expected', title: t('systemHealth.accountingExpected'), value: accounting.expectedCount ?? 0, span: 6 },
                  { key: 'generated', title: t('systemHealth.accountingGenerated'), value: accounting.generatedStationCount ?? 0, span: 6 },
                  { key: 'missing', title: t('systemHealth.accountingMissing'), value: accounting.missingCount ?? 0, tone: (accounting.missingCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'closed', title: t('systemHealth.accountingClosed'), value: accounting.closedCount ?? 0, span: 6 },
                ]} />

                {(accountingWarnings.length > 0 || accountingSkipped.length > 0) && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t('systemHealth.accountingWarnings')}
                    description={[...accountingWarnings, ...accountingSkipped.map((item: any) => `${String(item.shopKey || '').padStart(3, '0')}: ${item.reason || '-'}`)].slice(0, 12).join('；')}
                  />
                )}

                <Table
                  size="small"
                  rowKey="stationNo"
                  dataSource={missingStations}
                  pagination={false}
                  loading={accountingQuery.isFetching}
                  title={() => t('systemHealth.accountingMissingStations')}
                  columns={[
                    { title: t('systemHealth.stationNo'), dataIndex: 'stationNo', width: 90 },
                    { title: t('retail.station'), dataIndex: 'name', width: 180 },
                    { title: t('retail.ruName'), dataIndex: 'short', width: 180 },
                    { title: t('retail.regionTab'), dataIndex: 'region', width: 140 },
                  ]}
                />

                <Table
                  size="small"
                  rowKey="file"
                  dataSource={generatedFiles}
                  pagination={{ pageSize: 12 }}
                  title={() => t('systemHealth.accountingGeneratedFiles')}
                  columns={[
                    { title: t('systemHealth.stationNo'), dataIndex: 'stationNo', width: 90, render: (v: any) => v || '-' },
                    { title: t('systemHealth.fileName'), dataIndex: 'file', width: 220 },
                    { title: t('retail.station'), dataIndex: ['station', 'name'], width: 180, render: (v: any) => v || '-' },
                    { title: t('systemHealth.size'), dataIndex: 'size', width: 100, render: (v: number) => formatBytes(v) },
                    { title: t('systemHealth.updatedAt'), dataIndex: 'updatedAt', width: 170 },
                    { title: t('common.status'), dataIndex: 'closed', width: 110, render: (v: boolean) => v ? <Tag color="orange">{t('common.closed')}</Tag> : <Tag color="green">{t('common.ok')}</Tag> },
                  ]}
                />

                <Table
                  size="small"
                  rowKey="stationNo"
                  dataSource={closedStations}
                  pagination={false}
                  title={() => t('systemHealth.accountingClosedStations')}
                  columns={[
                    { title: t('systemHealth.stationNo'), dataIndex: 'stationNo', width: 90 },
                    { title: t('retail.station'), dataIndex: 'name', width: 180 },
                    { title: t('common.status'), dataIndex: 'statusLabel', width: 140 },
                    { title: t('retail.expectedResume'), dataIndex: 'expectedResumeAt', width: 150, render: (v: any) => v || '-' },
                    { title: t('common.remark'), dataIndex: 'closedReason' },
                  ]}
                />
              </Space>
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
