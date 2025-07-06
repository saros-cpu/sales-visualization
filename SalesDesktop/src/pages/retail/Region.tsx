import { useState, useMemo, useEffect } from 'react';
import { Row, Col, Tabs, Card, Statistic } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getRegions, getStations, getDaily } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';

const REGION_ORDER = ['CTY-31', 'chu', 'CTY-30', 'CTY-29', 'CTY-33', 'CTY-35'];
const REGION_COLORS: Record<string, string> = {
  CTY-30: '#ef5350', chu: '#00e5a0', CTY-29: '#a78bfa',
  CTY-33: '#ffa726', CTY-31: '#00d4ff', CTY-35: '#66bb6a',
};

export default function Region() {
  const { t } = useTranslation();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const regQ = useApiQuery(['retail', 'regions', ym], () => getRegions(ym));
  const staQ = useApiQuery(['retail', 'stations', ym], () => getStations(ym));

  const data = regQ.data;
  const stations = (staQ.data as any)?.stations ?? [];

  const regionKeys = useMemo(() => {
    if (!data?.regions) return [];
    return REGION_ORDER.filter((k) => data.regions[k]);
  }, [data]);

  const [activeRegion, setActiveRegion] = useState('');

  useEffect(() => {
    if (regionKeys.length > 0 && !activeRegion) {
      setActiveRegion(regionKeys[0]);
    }
  }, [regionKeys]);

  const region = activeRegion && data?.regions ? data.regions[activeRegion] : null;
  const regionStations = region
    ? stations.filter((s: any) => s.region === activeRegion).sort((a: any, b: any) => b.amount - a.amount)
    : [];

  return (
    <div>
      <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      <Tabs
        activeKey={activeRegion || (regionKeys[0] ?? '')}
        onChange={setActiveRegion}
        items={regionKeys.map((k) => ({ key: k, label: t(`retail.${k}`) }))}
        style={{ marginTop: 16 }}
      />
      {region && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalSales')} value={Math.round(region.amount / 10000)} suffix={t('common.wan')} /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalLiters')} value={Math.round(region.volume)} suffix="L" /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.activeShops')} value={`${region.activeCount}/${region.stationCount}`} /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.cardRatio')} value={region.amount > 0 ? `${Math.round((region.card / region.amount) * 100)}%` : '-'} /></Card></Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.topStations')} loading={staQ.isLoading}
                option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 120, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value' },
                  yAxis: { type: 'category', data: regionStations.map((s: any) => s.name).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: regionStations.map((s: any) => Math.round(s.amount / 10000)).reverse() }],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.paymentDist')} loading={false}
                option={{
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  series: [{ type: 'pie', radius: ['40%', '70%'], data: [
                    { name: t('retail.cash'), value: region.cash, itemStyle: { color: '#ffa726' } },
                    { name: t('retail.card'), value: region.card, itemStyle: { color: '#a78bfa' } },
                  ]}],
                }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.productStruct')} loading={regQ.isLoading}
                option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20, top: 10, bottom: 30 },
                  xAxis: { type: 'value' },
                  yAxis: { type: 'category', data: (data?.byResourceByRegion?.[activeRegion] ?? data?.byResource ?? []).map((r: any) => r.name).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: (data?.byResourceByRegion?.[activeRegion] ?? data?.byResource ?? []).map((r: any) => r.volume).reverse() }],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.payCompare')} loading={false}
                option={{
                  tooltip: { trigger: 'axis' },
                  grid: { left: 120, right: 20, top: 10, bottom: 40 },
                  xAxis: { type: 'category', data: regionStations.slice(0, 8).map((s: any) => s.name).reverse(), axisLabel: { fontSize: 10 } },
                  yAxis: { type: 'value' },
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
