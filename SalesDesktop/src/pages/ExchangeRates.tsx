import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Select, Table, Tag, Button, Spin, Alert, Space } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getExchangeRates, exportExchangeRates, ExchangeRateItem } from '@/api/exchange';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export default function ExchangeRates() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<{ items: ExchangeRateItem[]; total: number; missingUsd: number; missingCny: number; openGaps: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getExchangeRates(year, month)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;

  const items = data?.items || [];
  const sorted = [...items].reverse();

  const usdValues = sorted.map((r) => r.usdKgs).filter((v): v is number => v !== null);
  const cnyValues = sorted.map((r) => r.cnyKgs).filter((v): v is number => v !== null);
  const usdMin = Math.min(...usdValues);
  const usdMax = Math.max(...usdValues);
  const cnyMin = Math.min(...cnyValues);
  const cnyMax = Math.max(...cnyValues);

  const chartOption = {
    tooltip: { trigger: 'axis' as const, formatter: (p: any) => {
      const list = Array.isArray(p) ? p : [p];
      let html = `<b>${list[0]?.axisValue || ''}</b>`;
      list.forEach((item: any) => {
        html += `<br/>${item.marker} ${item.seriesName}: ${item.value?.toFixed(4)}`;
      });
      return html;
    } },
    legend: { data: ['USD/KGS', 'CNY/KGS'], bottom: 0 },
    grid: { left: 60, right: 60, top: 10, bottom: 40 },
    xAxis: { type: 'category' as const, name: t('common.date'), nameLocation: 'center', nameGap: 30, data: sorted.map((r) => r.date.slice(5)), axisLabel: { fontSize: 10 } },
    yAxis: [
      { type: 'value' as const, name: 'USD/KGS', position: 'left' as const, axisLabel: { fontSize: 10 },
        min: usdMin - (usdMax - usdMin) * 0.1,
        max: usdMax + (usdMax - usdMin) * 0.1, },
      { type: 'value' as const, name: 'CNY/KGS', position: 'right' as const, axisLabel: { fontSize: 10 },
        min: cnyMin - (cnyMax - cnyMin) * 0.1,
        max: cnyMax + (cnyMax - cnyMin) * 0.1, },
    ],
    series: [
      { name: 'USD/KGS', type: 'line' as const, smooth: true, data: sorted.map((r) => r.usdKgs), lineStyle: { color: '#22d3ee' }, itemStyle: { color: '#22d3ee' } },
      { name: 'CNY/KGS', type: 'line' as const, smooth: true, yAxisIndex: 1, data: sorted.map((r) => r.cnyKgs), lineStyle: { color: '#facc15' }, itemStyle: { color: '#facc15' } },
    ],
  };

  const rateColumns = [
    { title: t('common.date'), dataIndex: 'date', key: 'date', width: 100, render: (v: string) => v.slice(5) },
    { title: 'USD/KGS', dataIndex: 'usdKgs', key: 'usdKgs', width: 110, render: (v: number | null) => v?.toFixed(4) ?? '-' },
    { title: 'CNY/KGS', dataIndex: 'cnyKgs', key: 'cnyKgs', width: 110, render: (v: number | null) => v?.toFixed(4) ?? '-' },
    { title: t('exchange.source'), dataIndex: 'source', key: 'source', width: 80, render: (v: string) => <Tag color={v === 'NBKR' ? 'blue' : 'orange'}>{v}</Tag> },
    {
      title: t('exchange.status'), key: 'status', width: 100,
      render: (_: unknown, r: ExchangeRateItem) => {
        if (r.missingUsd || r.missingCny) return <Tag color="red">{t('exchange.incomplete')}</Tag>;
        return <Tag color="green">{t('exchange.complete')}</Tag>;
      },
    },
  ];

  return (
    <div>
      <Row justify="space-between" style={{ marginBottom: 16 }}>
        <Col><h2>{t('nav.exchange')}</h2></Col>
        <Col>
          <Space>
            <Select value={month} onChange={setMonth} style={{ width: 90 }}>
              {Array.from({ length: 12 }, (_, i) => (
                <Select.Option key={i + 1} value={i + 1}>{i + 1}{t('common.month')}</Select.Option>
              ))}
            </Select>
            <Select value={year} onChange={setYear} style={{ width: 100 }}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <Select.Option key={y} value={y}>{y}</Select.Option>
              ))}
            </Select>
            <Button icon={<DownloadOutlined />} onClick={() => exportExchangeRates(year, month)}>{t('common.export')}</Button>
          </Space>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title={t('exchange.totalDays')} value={data?.total ?? 0} suffix={t('common.day')} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('exchange.openGaps')} value={data?.openGaps ?? 0} valueStyle={{ color: (data?.openGaps ?? 0) > 0 ? '#ff4d4f' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('exchange.missingUsd')} value={data?.missingUsd ?? 0} valueStyle={{ color: (data?.missingUsd ?? 0) > 0 ? '#faad14' : undefined }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={t('exchange.missingCny')} value={data?.missingCny ?? 0} valueStyle={{ color: (data?.missingCny ?? 0) > 0 ? '#faad14' : undefined }} /></Card></Col>
      </Row>
      <Card size="small" style={{ marginBottom: 16 }}>
        <ReactEChartsCore echarts={echarts} option={chartOption} style={{ height: 320 }} />
      </Card>
      <Card size="small">
        <Table
          dataSource={items}
          columns={rateColumns}
          rowKey="date"
          pagination={{ pageSize: 31, showTotal: (tot) => t('common.total', { count: tot }) }}
          size="small"
          scroll={{ x: 600 }}
        />
      </Card>
    </div>
  );
}