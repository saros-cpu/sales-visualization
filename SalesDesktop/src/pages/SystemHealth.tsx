import { useMemo } from 'react';
import { Card, Tabs, Row, Col, Statistic, Table, Tag, Button, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getSystemHealth } from '@/api/system';

const { Text } = Typography;

function statusColor(status?: string) {
  if (status === 'ok' || status === 'success') return 'green';
  if (status === 'failed' || status === 'error') return 'red';
  return 'orange';
}

export default function SystemHealth() {
  const { t } = useTranslation();
  const query = useApiQuery(['system-health'], getSystemHealth, { refetchInterval: 60000 });
  const data = query.data || {};
  const cacheItems = data.cache?.items || [];
  const apiRecent = data.api?.recent || [];
  const apiTop = data.api?.topPaths24h || [];
  const automation = data.automation || [];
  const ai = data.ai || {};

  const serviceCards = useMemo(() => Object.entries(data.services || {}).map(([key, value]: [string, any]) => ({
    key,
    status: value?.status || 'unknown',
  })), [data.services]);

  return (
    <Card
      title={t('systemHealth.title')}
      extra={<Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching}>{t('common.update')}</Button>}
    >
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.overall')} value={data.status || '-'} valueStyle={{ color: data.status === 'ok' ? '#389e0d' : '#d48806' }} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.apiFailed24h')} value={data.api?.failed24h ?? 0} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiFailed7d')} value={ai.failed7d ?? 0} /></Card></Col>
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
              <Table
                size="small"
                rowKey="task_name"
                dataSource={automation}
                pagination={false}
                columns={[
                  { title: t('systemHealth.taskName'), dataIndex: 'task_name' },
                  { title: t('common.status'), dataIndex: 'status', width: 120, render: (v: string) => <Tag color={statusColor(v)}>{v}</Tag> },
                  { title: t('systemHealth.startedAt'), dataIndex: 'started_at', width: 170 },
                  { title: t('systemHealth.finishedAt'), dataIndex: 'finished_at', width: 170 },
                  { title: t('systemHealth.error'), dataIndex: 'error' },
                ]}
              />
            ),
          },
          {
            key: 'ai',
            label: t('systemHealth.ai'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiConfigured')} value={ai.configured ? t('common.yes') : t('common.no')} /></Card></Col>
                <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiModel')} value={ai.model || '-'} /></Card></Col>
                <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiCalls7d')} value={ai.total7d ?? 0} /></Card></Col>
                <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiAvgDuration')} value={ai.avgDurationMs ?? 0} suffix="ms" /></Card></Col>
                <Col xs={24} sm={8}><Card size="small"><Statistic title={t('systemHealth.aiLastCalled')} value={ai.lastCalledAt || '-'} /></Card></Col>
              </Row>
            ),
          },
        ]}
      />
    </Card>
  );
}
