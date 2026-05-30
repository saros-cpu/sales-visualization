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
import { formatRetailTons, retailTonsOf } from '@/utils/retailMetrics';
import { sortRankingRows } from '@/utils/rankingCharts';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';
import { useAuth } from '@/contexts/AuthContext';

const { Text } = Typography;

function defaultRetailMonth() {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
}

export default function Monthly() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { region, station, product, isRu } = useNameI18n();
  const [ym, setYm] = useState(defaultRetailMonth);

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
  const inventoryLiters = Math.round(Number(s?.inventory ?? 0));
  const totalTons = retailTonsOf(s);

  const mom = data?.comparison?.mom as any;
  const yoy = data?.comparison?.yoy as any;
  // 后端 calc_change 已返回百分比变化值（如 5.2 表示 +5.2%），直接使用
  const momSales = mom?.sales ?? undefined;
  const momVolume = mom?.volume ?? undefined;
  const yoySales = yoy?.sales ?? undefined;
  const yoyVolume = yoy?.volume ?? undefined;

  const topStations = useMemo(() => {
    if (!data?.stations) return [];
    return sortRankingRows(data.stations, (row: any) => row.amount, 10);
  }, [data]);

  const productRows = useMemo(
    () => sortRankingRows(data?.byResource ?? [], (row: any) => row.volume),
    [data],
  );

  const topColumns = [
    { title: '#', dataIndex: 'rank', key: 'rank', width: 40, render: (_: any, __: any, i: number) => i + 1 },
    { title: t('retail.station'), dataIndex: 'name', key: 'name', width: 180, render: (_: any, r: any) => station(r) },
    { title: t('retail.region'), dataIndex: 'region', key: 'region', width: 120, render: (v: string) => region(v) },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', width: 110, align: 'right' as const, render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', width: 130, align: 'right' as const, render: (v: number) => `${Math.round(v).toLocaleString()}L` },
    { title: t('retail.totalTons'), dataIndex: 'tons', key: 'tons', width: 110, align: 'right' as const, render: (_: number, r: any) => `${formatRetailTons(retailTonsOf(r))} t` },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
        {canExport && <Button type="primary" onClick={onReport}>{t('retail.generateReport')}</Button>}
      </Space>
      {s && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} md={8} xl={4}><Card size="small"><Statistic title={t('retail.monthlySales')} value={Math.round(s.totalSales / 10000)} suffix={t('common.wan')} /></Card></Col>
            <Col xs={24} sm={12} md={8} xl={4}>
              <Card size="small">
                <Statistic title={t('retail.totalLiters')} value={Math.round(s.totalLiters)} suffix="L" />
                <Text type="secondary" style={{ fontSize: 12 }}>{t('retail.totalTons')} {formatRetailTons(totalTons)} t</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8} xl={4}><Card size="small"><Statistic title={t('retail.activeShops')} value={`${s.activeShops}/${s.totalShops}`} /></Card></Col>
            <Col xs={24} sm={12} md={8} xl={4}><Card size="small"><Statistic title={t('retail.cardRatio')} value={s.totalSales > 0 ? `${Math.round((s.cardSales / s.totalSales) * 100)}%` : '-'} /></Card></Col>
            <Col xs={24} sm={12} md={8} xl={4}><Card size="small"><Statistic title={t('retail.avgDaily')} value={data?.daily?.length ? Math.round(s.totalLiters / data.daily.length) : 0} suffix="L" /></Card></Col>
            <Col xs={24} sm={12} md={8} xl={4}><Card size="small"><Statistic title={t('retail.inventory')} value={inventoryLiters} suffix="L" /></Card></Col>
          </Row>
          <Row gutter={[16, 16]}>
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
                  xAxis: { type: 'category', data: (data?.daily ?? []).map((d: any) => d.date.slice(8)) },
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
                  yAxis: { type: 'category', inverse: true, data: productRows.map((r: any) => product(r.name)), axisLabel: { fontSize: 11 } },
                  series: [{ type: 'bar', data: productRows.map((r: any) => r.volume) }],
                }}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]} className="monthly-payment-rank-row">
            <Col xs={24} lg={9}>
              <ChartCard title={t('retail.paymentDist')} loading={false}
                height={430}
                className="monthly-balanced-card"
                option={{
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  legend: { bottom: 0, left: 'center' },
                  series: [{
                    type: 'pie', radius: ['40%', '70%'],
                    center: ['50%', '46%'],
                    label: { show: true, formatter: '{b}\n{d}%', fontSize: 12, lineHeight: 16 },
                    labelLine: { length: 12, length2: 10 },
                    data: [
                      { name: t('retail.cash'), value: s.cashSales, itemStyle: { color: '#ffa726' } },
                      { name: t('retail.card'), value: s.cardSales, itemStyle: { color: '#a78bfa' } },
                    ],
                  }],
                }}
              />
            </Col>
            <Col xs={24} lg={15}>
              <TableCard
                title={t('retail.top10Table')}
                columns={topColumns}
                data={topStations}
                rowKey="shopKey"
                loading={monthQ.isLoading}
                pageSize={10}
                pagination={false}
                className="monthly-balanced-card monthly-top10-card"
              />
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            <Card size="small" title={t('retail.insights')}>
              {s ? (() => {
                const daily = (data?.daily ?? []) as any[];
                const daysInData = daily.length || 1;
                const wan = (v: number) => `${(v / 1e4).toFixed(2)}${t('common.wan')}`;
                const fmtPct = (v?: number) => v == null ? '--' : `${v >= 0 ? '↑' : '↓'} ${Math.abs(v).toFixed(2)}%`;
                const cardPct = s.totalSales > 0 ? (s.cardSales / s.totalSales * 100) : 0;
                const inactiveSt = (s.totalShops || 0) - (s.activeShops || 0);

                const regionData: Record<string, any> = (data as any)?.regions || {};
                const regionArr = Object.keys(regionData).sort((a, b) => (regionData[b].amount || 0) - (regionData[a].amount || 0));

                const items: string[] = [];
                if (topStations.length > 0) {
                  const top = topStations[0] as any;
                  items.push('🏆 ' + t('retail.insightTopStation', {
                    name: station(top), short: top.short ?? top.shopKey ?? '', amount: wan(top.amount),
                  }));
                }
                if (regionArr.length > 0) {
                  const topR = regionArr[0];
                  const rPct = s.totalSales > 0 ? (regionData[topR].amount / s.totalSales * 100).toFixed(2) : '0.00';
                  items.push('🔴 ' + t('retail.insightTopRegion', {
                    region: region(topR), amount: wan(regionData[topR].amount), pct: `${rPct}%`,
                  }));
                }
                items.push('💳 ' + t('retail.insightCardPct', {
                  card: `${cardPct.toFixed(2)}%`, cash: `${(100 - cardPct).toFixed(2)}%`,
                }));
                if (inactiveSt > 0) {
                  const zeroStations = (data?.stations ?? []).filter((x: any) => Number(x.amount || 0) === 0).map((x: any) => station(x));
                  items.push('⚠️ ' + t('retail.insightInactive', {
                    count: inactiveSt, names: zeroStations.join(isRu ? ', ' : '、'),
                  }));
                }
                items.push('📊 ' + t('retail.insightDailyAvg', {
                  volume: `${Math.round(s.totalLiters / daysInData).toLocaleString()}L`,
                  amount: `${Math.round(s.totalSales / daysInData).toLocaleString()}`,
                }));
                if (momSales != null) {
                  items.push('📈 ' + t('retail.insightMom', {
                    month: mom?.prevMonth || '', sales: fmtPct(momSales), volume: fmtPct(momVolume),
                  }));
                }
                if (yoySales != null) {
                  items.push('📅 ' + t('retail.insightYoy', {
                    month: yoy?.yoyMonth || '', sales: fmtPct(yoySales), volume: fmtPct(yoyVolume),
                  }));
                }
                return (
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {items.map((it, i) => <Text key={i}>{it}</Text>)}
                  </Space>
                );
              })() : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
