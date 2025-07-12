import { useState, useMemo, useEffect } from 'react';
import { Row, Col, Card, Statistic, Select, Typography, Tag, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getStations, getStationMonthly } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';

const { Text } = Typography;

export default function Station() {
  const { t } = useTranslation();
  const { region, station } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [shopKey, setShopKey] = useState<number | null>(null);

  const staQ = useApiQuery(['retail', 'stations', ym], () => getStations(ym));
  const detailQ = useApiQuery(
    ['retail', 'station', ym, shopKey],
    () => getStationMonthly(ym, shopKey!),
    { enabled: !!shopKey },
  );

  const stations: any[] = (staQ.data as any)?.stations ?? [];

  // 数据加载完成后默认选中第一个站点
  useEffect(() => {
    if (!shopKey && stations.length > 0) {
      setShopKey(stations[0].shopKey);
    }
  }, [stations, shopKey]);
  const detail = detailQ.data;

  const options = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const s of stations) {
      (groups[s.region] = groups[s.region] || []).push(s);
    }
    return Object.entries(groups).map(([regionKey, items]) => ({
      label: region(regionKey),
      options: items.map((s: any) => ({
        label: `${station(s)}${s.status !== 'normal' ? ` [${t('common.closed')}]` : ''}`,
        value: s.shopKey,
      })),
    }));
  }, [stations, t, region, station]);

  return (
    <div>
      <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      <Select
        showSearch placeholder={t('retail.stationSelector')}
        value={shopKey} onChange={setShopKey}
        options={options}
        style={{ width: 300, marginLeft: 16 }}
        allowClear
      />
      {detail && (
        <>
          <Row gutter={16} style={{ marginTop: 16, marginBottom: 16 }}>
            <Col span={24}>
              <Card size="small" title={detail.name}>
                <Text>{t('retail.ruName')}: {(detail as any).short}</Text> | <Text>{t('retail.region')}: {region((detail as any).region)}</Text>
              </Card>
            </Col>
          </Row>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalSales')} value={Math.round((detail.summary.totalSales ?? 0) / 10000)} suffix={t('common.wan')} /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.totalLiters')} value={Math.round(detail.summary.totalLiters ?? 0)} suffix="L" /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.cash')} value={Math.round(detail.summary.cashLiters ?? 0)} suffix="L" /></Card></Col>
            <Col xs={12} lg={3}><Card size="small"><Statistic title={t('retail.card')} value={Math.round(detail.summary.cardLiters ?? 0)} suffix="L" /></Card></Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.trend30')} loading={detailQ.isLoading}
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
                  xAxis: { type: 'category', name: t('common.date'), nameLocation: 'center', nameGap: 30, data: (detail.daily ?? []).map((d: any) => d.date.slice(5)) },
                  yAxis: [
                    { type: 'value', name: 'L' },
                    { type: 'value', name: t('common.wan') },
                  ],
                  series: [
                    { name: t('retail.volume'), type: 'bar', data: (detail.daily ?? []).map((d: any) => d.volume) },
                    { name: t('retail.amount'), type: 'line', yAxisIndex: 1, data: (detail.daily ?? []).map((d: any) => Math.round(d.amount / 10000)) },
                  ],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.payCompare')} loading={detailQ.isLoading}
                option={{
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  series: [{
                    type: 'pie', radius: ['40%', '70%'],
                    data: [
                      { name: `${t('retail.cash')} (L)`, value: detail.summary.cashLiters, itemStyle: { color: '#ffa726' } },
                      { name: `${t('retail.card')} (L)`, value: detail.summary.cardLiters, itemStyle: { color: '#a78bfa' } },
                    ],
                  }],
                }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={8}>
              <ChartCard title={t('retail.productStruct')} loading={detailQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20 },
                  xAxis: { type: 'value', name: CHART_AXIS.liters },
                  yAxis: { type: 'category', data: (detail.byResource ?? []).map((r: any) => r.name).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: (detail.byResource ?? []).map((r: any) => r.volume).reverse() }],
                }}
              />
            </Col>
            <Col xs={24} lg={8}>
              <ChartCard title={t('retail.cardRatio')} loading={detailQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', formatter: (p: any) => {
                    const list = Array.isArray(p) ? p : [p];
                    let html = `<b>${list[0]?.axisValue || ''}</b>`;
                    list.forEach((item: any) => {
                      html += `<br/>${item.marker} ${item.seriesName || t('retail.cardRatio')}: ${item.value}%`;
                    });
                    return html;
                  } },
                  grid: { left: 60, right: 20 },
                  xAxis: { type: 'category', name: t('common.date'), nameLocation: 'center', nameGap: 30, data: (detail.daily ?? []).map((d: any) => d.date.slice(5)) },
                  yAxis: { type: 'value', max: 100, name: CHART_AXIS.percent },
                  series: [{
                    type: 'line', data: (detail.daily ?? []).map((d: any) => {
                      const total = (d.cashSales ?? 0) + (d.cardSales ?? 0);
                      return total > 0 ? Math.round(((d.cardSales ?? 0) / total) * 100) : 0;
                    }),
                    areaStyle: { opacity: 0.3 },
                  }],
                }}
              />
            </Col>
            <Col xs={24} lg={8}>
              <ChartCard title={t('retail.sameRegion')} loading={staQ.isLoading}
                option={{
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 120, right: 20 },
                  xAxis: { type: 'value' },
                  yAxis: { type: 'category', data: [], axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: [] }],
                }}
              />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
