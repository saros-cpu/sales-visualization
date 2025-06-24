import { useState, useMemo } from 'react';
import { Row, Col, Card, Statistic, Table, Typography, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getStationStatuses, getKpi, getDaily, getDashboardYearly } from '@/api/retail';
import PeriodPicker from '@/components/ui/PeriodPicker';

const { Text } = Typography;

export default function Alert() {
  const { t } = useTranslation();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const statusQ = useApiQuery(['retail', 'station-statuses'], getStationStatuses);
  const kpiQ = useApiQuery(['retail', 'kpi'], getKpi);
  const dailyQ = useApiQuery(['retail', 'daily', ym], () => getDaily(ym));
  const dashQ = useApiQuery(['retail', 'dashboard-yearly', now.getFullYear()], () => getDashboardYearly(now.getFullYear()));

  const statuses = useMemo(() => {
    const raw = statusQ.data;
    if (!raw) return { closed: [], renovating: [], suggestions: [] };
    if (Array.isArray(raw)) return { closed: raw.filter((s: any) => s.status !== 'normal'), renovating: [], suggestions: [] };
    const items = raw.items ?? raw.stations ?? [];
    return {
      closed: items.filter((s: any) => s.status !== 'normal'),
      renovating: items.filter((s: any) => !s.affectsSales),
      suggestions: raw.suggestions ?? [],
    };
  }, [statusQ.data]);

  const kpi = kpiQ.data?.summary;
  const daily = dailyQ.data?.daily ?? [];

  const anomalies = useMemo(() => {
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
      <Row gutter={16} style={{ marginTop: 16, marginBottom: 16 }}>
        <Col xs={8}><Card size="small"><Statistic title={t('retail.closedStations')} value={statuses.closed.length} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title={t('retail.expectedResume')} value={statuses.renovating.length} /></Card></Col>
        <Col xs={8}><Card size="small"><Statistic title={t('retail.trendAnomaly')} value={anomalies.length} valueStyle={{ color: anomalies.length > 0 ? '#cf1322' : undefined }} /></Card></Col>
      </Row>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Card size="small" title={t('retail.closedStations')}>
          {statuses.closed.length > 0 ? (
            <Table dataSource={statuses.closed} rowKey={(r: any) => r.shopKey ?? r.name} size="small"
              columns={[
                { title: t('retail.station'), dataIndex: 'name', key: 'name' },
                { title: t('retail.region'), dataIndex: 'region', key: 'region' },
                { title: t('retail.status'), dataIndex: 'status', key: 'status' },
                { title: t('retail.expectedResume'), dataIndex: 'expectedResume', key: 'expectedResume', render: (v: any) => v ?? '-' },
              ]}
              pagination={false}
            />
          ) : <Text type="secondary">{t('common.noData')}</Text>}
        </Card>
        <Card size="small" title={t('retail.inventoryAlert')}>
          <Text>{t('retail.inventory')}: {Math.round(kpi?.inventory ?? 0).toLocaleString()}L</Text>
          <br /><Text type="secondary">{t('retail.alertRules')}: &lt; 10% 总容量触发低库存预警</Text>
        </Card>
        <Card size="small" title={t('retail.trendAnomaly')}>
          {anomalies.length > 0 ? (
            <ul>{anomalies.slice(0, 10).map((a, i) => (
              <li key={i}>{a.date}: {a.prevVolume.toLocaleString()}L → {a.currVolume.toLocaleString()}L (-{a.drop}%)</li>
            ))}</ul>
          ) : <Text type="secondary">{t('common.noData')}</Text>}
        </Card>
        <Card size="small" title={t('retail.suggestions')}>
          <ul>
            <li>{t('retail.cardRatio')}: {kpi?.cardSales && kpi?.totalSales ? `${Math.round((kpi.cardSales / kpi.totalSales) * 100)}%` : '-'} — 推广电子支付</li>
            <li>{t('retail.region')}: {topRegion} {regionConcentration.toFixed(0)}% — {regionConcentration > 30 ? t('retail.suggestions') : t('common.ok')}</li>
            <li>{t('retail.closedStations')}: {statuses.closed.length} 站 — {t('retail.suggestions')}</li>
          </ul>
        </Card>
        <Card size="small" title={t('retail.alertRules')}>
          <ul>
            <li>连续 2 天环比下降 &gt; 30% → 趋势异常告警</li>
            <li>库存 &lt; 10% 总容量 → 低库存预警</li>
            <li>单个区域占比 &gt; 30% → 区域集中度建议</li>
            <li>停业/装修超过 7 天 → 运营跟进建议</li>
          </ul>
        </Card>
      </Space>
    </div>
  );
}
