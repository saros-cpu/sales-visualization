import { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Alert, Select, Tag } from 'antd';
import { DollarOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import client from '@/api/client';
import { getKpiYearly, getDashboardYearly, getMonthly } from '@/api/retail';
import { getCurrentExchange, CurrentExchange } from '@/api/exchange';
import KpiCard from '@/components/ui/KpiCard';
import { useNameI18n } from '@/utils/i18nNames';
import { CHART_PALETTE } from '@/theme/charts';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface DashboardData {
  yearlyWholesaleTons: number;
  activeContracts: number;
  yearlyProcurementTons: number;
}

interface MonthlyTrend {
  month: string;
  volume: number;
  amount: number;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { product } = useNameI18n();
  const [data, setData] = useState<DashboardData | null>(null);
  const [kpi, setKpi] = useState<{ totalSales: number; totalLiters: number; activeShops: number; yoySales?: number; yoyVolume?: number } | null>(null);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rate, setRate] = useState<CurrentExchange | null>(null);
  const [marketWatch, setMarketWatch] = useState<{ items: any[]; updatedAt: string | null } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    const currentMonth = new Date().getMonth() + 1;
    Promise.all([
      client.get('/dashboard/overview'),
      getKpiYearly(year),
      Promise.allSettled(
        Array.from({ length: currentMonth > 12 ? 12 : currentMonth }, (_, i) =>
          getMonthly(`${year}-${String(i + 1).padStart(2, '0')}`)
        )
      ),
      getCurrentExchange(),
      client.get('/dashboard/market-watch'),
    ]).then(([overview, kpiRes, results, rateRes, mwRes]) => {
      setData(overview.data);
      const ks = kpiRes.summary || kpiRes.data?.summary || {};
      setKpi({
        totalSales: ks.totalSales || 0,
        totalLiters: ks.totalLiters || 0,
        activeShops: ks.activeShops || 0,
        yoySales: kpiRes.comparison?.yoySales || ks.yoySales,
        yoyVolume: kpiRes.comparison?.yoyVolume || ks.yoyVolume,
      });
      const monthlyTrend: MonthlyTrend[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          monthlyTrend.push({
            month: `${i + 1}${t('common.month')}`,
            volume: Math.round(r.value.summary.totalLiters),
            amount: Math.round(r.value.summary.totalSales / 10000),
          });
        }
      });
      setTrend(monthlyTrend);
      setRate(rateRes);
      setMarketWatch(mwRes.data);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [year]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;
  if (!data) return null;

  const trendOption = trend.length > 0 ? {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, formatter: (p: any) => {
      const list = Array.isArray(p) ? p : [p];
      let html = `<b>${list[0]?.axisValue || ''}</b>`;
      list.forEach((item: any) => {
        const val = item.seriesName === t('retail.volume') ? item.value.toLocaleString() + 'L' : item.value + t('common.wan');
        html += `<br/>${item.marker} ${item.seriesName}: ${val}`;
      });
      return html;
    } },
    legend: { data: [t('retail.volume'), t('retail.amount')], bottom: 0 },
    grid: { left: 56, right: 56, top: 58, bottom: 68, containLabel: true },
    xAxis: {
      type: 'category' as const,
      nameLocation: 'center',
      nameGap: 42,
      data: trend.map((d) => d.month),
      axisLabel: { interval: 0, rotate: trend.length > 7 ? 35 : 0, hideOverlap: false },
    },
    yAxis: [
      { type: 'value' as const, name: t('retail.volume') + '(L)' },
      { type: 'value' as const, name: `${t('retail.amount')}(${t('common.wan')})`, position: 'right' as const },
    ],
    series: [
      { name: t('retail.volume'), type: 'bar' as const, data: trend.map((d) => d.volume), itemStyle: { color: '#1677ff' }, label: { show: true, position: 'insideBottom', distance: 8, formatter: (p: any) => Math.round(Number(p.value || 0)).toLocaleString(), fontSize: 10, color: '#fff' } },
      { name: t('retail.amount'), type: 'line' as const, yAxisIndex: 1, data: trend.map((d) => d.amount), lineStyle: { color: '#52c41a' }, itemStyle: { color: '#52c41a' }, label: { show: true, position: 'top', distance: 30, offset: [0, -8], formatter: (p: any) => Number(p.value || 0).toLocaleString(), fontSize: 10 } },
    ],
  } : null;

  const formatYoy = (v: number | undefined) => {
    if (v == null) return '-';
    return `${(v >= 0 ? '+' : '')}${(v * 100).toFixed(1)}%`;
  };
  const formatRate = (value: number | undefined, precision: number) => {
    if (!Number.isFinite(value)) return '-';
    return Number(value).toFixed(precision);
  };

  return (
    <div>
      <Row justify="space-between" className="page-toolbar">
        <Col><h2>{t('nav.dashboard')}</h2></Col>
        <Col>
          <Select value={year} onChange={setYear} style={{ width: 100 }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <Select.Option key={y} value={y}>{y}</Select.Option>
            ))}
          </Select>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Col xs={24} lg={12} style={{ display: 'flex' }}>
          <Row gutter={[16, 16]} style={{ flex: 1, width: '100%', alignContent: 'flex-start' }}>
            <Col span={12}><KpiCard title={t('dashboard.yearlyWholesaleTons')} value={data.yearlyWholesaleTons} precision={1} suffix="т" /></Col>
            <Col span={12}><KpiCard title={t('dashboard.activeContracts')} value={data.activeContracts} /></Col>
            <Col span={12}><KpiCard title={t('dashboard.yearlyProcurementTons')} value={data.yearlyProcurementTons} precision={1} suffix="т" /></Col>
            {kpi && (
              <>
                <Col span={12}><KpiCard title={t('dashboard.retailSales')} value={Math.round(kpi.totalSales / 100000000)} suffix={t('common.yi') + ' сом'} delta={kpi.yoySales ? Math.round(kpi.yoySales * 100) : undefined} /></Col>
                <Col span={12}><KpiCard title={t('dashboard.retailVolume')} value={Math.round(kpi.totalLiters / 10000)} suffix={t('common.wanL')} delta={kpi.yoyVolume ? Math.round(kpi.yoyVolume * 100) : undefined} /></Col>
                <Col span={12}><KpiCard title={t('retail.activeShops')} value={kpi.activeShops} /></Col>
              </>
            )}
            <Col span={24} style={{ display: 'flex', flex: 1 }}>
              <Card size="small" title={<><DollarOutlined /> {t('exchange.today')}</>} className="dashboard-rate-card" style={{ width: '100%' }}>
                {rate ? (
                  <div className="dashboard-rate-grid">
                    <div className="dashboard-rate-item">
                      <span>美元/索姆</span>
                      <strong className="cyan">{formatRate(rate.usdKgs, 4)}</strong>
                    </div>
                    <div className="dashboard-rate-item">
                      <span>人民币/索姆</span>
                      <strong className="amber">{formatRate(rate.cnyKgs, 4)}</strong>
                    </div>
                    <div className="dashboard-rate-item">
                      <span>索姆/人民币</span>
                      <strong>{formatRate(rate.cnyKgs ? 1 / rate.cnyKgs : undefined, 6)}</strong>
                    </div>
                    <div className="dashboard-rate-meta">
                      <div>{rate.date || '-'}</div>
                      <div>{t('exchange.source')}: {rate.source || 'NBKR'}</div>
                    </div>
                  </div>
                ) : <Alert type="info" message={t('common.noData')} style={{ margin: 0 }} />}
              </Card>
            </Col>
          </Row>
        </Col>
        <Col xs={24} lg={12} style={{ display: 'flex' }}>
          <Card size="small" title={<><InfoCircleOutlined /> {t('exchange.marketWatch')}</>} style={{ height: '100%', width: '100%' }}>
            {marketWatch && marketWatch.items && marketWatch.items.length > 0 ? marketWatch.items.slice(0, 3).map((item: any) => (
              <div key={item.id} style={{ marginBottom: 12, borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{item.summary}</div>
                {item.priceText && <Tag style={{ marginTop: 4 }}>{item.priceText}</Tag>}
                <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                  {item.sourceName} | {item.observedAt?.substring(0, 10)}
                </div>
              </div>
            )) : <Alert type="info" message={t('common.noData')} />}
          </Card>
        </Col>
      </Row>
      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card title={`${year}${t('common.retailTrend')}`} size="small">
            {trendOption ? (
              <ReactEChartsCore echarts={echarts} option={trendOption} style={{ height: 350 }} />
            ) : <Alert type="info" message={t('common.noData')} />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
