import { useState, useMemo } from 'react';
import { Row, Col, Card, Statistic, Table, Typography, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getStationStatuses, getKpi, getDaily, getDashboardYearly, getStationMapDetails } from '@/api/retail';
import { getRetailAlertInsights } from '@/api/retailAlerts';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';

const { Text } = Typography;

function formatLiters(value: unknown, digits = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '--';
  return numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function stationStatusTag(item: any) {
  const value = item?.statusType || item?.closedReason || item?.status || '';
  const key = String(value).toLowerCase();
  if (['normal', 'active', 'open', 'operating', '在营', '正常营业', '正在营业'].includes(key)) {
    return { key: 'normal', text: '在营', color: 'green' };
  }
  if (['renovation', 'renovating', 'repair', 'maintenance', '装修', '装修停业', '装修/维修'].includes(key) || key.includes('装修')) {
    return { key: 'renovation', text: '装修', color: 'orange' };
  }
  if (['suspended', 'closed', 'inactive', '停业', '关闭', '暂停营业'].includes(key) || key.includes('停业')) {
    return { key: 'closed', text: '停业', color: 'red' };
  }
  return { key: 'other', text: item?.statusLabel || item?.status || '--', color: 'default' };
}

export default function Alert() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { region } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const statusQ = useApiQuery(['retail', 'station-statuses'], getStationStatuses);
  const kpiQ = useApiQuery(['retail', 'kpi'], getKpi);
  const dailyQ = useApiQuery(['retail', 'daily', ym], () => getDaily(ym));
  const dashQ = useApiQuery(['retail', 'dashboard-yearly', now.getFullYear()], () => getDashboardYearly(now.getFullYear()));
  const mapDetailsQ = useApiQuery(['retail', 'station-map-details'], getStationMapDetails);
  const lang = i18n.language === 'ru' ? 'ru' : 'zh';
  const insightQ = useApiQuery(['retail', 'alert-insights', ym, lang], () => getRetailAlertInsights(ym, false, lang));

  const statuses = useMemo(() => {
    const raw = statusQ.data;
    if (!raw) return { closed: [], renovating: [], suggestions: [] };
    if (Array.isArray(raw)) return { closed: raw.filter((s: any) => s.status !== 'normal'), renovating: [], suggestions: [] };
    const items = raw.items ?? raw.stations ?? [];
    return {
      closed: items.filter((s: any) => s.status !== 'normal'),
      renovating: items.filter((s: any) => stationStatusTag(s).key === 'renovation'),
      suggestions: raw.suggestions ?? [],
    };
  }, [statusQ.data]);

  const kpi = kpiQ.data?.summary;
  const daily = dailyQ.data?.daily ?? [];

  const fallbackAnomalies = useMemo(() => {
    const result: any[] = [];
    for (let i = 1; i < daily.length; i++) {
      const prev = daily[i - 1]?.volume ?? 0;
      const curr = daily[i]?.volume ?? 0;
      if (prev > 0 && (prev - curr) / prev > 0.3) {
        result.push({ date: daily[i].date, prevVolume: prev, currVolume: curr, drop: Math.round(((prev - curr) / prev) * 100) });
      }
    }
    return result;
  }, [daily]);
  const anomalies = insightQ.data?.trendAnomalies?.length ? insightQ.data.trendAnomalies : fallbackAnomalies;
  const inventoryLevels = useMemo(() => {
    const rows: any[] = [];
    for (const station of mapDetailsQ.data?.items ?? []) {
      for (const resource of station.inventoryByResource ?? []) {
        if (resource.fillStatus === 'critical' || resource.fillStatus === 'warning') {
          rows.push({
            shopKey: station.shopKey,
            stationName: station.name || station.short || `站点${station.shopKey}`,
            resourceKey: resource.resourceKey,
            resourceName: resource.name,
            inventory: resource.inventory,
            capacity: resource.capacity,
            fillPercent: resource.fillPercent,
            fillStatus: resource.fillStatus,
          });
        }
      }
    }
    return rows.sort((a, b) => Number(a.fillPercent ?? 999) - Number(b.fillPercent ?? 999));
  }, [mapDetailsQ.data]);

  const regionKeys = dashQ.data ? Object.keys(dashQ.data.regions) : [];
  const topRegion = regionKeys.length > 0
    ? regionKeys.reduce((a, b) => (dashQ.data!.regions[a].amount > dashQ.data!.regions[b].amount ? a : b))
    : '';
  const topRegionAmount = topRegion && dashQ.data ? dashQ.data.regions[topRegion].amount : 0;
  const totalAmount = dashQ.data ? Object.values(dashQ.data.regions).reduce((s: number, r: any) => s + r.amount, 0) : 0;
  const regionConcentration = totalAmount > 0 ? (topRegionAmount / totalAmount) * 100 : 0;

  return (
    <div>
      <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      <Row gutter={[16, 16]} style={{ marginTop: 16, marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/station')}><Statistic title={t('retail.closedStations')} value={statuses.closed.length} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/station')}><Statistic title={t('retail.expectedResume')} value={statuses.renovating.length} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/monthly')}><Statistic title={t('retail.trendAnomaly')} value={anomalies.length} valueStyle={{ color: anomalies.length > 0 ? '#cf1322' : undefined }} /></Card></Col>
      </Row>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Card size="small" title={t('retail.closedStations')}>
          {statuses.closed.length > 0 ? (
            <Table dataSource={statuses.closed} rowKey={(r: any) => r.shopKey ?? r.name} size="small"
              columns={[
                { title: t('retail.station'), dataIndex: 'name', key: 'name' },
                { title: t('retail.region'), dataIndex: 'region', key: 'region' },
                { title: t('retail.status'), dataIndex: 'status', key: 'status', render: (_: any, row: any) => {
                  const status = stationStatusTag(row);
                  return <Tag color={status.color}>{t(`retailStatus.${status.key}`, { defaultValue: status.text })}</Tag>;
                } },
                { title: t('retail.expectedResume'), dataIndex: 'expectedResumeAt', key: 'expectedResumeAt', render: (v: any) => v ?? '-' },
              ]}
              pagination={false}
              scroll={{ x: 720, y: 260 }}
            />
          ) : <Text type="secondary">{t('common.noData')}</Text>}
        </Card>
        <Card size="small" title={t('retail.inventoryAlert')}>
          <Text>{t('retail.inventory')}: {Math.round(kpi?.inventory ?? 0).toLocaleString()}L</Text>
          <br /><Text type="secondary">{t('retail.alertRules')}: 绿色 ≥ 50%，黄色 30%-50%，红色 ＜ 30%</Text>
          {inventoryLevels.length > 0 ? (
            <Table
              style={{ marginTop: 12 }}
              dataSource={inventoryLevels}
              rowKey={(r: any) => `${r.shopKey}-${r.resourceKey}`}
              size="small"
              columns={[
                { title: t('retail.station'), dataIndex: 'stationName', key: 'stationName' },
                { title: '油品', dataIndex: 'resourceName', key: 'resourceName' },
                { title: t('retail.inventory'), dataIndex: 'inventory', key: 'inventory', render: (v: any) => `${formatLiters(v, 2)} L` },
                { title: '容量', dataIndex: 'capacity', key: 'capacity', render: (v: any) => (v ? `${formatLiters(v)} L` : '-') },
                { title: '水位', dataIndex: 'fillPercent', key: 'fillPercent', render: (v: any, row: any) => (
                  <Tag color={row.fillStatus === 'critical' ? 'red' : 'gold'}>{Number(v || 0).toFixed(1)}%</Tag>
                ) },
              ]}
              pagination={false}
              scroll={{ x: 720, y: 260 }}
            />
          ) : (
            <div style={{ marginTop: 12 }}><Text type="secondary">{t('common.noData')}</Text></div>
          )}
        </Card>
        <Card size="small" title={t('retail.trendAnomaly')}>
          {anomalies.length > 0 ? (
            <ul>{anomalies.slice(0, 10).map((a, i) => (
              <li key={i}>
                {a.date || a.station}: {(a.currentVolume ?? a.currVolume ?? 0).toLocaleString()}L
                {a.baselineVolume ? ` / ${a.baselineVolume.toLocaleString()}L` : ''}
                {a.changePct ? ` (${a.changePct}%)` : a.drop ? ` (-${a.drop}%)` : ''}
              </li>
            ))}</ul>
          ) : <Text type="secondary">{t('common.noData')}</Text>}
        </Card>
        <Card size="small" title={t('retail.suggestions')}>
          {insightQ.data?.generatedAt && <Text type="secondary">{t('retail.generatedAt')}: {insightQ.data.generatedAt}</Text>}
          <ul>
            {(insightQ.data?.suggestions?.length ? insightQ.data.suggestions : [
              `${t('retail.cardRatio')}: ${kpi?.cardSales && kpi?.totalSales ? `${Math.round((kpi.cardSales / kpi.totalSales) * 100)}%` : '-'} — ${t('retail.promoteCard')}`,
              `${t('retail.region')}: ${region(topRegion)} ${regionConcentration.toFixed(0)}% — ${regionConcentration > 30 ? t('retail.regionConcentrationWarn') : t('common.ok')}`,
              `${t('retail.closedStations')}: ${statuses.closed.length} ${t('retail.stationUnit')} — ${t('retail.suggestions')}`,
            ]).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </Card>
        <Card size="small" title={t('retail.alertRules')}>
          <ul>
            <li>{t('retail.ruleTrendAnomaly')}</li>
            <li>库存水位：黄色 30%-50%，红色 ＜ 30%</li>
            <li>{t('retail.ruleRegionConcentration')}</li>
            <li>{t('retail.ruleStationDowntime')}</li>
          </ul>
        </Card>
      </Space>
    </div>
  );
}
