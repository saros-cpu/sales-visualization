import { useState, useMemo, useEffect } from 'react';
import { Row, Col, Tabs, Card, Statistic } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getRegions, getStations, getDaily } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n, EN_REGION_KEY } from '@/utils/i18nNames';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';

const REGION_ORDER = ['CTY-31', 'chu', 'CTY-30', 'CTY-29', 'CTY-33', 'CTY-35'];
const REGION_COLORS: Record<string, string> = {
  CTY-30: '#ef5350', chu: '#00e5a0', CTY-29: '#a78bfa',
  CTY-33: '#ffa726', CTY-31: '#00d4ff', CTY-35: '#66bb6a',
};

export default function Region() {
  const { t } = useTranslation();
  const { region, station, product } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

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

  useEffect(() => {
    if (regionKeys.length > 0 && !activeRegion) {
      setActiveRegion(regionKeys[0]);
    }
  }, [regionKeys]);

  const regionData = activeRegion && data?.regions ? data.regions[EN_REGION_KEY[activeRegion] ?? activeRegion] : null;
  const regionStations = regionData
    ? stations.filter((s: any) => s.region === activeRegion).sort((a: any, b: any) => b.amount - a.amount)
    : [];

  // 当月日销趋势：按区域内站点聚合每日 volume/amount
  const regionDaily = useMemo(() => {
    const dd = dailyQ.data as any;
    if (!dd?.daily || !activeRegion) return [];
    const shopKeys = stations.filter((s: any) => s.region === activeRegion).map((s: any) => String(s.shopKey));
    const dayMap: Record<string, { date: string; volume: number; amount: number }> = {};
    for (const d of dd.daily) dayMap[d.date] = { date: d.date, volume: 0, amount: 0 };
    for (const sk of shopKeys) {
      const sDaily = dd.stations?.[sk] ?? [];
      for (const d of sDaily) {
        if (dayMap[d.date]) {
          dayMap[d.date].volume += d.volume || 0;
          dayMap[d.date].amount += d.amount || 0;
        }
      }
    }
    return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyQ.data, activeRegion, stations]);

  return (
    <div>
      <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      <Tabs
        activeKey={activeRegion || (regionKeys[0] ?? '')}
        onChange={setActiveRegion}
        items={regionKeys.map((k) => ({ key: k, label: region(k) }))}
        style={{ marginTop: 16 }}
      />
      {regionData && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalSales')} value={Math.round(regionData.amount / 10000)} suffix={t('common.wan')} /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalLiters')} value={Math.round(regionData.volume)} suffix="L" /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.activeShops')} value={`${regionData.activeCount}/${regionData.stationCount}`} /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.cardRatio')} value={regionData.amount > 0 ? `${Math.round((regionData.card / regionData.amount) * 100)}%` : '-'} /></Card></Col>
          </Row>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={24}>
              <ChartCard title={t('retail.dailyTrend')} loading={dailyQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', formatter: (p: any) => {
                    const list = Array.isArray(p) ? p : [p];
                    let html = `<b>${list[0]?.axisValue || ''}</b>`;
                    list.forEach((item: any) => {
                      const val = item.seriesName === t('retail.volume') ? item.value.toLocaleString() + 'L' : item.value + t('common.wan');
                      html += `<br/>${item.marker} ${item.seriesName}: ${val}`;
                    });
                    return html;
                  } },
                  legend: { data: [t('retail.volume'), t('retail.amount')], bottom: 0 },
                  xAxis: { type: 'category', name: t('common.date'), nameLocation: 'center', nameGap: 30, data: regionDaily.map((d) => d.date.slice(5)) },
                  yAxis: [
                    { type: 'value', name: 'L' },
                    { type: 'value', name: t('common.wan') },
                  ],
                  series: [
                    { name: t('retail.volume'), type: 'bar', data: regionDaily.map((d) => Math.round(d.volume)) },
                    { name: t('retail.amount'), type: 'line', yAxisIndex: 1, data: regionDaily.map((d) => Math.round(d.amount / 10000)) },
                  ],
                }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.topStations')} loading={staQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 120, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value', name: CHART_AXIS.wan },
                  yAxis: { type: 'category', data: regionStations.map((s: any) => station(s)).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: regionStations.map((s: any) => Math.round(s.amount / 10000)).reverse() }],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.paymentDist')} loading={false}
                option={{
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  series: [{ type: 'pie', radius: ['40%', '70%'], data: [
                    { name: t('retail.cash'), value: regionData.cash, itemStyle: { color: '#ffa726' } },
                    { name: t('retail.card'), value: regionData.card, itemStyle: { color: '#a78bfa' } },
                  ]}],
                }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.productStruct')} loading={regQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value', name: CHART_AXIS.liters },
                  yAxis: { type: 'category', data: (data?.byResourceByRegion?.[activeRegion] ?? data?.byResource ?? []).map((r: any) => product(r.name)).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: (data?.byResourceByRegion?.[activeRegion] ?? data?.byResource ?? []).map((r: any) => r.volume).reverse() }],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.payCompare')} loading={false}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis' },
                  grid: { left: 120, right: 20, top: 10, bottom: 40 },
                  xAxis: { type: 'category', data: regionStations.slice(0, 8).map((s: any) => station(s)).reverse(), axisLabel: { fontSize: 10 } },
                  yAxis: { type: 'value', name: CHART_AXIS.wan },
                  legend: { data: [t('retail.cash'), t('retail.card')], bottom: 0 },
                  series: [
                    { name: t('retail.cash'), type: 'bar', data: regionStations.slice(0, 8).map((s: any) => Math.round(s.cash / 10000)).reverse(), itemStyle: { color: '#ffa726' } },
                    { name: t('retail.card'), type: 'bar', data: regionStations.slice(0, 8).map((s: any) => Math.round(s.card / 10000)).reverse(), itemStyle: { color: '#a78bfa' } },
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
