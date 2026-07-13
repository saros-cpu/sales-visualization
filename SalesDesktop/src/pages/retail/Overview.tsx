import { Row, Col, Space, Button, message, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getDashboardYearly, getKpiYearly, getResourcesYearly } from '@/api/retail';
import { downloadYearlyReport } from '@/api/export';
import KpiCard from '@/components/ui/KpiCard';
import ChartCard from '@/components/ui/ChartCard';
import { useRetailYears } from '@/hooks/useRetailYears';
import { useNameI18n, ZH_REGION_KEY } from '@/utils/i18nNames';
import {
  formatRetailCnyKpi,
  formatRetailLitersKpi,
  formatRetailSomKpi,
  formatRetailTonsKpi,
  retailCnyAmountOf,
  retailTonsOf,
} from '@/utils/retailMetrics';
import { sortRankingRows } from '@/utils/rankingCharts';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';
import { useAuth } from '@/contexts/AuthContext';

const REGION_COLORS: Record<string, string> = {
  CTY-30: '#722ed1', chu: '#1677ff', CTY-29: '#13c2c2',
  CTY-33: '#ff7a45', CTY-31: '#52c41a', CTY-35: '#eb2f96',
};

export default function Overview() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { region, station, product } = useNameI18n();
  const { year, setYear, yearOptions } = useRetailYears(new Date().getFullYear());

  const dashQ = useApiQuery(['retail', 'dashboard', year], () => getDashboardYearly(year));
  const kpiQ = useApiQuery(['retail', 'kpi', year], () => getKpiYearly(year));
  const resQ = useApiQuery(['retail', 'resources', year], () => getResourcesYearly(year));

  const dash = dashQ.data;
  const kpi = kpiQ.data?.summary as Record<string, number> | undefined;
  const kpiComparison = (kpiQ.data as any)?.comparison || {};
  const activeShopValue = kpi ? `${kpi.activeShops ?? 0}/${kpi.totalShops ?? '-'}` : '0/-';
  const totalTons = retailTonsOf(kpi)
    || retailTonsOf((resQ.data as any)?.summary)
    || (resQ.data?.resources ?? []).reduce((sum: number, row: any) => sum + retailTonsOf(row), 0)
    || (dash?.byResource ?? []).reduce((sum: number, row: any) => sum + retailTonsOf(row), 0);
  const regionSalesRows = sortRankingRows(Object.entries(dash?.regions ?? {}), ([, value]: [string, any]) => value?.amount);
  const regionVolumeRows = sortRankingRows(Object.entries(dash?.regions ?? {}), ([, value]: [string, any]) => value?.volume);
  const productRows = sortRankingRows(resQ.data?.resources ?? [], (row: any) => row.amount);
  const top10 = sortRankingRows(dash?.stations ?? [], (row: any) => row.amount, 10);
  const language = i18n.language;
  const totalSalesCny = retailCnyAmountOf(
    kpi ? { ...kpi, avgCnyKgs: (kpi as any).avgCnyKgs ?? (kpiQ.data as any)?.avgCnyKgs } : null,
  );
  const goRegion = (key: string) => {
    const regionKey = ZH_REGION_KEY[key] || key;
    if (regionKey) navigate(`/retail/region?region=${encodeURIComponent(regionKey)}`);
  };
  const goStation = (params: any) => {
    const item = params?.data || {};
    const query = new URLSearchParams();
    if (item.shopKey) query.set('shopKey', String(item.shopKey));
    if (item.stationName || params?.name) query.set('name', String(item.stationName || params.name));
    if (query.toString()) navigate(`/retail/station?${query.toString()}`);
  };

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
      name: t('retail.amount'),
      type: 'bar' as const, data: regionSalesRows.map(([r, value]: [string, any]) => ({
        value: Math.round((value?.amount ?? 0) / 10000),
        regionKey: ZH_REGION_KEY[r] || r,
        itemStyle: { color: REGION_COLORS[ZH_REGION_KEY[r]] || REGION_COLORS[r] || '#999' },
      })),
    }],
  } : {};

  const productOption = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'value' as const, name: CHART_AXIS.wan },
    yAxis: { type: 'category' as const, inverse: true, data: productRows.map((r: any) => product(r.name)) },
    series: [{ name: t('retail.amount'), type: 'bar' as const, data: productRows.map((r: any) => Math.round((r.amount ?? 0) / 10000)) }],
  };

  const top10Option = {
    color: CHART_PALETTE,
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'value' as const, name: CHART_AXIS.wan },
    yAxis: { type: 'category' as const, inverse: true, data: top10.map((s) => station(s)), axisLabel: { fontSize: 11 } },
    series: [{ name: t('retail.amount'), type: 'bar' as const, data: top10.map((s) => ({
      value: Math.round(s.amount / 10000),
      shopKey: s.shopKey,
      stationName: s.name,
    })) }],
  };

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          value={year}
          onChange={setYear}
          style={{ width: 100 }}
          options={yearOptions.map((item) => ({ value: item, label: `${item}` }))}
        />
        {canExport && <Button type="primary" onClick={onGenerate}>{t('retail.generateReport')}</Button>}
      </Space>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title={t('retail.totalSales')}
            value={formatRetailSomKpi(kpi?.totalSales ?? 0, language)}
            compare={[
              { value: kpiComparison.momSales ?? kpiComparison.momSalesAmount, label: t('common.mom') },
              { value: kpiComparison.yoySales ?? kpiComparison.yoySalesAmount, label: t('common.yoy') },
            ]}
            extra={<span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>人民币 {formatRetailCnyKpi(totalSalesCny, language)}</span>}
            onClick={() => navigate('/retail/report')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title={t('retail.totalLiters')}
            value={formatRetailLitersKpi(kpi?.totalLiters ?? 0, language)}
            compare={[
              { value: kpiComparison.momVolume, label: t('common.mom') },
              { value: kpiComparison.yoyVolume, label: t('common.yoy') },
            ]}
            extra={<span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{t('retail.totalTons')} {formatRetailTonsKpi(totalTons, language)}</span>}
            onClick={() => navigate('/retail/resource')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.activeShops')} value={activeShopValue} onClick={() => navigate('/retail/station')} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard title={t('retail.inventory')} value={kpi?.inventory ?? 0} precision={0} onClick={() => navigate('/retail/resource')} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ChartCard
            title={t('retail.regionSales')}
            loading={dashQ.isLoading}
            option={regionOption}
            onEvents={{ click: (params: any) => goRegion(params?.data?.regionKey || params?.name || '') }}
          />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productRank')} loading={resQ.isLoading} option={productOption} onEvents={{ click: () => navigate('/retail/resource') }} />
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.topStations')} loading={dashQ.isLoading} option={top10Option} onEvents={{ click: goStation }} />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.regionSalesRank')} loading={dashQ.isLoading}
            onEvents={{ click: (params: any) => goRegion(params?.data?.regionKey || params?.name || '') }}
            option={{
              color: CHART_PALETTE,
              tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
              grid: { left: 120, right: 20, top: 10, bottom: 30 },
              xAxis: { type: 'value' as const, name: CHART_AXIS.wanLiters },
              yAxis: { type: 'category' as const, inverse: true, data: regionVolumeRows.map(([r]) => region(r)), axisLabel: { fontSize: 11 } },
              series: [{
                name: t('retail.volume'),
                type: 'bar' as const, data: regionVolumeRows.map(([r, value]: [string, any]) => ({
                  value: Math.round((value?.volume ?? 0) / 10000),
                  regionKey: ZH_REGION_KEY[r] || r,
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
