import { useState } from 'react';
import { Row, Col, Space, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getYears, getDashboardYearly, getKpiYearly, getResourcesYearly } from '@/api/retail';
import { downloadYearlyReport } from '@/api/export';
import KpiCard from '@/components/ui/KpiCard';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n, ZH_REGION_KEY } from '@/utils/i18nNames';
import { formatRetailTons, retailTonsOf } from '@/utils/retailMetrics';
import { sortRankingRows } from '@/utils/rankingCharts';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';
import { useAuth } from '@/contexts/AuthContext';

const REGION_COLORS: Record<string, string> = {
  CTY-30: '#722ed1', chu: '#1677ff', CTY-29: '#13c2c2',
  CTY-33: '#ff7a45', CTY-31: '#52c41a', CTY-35: '#eb2f96',
};

export default function Overview() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { region, station, product } = useNameI18n();
  const [year, setYear] = useState(new Date().getFullYear());

  const dashQ = useApiQuery(['retail', 'dashboard', year], () => getDashboardYearly(year));
  const kpiQ = useApiQuery(['retail', 'kpi', year], () => getKpiYearly(year));
  const resQ = useApiQuery(['retail', 'resources', year], () => getResourcesYearly(year));

  const dash = dashQ.data;
  const kpi = kpiQ.data?.summary as Record<string, number> | undefined;
  const activeShopValue = kpi ? `${kpi.activeShops ?? 0}/${kpi.totalShops ?? '-'}` : '0/-';
  const totalTons = retailTonsOf(kpi)
    || retailTonsOf((resQ.data as any)?.summary)
    || (resQ.data?.resources ?? []).reduce((sum: number, row: any) => sum + retailTonsOf(row), 0)
    || (dash?.byResource ?? []).reduce((sum: number, row: any) => sum + retailTonsOf(row), 0);
  const regionSalesRows = sortRankingRows(Object.entries(dash?.regions ?? {}), ([, value]: [string, any]) => value?.amount);
  const regionVolumeRows = sortRankingRows(Object.entries(dash?.regions ?? {}), ([, value]: [string, any]) => value?.volume);
  const productRows = sortRankingRows(resQ.data?.resources ?? [], (row: any) => row.amount);
  const top10 = sortRankingRows(dash?.stations ?? [], (row: any) => row.amount, 10);

  const onGenerate = async () => {
    try {
      await downloadYearlyReport(year);
      message.success(t('common.downloadStarted'));
    } catch {
      message.error(t('common.downloadFailed'));
    }
  };

  const regionOption = dash ? {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const, name: CHART_AXIS.wan },
    yAxis: { type: 'category' as const, inverse: true, data: regionSalesRows.map(([r]) => region(r)), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: regionSalesRows.map(([r, value]: [string, any]) => ({
        value: Math.round((value?.amount ?? 0) / 10000),
        itemStyle: { color: REGION_COLORS[ZH_REGION_KEY[r]] || REGION_COLORS[r] || '#999' },
      })),
    }],
  } : {};

  const productOption = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'value' as const, name: CHART_AXIS.wan },
    yAxis: { type: 'category' as const, inverse: true, data: productRows.map((r: any) => product(r.name)) },
    series: [{ type: 'bar' as const, data: productRows.map((r: any) => r.amount) }],
  };

  const top10Option = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const, name: CHART_AXIS.wan },
    yAxis: { type: 'category' as const, inverse: true, data: top10.map((s) => station(s)), axisLabel: { fontSize: 11 } },
    series: [{ type: 'bar' as const, data: top10.map((s) => Math.round(s.amount / 10000)) }],
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={year} onChange={(y) => setYear(y)} picker="year" />
        {canExport && <Button type="primary" onClick={onGenerate}>{t('retail.generateReport')}</Button>}
      </Space>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.totalSales')} value={kpi?.totalSales ?? 0} precision={0} suffix="сом" />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title={t('retail.totalLiters')}
            value={kpi?.totalLiters ?? 0}
            precision={0}
            suffix="L"
            extra={<span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{t('retail.totalTons')} {formatRetailTons(totalTons)} t</span>}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.activeShops')} value={activeShopValue} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.inventory')} value={kpi?.inventory ?? 0} precision={0} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.regionSales')} loading={dashQ.isLoading} option={regionOption} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productRank')} loading={resQ.isLoading} option={productOption} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.topStations')} loading={dashQ.isLoading} option={top10Option} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.regionSalesRank')} loading={dashQ.isLoading}
            option={{
              color: CHART_PALETTE,
              tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
              grid: { left: 120, right: 20, top: 10, bottom: 30 },
              xAxis: { type: 'value' as const, name: '万L' },
              yAxis: { type: 'category' as const, inverse: true, data: regionVolumeRows.map(([r]) => region(r)), axisLabel: { fontSize: 11 } },
              series: [{
                type: 'bar' as const, data: regionVolumeRows.map(([r, value]: [string, any]) => ({
                  value: Math.round((value?.volume ?? 0) / 10000),
                  itemStyle: { color: REGION_COLORS[ZH_REGION_KEY[r]] || REGION_COLORS[r] || '#999' },
                })),
              }],
            }}
          />
        </Col>
      </Row>
    </div>
  );
}
