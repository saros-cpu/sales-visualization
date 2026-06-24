import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, message, Popconfirm, Row, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { generateAccountingReports, getAccountingReportStatus, getSystemHealth, runAutomationTask, type AutomationTaskKey } from '@/api/system';
import KpiCard, { KpiGrid } from '@/components/ui/KpiCard';
import PageState from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import {
  actionItemRoute,
  asArray,
  asRecord,
  resolveSystemHealthTab,
  textList,
} from '@/utils/systemHealth';

const { Text } = Typography;

function statusColor(status?: string) {
  if (status === 'ok' || status === 'success') return 'green';
  if (status === 'failed' || status === 'error') return 'red';
  return 'orange';
}

function severityColor(severity?: string) {
  if (severity === 'danger') return 'red';
  if (severity === 'warning') return 'orange';
  if (severity === 'info') return 'blue';
  return 'default';
}

function formatBytes(value?: number) {
  const bytes = Number(value || 0);
  if (!bytes) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function accountingFailedItemText(item: any) {
  const stationNo = item?.stationNo || item?.station?.stationNo || (item?.shopKey ? String(item.shopKey).padStart(3, '0') : '');
  const station = stationNo ? `${stationNo}号站` : '';
  return [station, item?.file, item?.reason || item?.message || item?.type].filter(Boolean).join(' ');
}

export default function SystemHealth() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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
  const activeTab = useMemo(() => {
    return resolveSystemHealthTab(location.search);
  }, [location.search]);
  const data = asRecord(query.data);
  const accounting = asRecord(accountingQuery.data);
  const api = asRecord(data.api);
  const cache = asRecord(data.cache);
  const services = asRecord(data.services);
  const missingStations = asArray<any>(accounting.missingStations);
  const generatedFiles = asArray<any>(accounting.generatedFiles);
  const closedStations = asArray<any>(accounting.closedStations);
  const accountingWarnings = asArray<any>(accounting.warnings);
  const accountingSkipped = asArray<any>(accounting.skipped);
  const accountingFailedItems = asArray<any>(accounting.failedItems);
  const cacheItems = asArray<any>(cache.items);
  const apiRecent = asArray<any>(api.recent);
  const apiTop = asArray<any>(api.topPaths24h);
  const automation = asArray<any>(data.automation);
  const ai = asRecord(data.ai);
  const knowledge = asRecord(data.knowledge);
  const updater = asRecord(data.updater);
  const knowledgeWarnings = asArray<any>(knowledge.warnings);
  const updaterWarnings = asArray<any>(updater.warnings);
  const updaterFiles = asArray<any>(updater.files);
  const actionCenter = asRecord(data.actionCenter);
  const actionSummary = asRecord(actionCenter.summary);
  const retailAlerts = asRecord(data.retailAlerts);
  const reportAudit = asRecord(data.reportAudit);
  const canRunAutomation = user?.role === 'admin' || can('system_health:manage');

  const serviceCards = useMemo(() => Object.entries(services).map(([key, value]: [string, any]) => ({
    key,
    status: value?.status || 'unknown',
  })), [services]);
  const actionItems = useMemo(() => {
    const severityRank: Record<string, number> = { danger: 0, warning: 1, info: 2 };
    return [...asArray<any>(actionCenter.items)].sort((a: any, b: any) => (
      (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
    ));
  }, [actionCenter.items]);
  const automationActions: Array<{ task: AutomationTaskKey; label: string }> = [
    { task: 'exchange_rates', label: t('systemHealth.runExchangeRates') },
    { task: 'market_watch', label: t('systemHealth.runMarketWatch') },
    { task: 'retail_snapshots', label: t('systemHealth.runRetailSnapshots') },
    { task: 'retail_accounting_reports', label: t('systemHealth.runRetailAccountingReports') },
    { task: 'retail_254_monthly_archive', label: t('systemHealth.runRetail254MonthlyArchive') },
    { task: 'all', label: t('systemHealth.runAllTasks') },
  ];

  const handleRunTask = async (task: AutomationTaskKey) => {
    setRunningTask(task);
    try {
      const result = await runAutomationTask(task);
      const retailStatus = result?.results?.retailSnapshots?.status;
      const retail254Summary = result?.results?.retail254MonthlyArchive?.summary;
      const failedItems = Object.values(result?.results || {}).flatMap((item: any) => asArray<any>(item?.failedItems));
      const hasFailed = Object.values(result?.results || {}).some((item: any) => item?.status === 'failed');
      if (failedItems.length > 0) {
        message.warning(`${t('systemHealth.runWarning')}：${failedItems.slice(0, 3).map(accountingFailedItemText).join('；')}`);
      } else if (hasFailed) {
        message.warning(t('systemHealth.runWarning'));
      } else if (task === 'retail_254_monthly_archive' && retail254Summary) {
        message.success(t('systemHealth.runRetail254MonthlyArchiveSuccess', {
          month: retail254Summary.month || '-',
          count: retail254Summary.appliedCount ?? retail254Summary.generatedCount ?? 0,
        }));
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
      const failedItems = asArray<any>(result?.run?.failedItems).concat(asArray<any>(result?.status?.failedItems));
      const hasWarnings = result?.run?.status === 'failed' || failedItems.length > 0 || (result?.status?.warnings || []).length > 0;
      if (hasWarnings || (result?.status?.missingCount || 0) > 0) {
        const detail = failedItems.slice(0, 3).map(accountingFailedItemText).join('；');
        message.warning(detail ? `${t('systemHealth.accountingGenerateWarning')}：${detail}` : t('systemHealth.accountingGenerateWarning'));
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

  const handleTabChange = (key: string) => {
    navigate({
      pathname: location.pathname,
      search: key === 'actions' ? '' : `?tab=${key}`,
    });
  };

  if (query.isLoading) {
    return <PageState status="loading" />;
  }

  if (query.error) {
    return <PageState status="error" description={(query.error as Error)?.message} onRetry={() => query.refetch()} />;
  }

  return (
    <Card
      title={t('systemHealth.title')}
      extra={<Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('common.update')}</Button>}
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} xl={6}><KpiCard title={t('systemHealth.overall')} value={data.status || '-'} tone={data.status === 'ok' ? 'success' : 'warning'} /></Col>
        <Col xs={24} sm={12} xl={6}><KpiCard title={t('systemHealth.actionOpenCount')} value={actionSummary.openCount ?? 0} goodWhen="down" tone={(actionSummary.openCount ?? 0) > 0 ? 'warning' : 'success'} /></Col>
        <Col xs={24} sm={12} xl={6}><KpiCard title={t('systemHealth.apiFailed24h')} value={api.failed24h ?? 0} goodWhen="down" tone={(api.failed24h ?? 0) > 0 ? 'danger' : 'success'} /></Col>
        <Col xs={24} sm={12} xl={6}><KpiCard title={t('systemHealth.aiFailed7d')} value={ai.failed7d ?? 0} goodWhen="down" tone={(ai.failed7d ?? 0) > 0 ? 'danger' : 'success'} /></Col>
      </Row>
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: 'actions',
            label: t('systemHealth.actionCenter'),
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <Alert
                  showIcon
                  type={actionItems.length ? 'warning' : 'success'}
                  message={actionItems.length
                    ? t('systemHealth.actionCenterWarning', { count: actionItems.length })
                    : t('systemHealth.actionCenterOk')}
                  description={actionItems[0]?.detail || t('systemHealth.actionCenterHint')}
                />
                <KpiGrid items={[
                  { key: 'open', title: t('systemHealth.actionOpenCount'), value: actionSummary.openCount ?? 0, tone: (actionSummary.openCount ?? 0) > 0 ? 'warning' : 'success', span: 6 },
                  { key: 'danger', title: t('systemHealth.actionDangerCount'), value: actionSummary.dangerCount ?? 0, tone: (actionSummary.dangerCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'warning', title: t('systemHealth.actionWarningCount'), value: actionSummary.warningCount ?? 0, tone: (actionSummary.warningCount ?? 0) > 0 ? 'warning' : 'success', span: 6 },
                  { key: 'retailAnomaly', title: t('systemHealth.retailAnomalyCount'), value: retailAlerts.anomalyCount ?? 0, tone: (retailAlerts.anomalyCount ?? 0) > 0 ? 'warning' : 'success', span: 6 },
                  { key: 'report254', title: t('systemHealth.report254Diff'), value: reportAudit.monthVs254 ?? 0, tone: (reportAudit.monthVs254 ?? 0) > 0 ? 'warning' : 'success', span: 6 },
                ]} />
                <Table
                  size="small"
                  rowKey={(row: any) => row?.code || `${row?.category || 'item'}-${row?.title || row?.updatedAt || 'unknown'}`}
                  dataSource={actionItems}
                  pagination={false}
                  columns={[
                    { title: t('systemHealth.severityTitle'), dataIndex: 'severity', width: 110, render: (v: string) => <Tag color={severityColor(v)}>{t(`systemHealth.severity.${v}`, { defaultValue: v })}</Tag> },
                    { title: t('systemHealth.categoryTitle'), dataIndex: 'category', width: 120, render: (v: string) => t(`systemHealth.category.${v}`, { defaultValue: v }) },
                    { title: t('systemHealth.actionTitle'), dataIndex: 'title', width: 190 },
                    { title: t('systemHealth.actionDetail'), dataIndex: 'detail' },
                    { title: t('systemHealth.owner'), dataIndex: 'owner', width: 120 },
                    {
                      title: t('systemHealth.suggestedAction'),
                      dataIndex: 'action',
                      render: (value: string, row: any) => {
                        const route = actionItemRoute(row);
                        return (
                          <Space wrap size={8}>
                            <span>{value || '-'}</span>
                            {route && (
                              <Button size="small" onClick={() => navigate(route)}>
                                {t('auditLogs.actions.view')}
                              </Button>
                            )}
                          </Space>
                        );
                      },
                    },
                    { title: t('systemHealth.updatedAt'), dataIndex: 'updatedAt', width: 170, render: (v: any) => v || '-' },
                  ]}
                />
              </Space>
            ),
          },
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
                  { title: t('common.status'), dataIndex: 'valid', width: 100, render: (_: any, row: any) => <Tag color={row?.exists && row?.valid ? 'green' : 'red'}>{row?.exists && row?.valid ? t('common.ok') : t('common.failed')}</Tag> },
                  { title: t('systemHealth.updatedAt'), dataIndex: 'updatedAt', width: 170 },
                  { title: t('systemHealth.size'), dataIndex: 'size', width: 100 },
                  { title: t('systemHealth.error'), dataIndex: 'error', render: (v: any, row: any) => v || textList(row?.missingKeys).join(', ') || '-' },
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
                {(knowledgeWarnings.length > 0 || updaterWarnings.length > 0) && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t('systemHealth.governanceWarnings')}
                    description={textList([...knowledgeWarnings, ...updaterWarnings]).join(', ')}
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
                    { title: t('common.status'), dataIndex: 'exists', width: 110, render: (_: any, row: any) => <Tag color={row?.exists && row?.valid ? 'green' : 'red'}>{row?.exists && row?.valid ? t('common.ok') : t('common.failed')}</Tag> },
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
                  { key: 'failed', title: t('systemHealth.accountingFailed'), value: accounting.failedCount ?? 0, tone: (accounting.failedCount ?? 0) > 0 ? 'danger' : 'success', span: 6 },
                  { key: 'closed', title: t('systemHealth.accountingClosed'), value: accounting.closedCount ?? 0, span: 6 },
                ]} />

                {(accountingWarnings.length > 0 || accountingSkipped.length > 0) && (
                  <Alert
                    showIcon
                    type="warning"
                    message={t('systemHealth.accountingWarnings')}
                    description={[...textList(accountingWarnings), ...accountingSkipped.map((item: any) => `${String(item?.shopKey || '').padStart(3, '0')}: ${item?.reason || '-'}`)].slice(0, 12).join('；')}
                  />
                )}

                {accountingFailedItems.length > 0 && (
                  <Table
                    size="small"
                    rowKey={(row: any, index) => `${row?.type || 'failed'}-${row?.shopKey || row?.stationNo || 'unknown'}-${row?.file || row?.shiftBegin || index}`}
                    dataSource={accountingFailedItems}
                    pagination={{ pageSize: 8 }}
                    title={() => t('systemHealth.accountingFailedItems')}
                    columns={[
                      { title: t('systemHealth.stationNo'), dataIndex: 'stationNo', width: 90, render: (v: any, row: any) => v || (row?.shopKey ? String(row.shopKey).padStart(3, '0') : '-') },
                      { title: t('retail.station'), dataIndex: ['station', 'name'], width: 180, render: (v: any) => v || '-' },
                      { title: t('systemHealth.failureType'), dataIndex: 'type', width: 120 },
                      { title: t('systemHealth.fileName'), dataIndex: 'file', width: 220, render: (v: any) => v || '-' },
                      { title: t('systemHealth.failureReason'), dataIndex: 'reason', render: (v: any, row: any) => v || row?.message || '-' },
                    ]}
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
