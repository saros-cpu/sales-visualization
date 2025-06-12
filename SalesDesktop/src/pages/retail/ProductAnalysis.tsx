import { useEffect, useState } from 'react';
import { Row, Col, Card, Spin, Alert, Select, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getResourcesYearly, getMonthly, ResourceYearlyData, MonthlyData } from '@/api/retail';

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export default function ProductAnalysis() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [resData, setResData] = useState<ResourceYearlyData | null>(null);
  const [monthly, setMonthly] = useState<MonthlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getResourcesYearly(year, parseInt(currentMonth)),
      getMonthly(`${year}-${currentMonth}`),
    ]).then(([r, m]) => {
      setResData(r);
      setMonthly(m);
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [year]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;
  if (!resData || !monthly) return null;

  const resourceMixOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 80, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: resData.resources.map((r) => r.name).reverse(), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: resData.resources.map((r) => ({
        value: Math.round(r.volume / 10000),
        itemStyle: { color: r.color || '#00d4ff' },
      })).reverse(),
    }],
  };

  const volumePieOption = {
    tooltip: { trigger: 'item' as const, formatter: `{b}: {c}${t('common.wanL')} ({d}%)` },
    series: [{
      type: 'pie' as const, radius: ['40%', '70%'],
      data: resData.resources.map((r) => ({
        name: r.name, value: Math.round(r.volume / 10000),
        itemStyle: { color: r.color || '#00d4ff' },
      })),
      label: { show: true, formatter: '{b}\n{d}%' },
    }],
  };

  const columns = [
    { title: t('retail.product'), dataIndex: 'name', key: 'name' },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', render: (v: number) => Math.round(v).toLocaleString() },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', render: (v: number) => Math.round(v).toLocaleString() },
    { title: t('common.yoy'), dataIndex: 'yoyVolume', key: 'yoyVolume', render: (v: number) => v != null ? `${(v >= 0 ? '+' : '')}${v.toFixed(1)}%` : '-' },
    { title: t('common.mom'), dataIndex: 'momVolume', key: 'momVolume', render: (v: number) => v != null ? `${(v >= 0 ? '+' : '')}${v.toFixed(1)}%` : '-' },
  ];

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col><h2>{t('retail.productAnalysis')}</h2></Col>
        <Col>
          <Select value={year} onChange={setYear} style={{ width: 100 }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <Select.Option key={y} value={y}>{y}</Select.Option>
            ))}
          </Select>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}><Card title={t('retail.resourceMix')} size="small"><ReactEChartsCore echarts={echarts} option={resourceMixOption} style={{ height: 350 }} /></Card></Col>
        <Col span={12}><Card title={t('retail.volumeProportion')} size="small"><ReactEChartsCore echarts={echarts} option={volumePieOption} style={{ height: 350 }} /></Card></Col>
      </Row>
      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title={t('retail.productDetail')}>
            <Table dataSource={resData.resources} columns={columns} rowKey="resourceKey" size="small" pagination={false} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
