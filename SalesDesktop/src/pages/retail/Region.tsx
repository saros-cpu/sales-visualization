import { useState, useMemo, useEffect } from 'react';
import { Row, Col, Tabs, Card, Statistic } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getRegions, getStations, getDaily } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import KpiCard from '@/components/ui/KpiCard';
import { useNameI18n, EN_REGION_KEY, ZH_REGION_KEY } from '@/utils/i18nNames';
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
import { defaultRetailMonth } from '@/utils/retailPeriod';

const REGION_ORDER = ['CTY-31', 'chu', 'CTY-30', 'CTY-29', 'CTY-33', 'CTY-35'];
const REGION_COLORS: Record<string, string> = {
  CTY-30: '#ef5350', chu: '#00e5a0', CTY-29: '#a78bfa',
  CTY-33: '#ffa726', CTY-31: '#00d4ff', CTY-35: '#66bb6a',
};

function normalizeRegionKey(value?: string | null) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (REGION_ORDER.includes(raw)) return raw;
  if (ZH_REGION_KEY[raw]) return ZH_REGION_KEY[raw];
  const lower = raw.toLowerCase();
  return REGION_ORDER.find((key) => key.toLowerCase() === lower || (EN_REGION_KEY[key] || '').toLowerCase() === lower) || raw;
}

function numeric(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

export default function Region() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { region, station, product } = useNameI18n();
  const [ym, setYm] = useState(defaultRetailMonth);

  const regQ = useApiQuery(['retail', 'regions', ym], () => getRegions(ym));
  const staQ = useApiQuery(['retail', 'stations', ym], () => getStations(ym));
  const dailyQ = useApiQuery(['retail', 'daily', ym], () => getDaily(ym));

  const data = regQ.data;
  const stations = (staQ.data as any)?.stations ?? [];

  const regionKeys = useMemo(() => {
    if (!data?.regions) return [];
    // API 返回中文区域名，需要转成英文 key 匹配 REGION_ORDER
    const available = Object.keys(data.regions).map((zh) => ZH_REGION_KEY[zh] || zh);
    return REGION_ORDER.filter((k) => available.includes(k));
  }, [data]);

  const [activeRegion, setActiveRegion] = useState('');
  const requestedRegion = normalizeRegionKey(searchParams.get('region'));

  useEffect(() => {
    if (regionKeys.length === 0) return;
    if (requestedRegion && regionKeys.includes(requestedRegion)) {
      if (activeRegion !== requestedRegion) setActiveRegion(requestedRegion);
      return;
    }
    if (!activeRegion || !regionKeys.includes(activeRegion)) {
      setActiveRegion(regionKeys[0]);
    }
  }, [activeRegion, regionKeys, requestedRegion]);

  const regionData = activeRegion && data?.regions ? data.regions[EN_REGION_KEY[activeRegion] ?? activeRegion] : null;
  const stationInRegion = (s: any) => (ZH_REGION_KEY[s.region] || s.region) === activeRegion;

  const regionStations = regionData
    ? sortRankingRows(stations.filter(stationInRegion), (row: any) => row.amount)
    : [];
  const productRows = sortRankingRows(
    data?.byResourceByRegion?.[EN_REGION_KEY[activeRegion] || activeRegion] ?? data?.byResource ?? [],
    (row: any) => row.volume,
  );
  const topPaymentStations = regionStations.slice(0, 8);
  const language = i18n.language;
  const regionSalesCny = retailCnyAmountOf(
    regionData ? { ...(regionData as any), avgCnyKgs: (regionData as any).avgCnyKgs ?? (data as any)?.avgCnyKgs } : null,
  );
  const regionMomSales = (regionData as any)?.momSales;
  const regionYoySales = (regionData as any)?.yoySales;
  const regionMomVolume = (regionData as any)?.momVolume;
  const regionYoyVolume = (regionData as any)?.yoyVolume;

  // 当月日销趋势：按区域内站点聚合每日 volume/amount
  const regionDaily = useMemo(() => {
    const dd = dailyQ.data as any;
    if (!dd || !activeRegion) return [];
    const shopKeys = stations.filter(stationInRegion).map((s: any) => String(s.shopKey));
    const dayMap: Record<string, { date: string; volume: number; amount: number }> = {};
    for (const d of dd.daily ?? []) dayMap[d.date] = { date: d.date, volume: 0, amount: 0 };
    for (const sk of shopKeys) {
      const sDaily = dd.stations?.[sk] ?? [];
      for (const d of sDaily) {
        if (!dayMap[d.date]) dayMap[d.date] = { date: d.date, volume: 0, amount: 0 };
        dayMap[d.date].volume += numeric(d.volume);
        dayMap[d.date].amount += numeric(d.amount);
      }
    }
    return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyQ.data, activeRegion, stations]);

  return (
    <div>
      <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      <Tabs
        activeKey={activeRegion || (regionKeys[0] ?? '')}
        onChange={(key) => {
          setActiveRegion(key);
          navigate(`/retail/region?region=${encodeURIComponent(key)}`, { replace: true });
        }}
        items={regionKeys.map((k) => ({ key: k, label: region(k) }))}
        style={{ marginTop: 16 }}
      />
      {regionData && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={6}>
              <KpiCard
                title={t('retail.totalSales')}
                value={formatRetailSomKpi(regionData.amount, language)}
                compare={[
                  { value: regionMomSales, label: t('common.mom') },
                  { value: regionYoySales, label: t('common.yoy') },
                ]}
                extra={<span>人民币 {formatRetailCnyKpi(regionSalesCny, language)}</span>}
                onClick={() => navigate('/retail/report')}
              />
            </Col>
            <Col xs={12} lg={6}>
              <KpiCard
                title={t('retail.totalLiters')}
                value={formatRetailLitersKpi(regionData.volume, language)}
                compare={[
                  { value: regionMomVolume, label: t('common.mom') },
                  { value: regionYoyVolume, label: t('common.yoy') },
                ]}
                extra={<span>{t('retail.totalTons')} {formatRetailTonsKpi(retailTonsOf(regionData), language)}</span>}
                onClick={() => navigate('/retail/resource')}
              />
            </Col>
            <Col xs={12} lg={6}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/station')}><Statistic title={t('retail.activeShops')} value={`${regionData.activeCount}/${regionData.stationCount}`} /></Card></Col>
            <Col xs={12} lg={6}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/station')}><Statistic title={t('retail.cardRatio')} value={regionData.amount > 0 ? `${Math.round((regionData.card / regionData.amount) * 100)}%` : '-'} /></Card></Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={24}>
              <ChartCard title={t('retail.dailyTrend')} loading={dailyQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', formatter: (p: any) => {
                    const list = Array.isArray(p) ? p : [p];
                    let html = `<b>${list[0]?.axisValue || ''}</b>`;
                    list.forEach((item: any) => {
                      const val = item.seriesName === t('retail.volume') ? `${item.value.toLocaleString()}升` : `${item.value}万索姆`;
                      html += `<br/>${item.marker} ${item.seriesName}: ${val}`;
                    });
                    return html;
                  } },
                  legend: { data: [t('retail.volume'), t('retail.amount')], bottom: 0 },
                  xAxis: { type: 'category', data: regionDaily.map((d) => d.date.slice(5)) },
                  yAxis: [
                    { type: 'value', name: CHART_AXIS.liters },
                    { type: 'value', name: CHART_AXIS.wanSom },
                  ],
                  series: [
                    { name: t('retail.volume'), type: 'bar', data: regionDaily.map((d) => Math.round(d.volume)) },
                    { name: t('retail.amount'), type: 'line', yAxisIndex: 1, data: regionDaily.map((d) => Math.round(d.amount / 10000)) },
                  ],
                }}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.topStations')} loading={staQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 120, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value', name: CHART_AXIS.wan },
                  yAxis: { type: 'category', inverse: true, data: regionStations.map((s: any) => station(s)), axisLabel: { fontSize: 11 } },
                  series: [{ name: t('retail.amount'), type: 'bar', data: regionStations.map((s: any) => ({
                    value: Math.round(s.amount / 10000),
                    shopKey: s.shopKey,
                    stationName: s.name,
                  })) }],
                }}
                onEvents={{ click: (params: any) => {
                  const item = params?.data || {};
                  const query = new URLSearchParams();
                  if (item.shopKey) query.set('shopKey', String(item.shopKey));
                  if (item.stationName || params?.name) query.set('name', String(item.stationName || params.name));
                  query.set('from', 'region');
                  query.set('region', activeRegion);
                  navigate(`/retail/station?${query.toString()}`);
                } }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.paymentDist')} loading={false}
                option={{
                  tooltip: { trigger: 'item', formatter: (p: any) => {
                    const value = Number(p?.value || 0).toLocaleString();
                    const percent = p?.percent == null ? '-' : `${p.percent}%`;
                    return `${p?.marker || ''}${p?.name || ''}: ${value}索姆 (${percent})`;
                  } },
                  series: [{ type: 'pie', radius: ['40%', '70%'], data: [
                    { name: t('retail.cash'), value: regionData.cash, itemStyle: { color: '#ffa726' } },
                    { name: t('retail.card'), value: regionData.card, itemStyle: { color: '#a78bfa' } },
                  ]}],
                }}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.productStruct')} loading={regQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value', name: CHART_AXIS.liters },
                  yAxis: { type: 'category', inverse: true, data: productRows.map((r: any) => product(r.name)), axisLabel: { fontSize: 11 } },
                  series: [{ name: t('retail.volume'), type: 'bar', data: productRows.map((r: any) => r.volume) }],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.payCompare')} loading={false}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis' },
                  grid: { left: 120, right: 20, top: 10, bottom: 40 },
                  xAxis: { type: 'category', data: topPaymentStations.map((s: any) => station(s)), axisLabel: { fontSize: 10 } },
                  yAxis: { type: 'value', name: CHART_AXIS.wan },
                  legend: { data: [t('retail.cash'), t('retail.card')], bottom: 0 },
                  series: [
                    { name: t('retail.cash'), type: 'bar', data: topPaymentStations.map((s: any) => Math.round(s.cash / 10000)), itemStyle: { color: '#ffa726' } },
                    { name: t('retail.card'), type: 'bar', data: topPaymentStations.map((s: any) => Math.round(s.card / 10000)), itemStyle: { color: '#a78bfa' } },
                  ],
                }}
              />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
