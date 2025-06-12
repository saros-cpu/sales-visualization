import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Alert, Select, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, RadarComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getMonthly, getStationMonthly, MonthlyData, StationMonthlyData } from '@/api/retail';

echarts.use([BarChart, LineChart, PieChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, RadarComponent, CanvasRenderer]);

export default function StationAnalysis() {
  const { t } = useTranslation();
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [selectedStation, setSelectedStation] = useState<number | null>(null);
  const [stationData, setStationData] = useState<StationMonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [stationLoading, setStationLoading] = useState(false);
  const [error, setError] = useState('');

  const currentYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  useEffect(() => {
    setLoading(true);
    getMonthly(currentYearMonth).then((m) => {
      setMonthly(m);
      if (m.stations.length > 0) setSelectedStation(m.stations[0].shopKey);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedStation) return;
    setStationLoading(true);
    getStationMonthly(currentYearMonth, selectedStation).then(setStationData).catch(() => {}).finally(() => setStationLoading(false));
  }, [selectedStation]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;
  if (!monthly) return null;

  const s = selectedStation && stationData ? stationData.summary : null;

  const columns = [
    { title: t('retail.station'), dataIndex: 'name', key: 'name' },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', width: 100 },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', width: 100, render: (v: number) => Math.round(v).toLocaleString() },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', width: 120, render: (v: number) => Math.round(v).toLocaleString() },
    { title: t('retail.status'), dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag color={v === 'normal' ? 'green' : 'red'}>{v}</Tag> },
  ];

  const trendOption = stationData?.daily ? {
    tooltip: { trigger: 'axis' as const },
    legend: { data: [t('retail.volume'), t('retail.amount')], bottom: 0 },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type: 'category' as const, data: stationData.daily.map((d) => d.date.slice(8)), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value' as const, name: t('retail.volume') },
      { type: 'value' as const, name: t('retail.amount') },
    ],
    series: [
      { name: t('retail.volume'), type: 'bar' as const, data: stationData.daily.map((d) => Math.round(d.volume)) },
      { name: t('retail.amount'), type: 'line' as const, yAxisIndex: 1, data: stationData.daily.map((d) => Math.round(d.amount / 10000)) },
    ],
  } : null;

  const resourceOption = stationData?.byResource ? {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c}L ({d}%)' },
    series: [{
      type: 'pie' as const, radius: ['40%', '70%'],
      data: stationData.byResource.map((r) => ({
        name: r.name, value: Math.round(r.volume),
        itemStyle: { color: r.color || '#00d4ff' },
      })),
    }],
  } : null;

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col><h2>{t('retail.stationAnalysis')}</h2></Col>
      </Row>
      <Row gutter={16}>
        <Col span={8}>
          <Card size="small" title={t('retail.stationList')}>
            <Table
              dataSource={monthly.stations}
              columns={columns}
              rowKey="shopKey"
              size="small"
              pagination={false}
              scroll={{ y: 400 }}
              onRow={(record) => ({
                onClick: () => setSelectedStation(record.shopKey),
                style: { cursor: 'pointer', background: selectedStation === record.shopKey ? '#e6f4ff' : undefined },
              })}
            />
          </Card>
        </Col>
        <Col span={16}>
          {stationLoading ? <Spin style={{ display: 'block', margin: '100px auto' }} /> : stationData && s ? (
            <>
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={6}><Card size="small"><Statistic title={t('retail.volume')} value={Math.round(s.totalLiters)} suffix="L" /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title={t('retail.amount')} value={Math.round(s.totalSales / 10000)} suffix={t('common.wan')} /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title={t('retail.cashSales')} value={Math.round(s.cashSales / 10000)} suffix={t('common.wan')} /></Card></Col>
                <Col span={6}><Card size="small"><Statistic title={t('retail.cardSales')} value={Math.round(s.cardSales / 10000)} suffix={t('common.wan')} /></Card></Col>
              </Row>
              <Row gutter={16}>
                <Col span={16}>
                  {trendOption && <Card size="small" title={t('retail.dailyTrend')}><ReactEChartsCore echarts={echarts} option={trendOption} style={{ height: 300 }} /></Card>}
                </Col>
                <Col span={8}>
                  {resourceOption && <Card size="small" title={t('retail.resourceMix')}><ReactEChartsCore echarts={echarts} option={resourceOption} style={{ height: 300 }} /></Card>}
                </Col>
              </Row>
            </>
          ) : <Card><Alert type="info" message={t('common.noData')} /></Card>}
        </Col>
      </Row>
    </div>
  );
}
