import { useState, useMemo } from 'react';
import { Row, Col, Card, Statistic, Typography, Button, Space, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getMonthly } from '@/api/retail';
import { downloadMonthlyReport } from '@/api/export';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useNameI18n } from '@/utils/i18nNames';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';

const { Text } = Typography;

export default function Monthly() {
  const { t } = useTranslation();
  const { region, station, product } = useNameI18n();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const monthQ = useApiQuery(['retail', 'monthly', ym], () => getMonthly(ym));
  const data = monthQ.data;

  const onReport = async () => {
    try {
      await downloadMonthlyReport(ym);
      message.success(t('common.downloadStarted'));
    } catch {
      message.error(t('common.downloadFailed'));
    }
  };

  const s = data?.summary;

  const mom = data?.comparison?.mom;
  const yoy = data?.comparison?.yoy;
  const momSales = mom?.sales != null ? ((mom.sales as number) - 1) * 100 : undefined;
  const momVolume = mom?.volume != null ? ((mom.volume as number) - 1) * 100 : undefined;
  const yoySales = yoy?.sales != null ? ((yoy.sales as number) - 1) * 100 : undefined;
  const yoyVolume = yoy?.volume != null ? ((yoy.volume as number) - 1) * 100 : undefined;

  const topStations = useMemo(() => {
    if (!data?.stations) return [];
    return [...data.stations].sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [data]);

  const topColumns = [
    { title: '#', dataIndex: 'rank', key: 'rank', width: 40, render: (_: any, __: any, i: number) => i + 1 },
    { title: t('retail.station'), dataIndex: 'name', key: 'name', render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', render: (v: string) => region(v) },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', render: (v: number) => `${Math.round(v).toLocaleString()}L` },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
        <Button type="primary" onClick={onReport}>{t('retail.generateReport')}</Button>
      </Space>
      {s && (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.monthlySales')} value={Math.round(s.totalSales / 10000)} suffix={t('common.wan')} /></Card></Col>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.totalLiters')} value={Math.round(s.totalLiters)} suffix="L" /></Card></Col>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.activeShops')} value={`${s.activeShops}/${s.totalShops}`} /></Card></Col>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.cardRatio')} value={s.totalSales > 0 ? `${Math.round((s.cardSales / s.totalSales) * 100)}%` : '-'} /></Card></Col>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.avgDaily')} value={data?.daily?.length ? Math.round(s.totalLiters / data.daily.length) : 0} suffix="L" /></Card></Col>
            <Col xs={12} lg={4}><Card size="small"><Statistic title={t('retail.inventory')} value={Math.round((s as any).inventory ?? 0)} suffix="L" /></Card></Col>
          </Row>
          {data?.comparison && (
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">
                {momSales != null && `环比: ${momSales >= 0 ? '+' : ''}${momSales.toFixed(1)}% (额)`}
                {momVolume != null && ` / ${momVolume >= 0 ? '+' : ''}${momVolume.toFixed(1)}% (量)`}
                {yoySales != null && ` | 同比: ${yoySales >= 0 ? '+' : ''}${yoySales.toFixed(1)}% (额)`}
                {yoyVolume != null && ` / ${yoyVolume >= 0 ? '+' : ''}${yoyVolume.toFixed(1)}% (量)`}
              </Text>
            </div>
          )}
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.dailyTrend')} loading={monthQ.isLoading}
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
                  xAxis: { type: 'category', name: t('common.date'), nameLocation: 'center', nameGap: 30, data: (data?.daily ?? []).map((d: any) => d.date.slice(8)) },
                  yAxis: [
                    { type: 'value', name: 'L' },
                    { type: 'value', name: t('common.wan') },
                  ],
                  series: [
                    { name: t('retail.volume'), type: 'bar', data: (data?.daily ?? []).map((d: any) => d.volume) },
                    { name: t('retail.amount'), type: 'line', yAxisIndex: 1, data: (data?.daily ?? []).map((d: any) => Math.round(d.amount / 10000)) },
                  ],
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.productStruct')} loading={monthQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20 },
                  xAxis: { type: 'value', name: CHART_AXIS.liters },
                  yAxis: { type: 'category', data: (data?.byResource ?? []).map((r: any) => product(r.name)).reverse(), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: (data?.byResource ?? []).map((r: any) => r.volume).reverse() }],
                }}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} lg={8}>
              <ChartCard title={t('retail.paymentDist')} loading={false}
                option={{
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  series: [{
                    type: 'pie', radius: ['40%', '70%'],
                    data: [
                      { name: t('retail.cash'), value: s.cashSales, itemStyle: { color: '#ffa726' } },
                      { name: t('retail.card'), value: s.cardSales, itemStyle: { color: '#a78bfa' } },
                    ],
                  }],
                }}
              />
            </Col>
            <Col xs={24} lg={16}>
              <TableCard
                title={t('retail.top10Table')}
                columns={topColumns}
                data={topStations}
                rowKey="shopKey"
                loading={monthQ.isLoading}
              />
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            <Card size="small" title={t('retail.insights')}>
              {data?.daily?.length ? (() => {
                const daily = data.daily as any[];
                const volumes = daily.map(d => d.volume);
                const maxVol = Math.max(...volumes);
                const minVol = Math.min(...volumes);
                const maxDay = daily.find(d => d.volume === maxVol);
                const minDay = daily.find(d => d.volume === minVol);
                const firstHalf = daily.slice(0, Math.ceil(daily.length / 2)).reduce((s, d) => s + d.volume, 0);
                const secondHalf = daily.slice(Math.ceil(daily.length / 2)).reduce((s, d) => s + d.volume, 0);
                const halfCompVal = firstHalf > 0 ? (secondHalf - firstHalf) / firstHalf * 100 : null;
                return (
                  <ul>
                    <li>{t('retail.totalSales')}: {Math.round(s.totalSales / 10000)}{t('common.wan')}</li>
                    <li>{t('retail.totalLiters')}: {Math.round(s.totalLiters).toLocaleString()}L</li>
                    <li>{t('retail.activeShops')}: {s.activeShops}/{s.totalShops}</li>
                    <li>{t('retail.cardRatio')}: {s.totalSales > 0 ? `${Math.round((s.cardSales / s.totalSales) * 100)}%` : '-'}</li>
                    <li>{t('retail.avgDaily')}: {Math.round(s.totalLiters / daily.length).toLocaleString()}L ({daily.length}{t('common.day')})</li>
                    <li>{t('retail.bestDay')}: {maxDay?.date?.slice(8)} - {Math.round(maxVol).toLocaleString()}L</li>
                    <li>{t('retail.worstDay')}: {minDay?.date?.slice(8)} - {Math.round(minVol).toLocaleString()}L</li>
                    {halfCompVal != null && <li>{t('retail.halfCompare')}: {halfCompVal >= 0 ? '+' : ''}{halfCompVal.toFixed(1)}%</li>}
                    {momSales != null && <li>{t('common.mom')}: {momSales >= 0 ? '+' : ''}{momSales.toFixed(1)}% ({t('retail.amount')})</li>}
                    {momVolume != null && <li>{t('common.mom')}: {momVolume >= 0 ? '+' : ''}{momVolume.toFixed(1)}% ({t('retail.volume')})</li>}
                    {yoySales != null && <li>{t('common.yoy')}: {yoySales >= 0 ? '+' : ''}{yoySales.toFixed(1)}% ({t('retail.amount')})</li>}
                    {yoyVolume != null && <li>{t('common.yoy')}: {yoyVolume >= 0 ? '+' : ''}{yoyVolume.toFixed(1)}% ({t('retail.volume')})</li>}
                  </ul>
                );
              })() : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
