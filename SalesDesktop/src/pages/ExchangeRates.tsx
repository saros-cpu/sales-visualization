import { useCallback, useEffect, useState } from 'react';
import { Row, Col, Card, Select, Table, Tag, Button, Space } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { getExchangeRates, exportExchangeRates, ExchangeRateItem } from '@/api/exchange';
import { KpiGrid } from '@/components/ui/KpiCard';
import PageState from '@/components/ui/PageState';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export default function ExchangeRates() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState<{ items: ExchangeRateItem[]; total: number; missingUsd: number; missingCny: number; openGaps: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadRates = useCallback(() => {
    setLoading(true);
    setError('');
    getExchangeRates(year, month)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  if (loading) return <PageState status="loading" />;
  if (error) return <PageState status="error" description={error} onRetry={loadRates} />;

  const items = data?.items || [];
  const sorted = [...items].reverse();

  const usdValues = sorted.map((r) => r.usdKgs).filter((v): v is number => v !== null);
  const cnyValues = sorted.map((r) => r.cnyKgs).filter((v): v is number => v !== null);
  const usdMin = usdValues.length ? Math.min(...usdValues) : undefined;
  const usdMax = usdValues.length ? Math.max(...usdValues) : undefined;
  const cnyMin = cnyValues.length ? Math.min(...cnyValues) : undefined;
  const cnyMax = cnyValues.length ? Math.max(...cnyValues) : undefined;
  const axisMargin = (min?: number, max?: number) => {
    if (min == null || max == null) return {};
    const span = max - min || Math.max(max * 0.01, 0.01);
    return { min: min - span * 0.1, max: max + span * 0.1 };
  };

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
    grid: { left: 56, right: 56, top: 32, bottom: 68, outerBoundsMode: 'same' as const, outerBoundsContain: 'axisLabel' as const },
    xAxis: {
      type: 'category' as const,
      data: sorted.map((r) => r.date.slice(5)),
      axisLabel: { fontSize: 10, interval: 0, rotate: sorted.length > 12 ? 45 : 35, hideOverlap: false },
    },
    yAxis: [
      { type: 'value' as const, name: 'USD/KGS', position: 'left' as const, axisLabel: { fontSize: 10 },
        ...axisMargin(usdMin, usdMax), },
      { type: 'value' as const, name: 'CNY/KGS', position: 'right' as const, axisLabel: { fontSize: 10 },
        ...axisMargin(cnyMin, cnyMax), },
    ],
    series: [
      { name: 'USD/KGS', type: 'line' as const, smooth: true, data: sorted.map((r) => r.usdKgs), lineStyle: { color: '#22d3ee' }, itemStyle: { color: '#22d3ee' }, label: { show: true, position: 'top', formatter: (p: any) => Number(p.value || 0).toFixed(4), fontSize: 10 } },
      { name: 'CNY/KGS', type: 'line' as const, smooth: true, yAxisIndex: 1, data: sorted.map((r) => r.cnyKgs), lineStyle: { color: '#facc15' }, itemStyle: { color: '#facc15' }, label: { show: true, position: 'top', formatter: (p: any) => Number(p.value || 0).toFixed(4), fontSize: 10 } },
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
      <Row justify="space-between" className="page-toolbar">
        <Col><h2>{t('nav.exchange')}</h2></Col>
        <Col>
          <Space wrap>
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
      <div style={{ marginBottom: 16 }}>
        <KpiGrid items={[
          { key: 'total', title: t('exchange.totalDays'), value: data?.total ?? 0, suffix: t('common.day') },
          { key: 'gaps', title: t('exchange.openGaps'), value: data?.openGaps ?? 0, goodWhen: 'down', tone: (data?.openGaps ?? 0) > 0 ? 'danger' : 'success' },
          { key: 'usd', title: t('exchange.missingUsd'), value: data?.missingUsd ?? 0, goodWhen: 'down', tone: (data?.missingUsd ?? 0) > 0 ? 'warning' : 'success' },
          { key: 'cny', title: t('exchange.missingCny'), value: data?.missingCny ?? 0, goodWhen: 'down', tone: (data?.missingCny ?? 0) > 0 ? 'warning' : 'success' },
        ]} />
      </div>
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
          scroll={{ x: 600, y: 'calc(100vh - 470px)' }}
        />
      </Card>
    </div>
  );
}
