import { useState } from 'react';
import { Row, Col, Space, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getYears, getDashboardYearly, getKpiYearly, getResourcesYearly } from '@/api/retail';
import { downloadYearlyReport } from '@/api/export';
import KpiCard from '@/components/ui/KpiCard';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';

const REGION_COLORS: Record<string, string> = {
  'REG-02': '#ef5350', 'REG-01': '#00e5a0', 'REG-04': '#a78bfa',
  'REG-05': '#ffa726', 'REG-06': '#00d4ff', 'REG-03': '#66bb6a',
};

export default function Overview() {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());

  const dashQ = useApiQuery(['retail', 'dashboard', year], () => getDashboardYearly(year));
  const kpiQ = useApiQuery(['retail', 'kpi', year], () => getKpiYearly(year));
  const resQ = useApiQuery(['retail', 'resources', year], () => getResourcesYearly(year));

  const dash = dashQ.data;
  const kpi = kpiQ.data?.summary as Record<string, number> | undefined;

  const onGenerate = async () => {
    try {
      await downloadYearlyReport(year);
      message.success(t('common.downloadStarted'));
    } catch {
      message.error(t('common.downloadFailed'));
    }
  };

  const regionOption = dash ? {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: Object.keys(dash.regions).reverse(), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: Object.keys(dash.regions).reverse().map((r) => ({
        value: Math.round(dash.regions[r].amount / 10000),
        itemStyle: { color: REGION_COLORS[r] || '#999' },
      })),
    }],
  } : {};

  const productOption = {
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: (resQ.data?.resources ?? []).map((r: any) => r.name).reverse() },
    series: [{ type: 'bar' as const, data: (resQ.data?.resources ?? []).map((r: any) => r.amount).reverse() }],
  };

  const top10 = dash?.stations
    ? [...dash.stations].sort((a, b) => b.amount - a.amount).slice(0, 10)
    : [];

  const top10Option = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: top10.map((s) => s.name).reverse(), axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar' as const, data: top10.map((s) => Math.round(s.amount / 10000)).reverse() }],
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={year} onChange={(y) => setYear(y)} picker="year" />
        <Button type="primary" onClick={onGenerate}>{t('retail.generateReport')}</Button>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.totalSales')} value={kpi?.totalSales ?? 0} precision={0} suffix="сом" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.totalLiters')} value={kpi?.totalLiters ?? 0} precision={0} suffix="L" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.activeShops')} value={kpi?.activeShops ?? 0} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.inventory')} value={kpi?.inventory ?? 0} precision={0} />
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.regionSales')} loading={dashQ.isLoading} option={regionOption} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productRank')} loading={resQ.isLoading} option={productOption} />
        </Col>
      </Row>
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.topStations')} loading={dashQ.isLoading} option={top10Option} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.regionSalesRank')} loading={dashQ.isLoading}
            option={{
              tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
              grid: { left: 120, right: 20, top: 10, bottom: 30 },
              xAxis: { type: 'value' as const },
              yAxis: { type: 'category' as const, data: Object.keys(dash?.regions ?? {}).reverse(), axisLabel: { fontSize: 11 } },
              series: [{
                type: 'bar' as const, data: Object.keys(dash?.regions ?? {}).reverse().map((r) => ({
                  value: Math.round((dash?.regions[r]?.volume ?? 0) / 10000),
                  itemStyle: { color: REGION_COLORS[r] || '#999' },
                })),
              }],
            }}
          />
        </Col>
      </Row>
    </div>
  );
}
