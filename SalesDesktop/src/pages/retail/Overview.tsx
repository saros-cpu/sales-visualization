import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Alert, Select, Space, Button, message } from 'antd';
import { DownloadOutlined, FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getDashboardYearly, getMonthly, DashboardYearlyData, MonthlyData } from '@/api/retail';
import { exportExcel, exportAnalysis } from '@/api/export';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const REGION_COLORS: Record<string, string> = {
  'REG-02': '#ef5350', 'REG-01': '#00e5a0', 'REG-04': '#a78bfa',
  'REG-05': '#ffa726', 'REG-06': '#00d4ff', 'REG-03': '#66bb6a',
};

export default function RetailOverview() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'));
  const [dashData, setDashData] = useState<DashboardYearlyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([
      getDashboardYearly(year),
      getMonthly(`${year}-${month}`),
    ]).then(([d, m]) => {
      setDashData(d);
      setMonthly(m);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [year, month]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;
  if (!dashData || !monthly) return null;

  const s = monthly.summary;
  const currentMonth = monthly.month;

  const regionBarOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: Object.keys(dashData.regions).reverse(), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: Object.keys(dashData.regions).reverse().map((r) => ({
        value: Math.round(dashData.regions[r].amount / 10000),
        itemStyle: { color: REGION_COLORS[r] || '#999' },
      })),
    }],
  };

  const trendOption = monthly.daily.length > 0 ? {
    tooltip: { trigger: 'axis' as const },
    legend: { data: [t('retail.volume'), t('retail.amount')], bottom: 0 },
    grid: { left: 50, right: 20, top: 10, bottom: 40 },
    xAxis: { type: 'category' as const, data: monthly.daily.map((d) => d.date.slice(8)), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value' as const, name: t('retail.volume'), position: 'left' as const },
      { type: 'value' as const, name: `${t('retail.amount')}(${t('common.wan')})`, position: 'right' as const },
    ],
    series: [
      { name: t('retail.volume'), type: 'bar' as const, data: monthly.daily.map((d) => Math.round(d.volume)) },
      { name: t('retail.amount'), type: 'line' as const, yAxisIndex: 1, data: monthly.daily.map((d) => Math.round(d.amount / 10000)) },
    ],
  } : null;

  const payOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c} ({d}%)' },
    series: [{
      type: 'pie' as const, radius: ['40%', '70%'], center: ['50%', '50%'],
      data: [
        { name: t('retail.cash'), value: Math.round(s.cashSales), itemStyle: { color: '#ffa726' } },
        { name: t('retail.card'), value: Math.round(s.cardSales), itemStyle: { color: '#a78bfa' } },
      ],
      label: { show: true, formatter: '{b}' },
    }],
  };

  const resourceRankOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 80, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: dashData.byResource.map((r) => t(`product.${r.name}`, { defaultValue: r.name })).reverse(), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: dashData.byResource.map((r) => ({
        value: Math.round(r.amount / 10000),
        itemStyle: { color: r.color || '#00d4ff' },
      })).reverse(),
    }],
  };

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col><h2>{t('nav.retail')}</h2></Col>
        <Col>
          <Space>
            <Button icon={<FileExcelOutlined />} onClick={() => exportExcel(`${year}-${month}`)}>{t('common.excelExport')}</Button>
            <Button icon={<FileTextOutlined />} onClick={() => exportAnalysis(`${year}-${month}`)}>{t('common.analysisReport')}</Button>
            <Select value={month} onChange={setMonth} style={{ width: 90 }}>
              {Array.from({ length: 12 }, (_, i) => (
                <Select.Option key={i + 1} value={String(i + 1).padStart(2, '0')}>{i + 1}{t('common.month')}</Select.Option>
              ))}
            </Select>
            <Select value={year} onChange={setYear} style={{ width: 100 }}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <Select.Option key={y} value={y}>{y}</Select.Option>
              ))}
            </Select>
          </Space>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}><Card size="small"><Statistic title={t('retail.totalSales')} value={Math.round(s.totalSales / 10000)} suffix={t('common.wan')} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('retail.totalVolume')} value={Math.round(s.totalLiters)} suffix="L" /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('retail.totalTxn')} value={s.totalTxn} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('retail.activeShops')} value={`${s.activeShops}/${s.totalShops}`} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('retail.cashSales')} value={Math.round(s.cashSales / 10000)} suffix={t('common.wan')} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title={t('retail.cardSales')} value={Math.round(s.cardSales / 10000)} suffix={t('common.wan')} /></Card></Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}><Card title={t('retail.regionRank')} size="small"><ReactEChartsCore echarts={echarts} option={regionBarOption} style={{ height: 300 }} /></Card></Col>
        <Col span={12}><Card title={t('retail.resourceRank')} size="small"><ReactEChartsCore echarts={echarts} option={resourceRankOption} style={{ height: 300 }} /></Card></Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={16}>{trendOption && <Card title={`${currentMonth} ${t('retail.dailyTrend')}`} size="small"><ReactEChartsCore echarts={echarts} option={trendOption} style={{ height: 300 }} /></Card>}</Col>
        <Col span={8}><Card title={t('retail.payMethod')} size="small"><ReactEChartsCore echarts={echarts} option={payOption} style={{ height: 300 }} /></Card></Col>
      </Row>
    </div>
  );
}
