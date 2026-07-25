import { useState, useMemo, useEffect } from 'react';
import { Row, Col, Card, Statistic, Select, Typography, Tag, Button, Space, DatePicker, App as AntApp } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { useApiQuery } from '@/hooks/useApi';
import { getStations, getStationMonthly } from '@/api/retail';
import { downloadRetailRangeReport } from '@/api/export';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import KpiCard from '@/components/ui/KpiCard';
import { useNameI18n } from '@/utils/i18nNames';
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
import { defaultRetailMonth } from '@/utils/retailPeriod';

const { Text } = Typography;
const { RangePicker } = DatePicker;

function defaultWeeklyReportRange() {
  const today = dayjs().startOf('day');
  const daysSinceMonday = (today.day() + 6) % 7;
  const thisWeekMonday = today.subtract(daysSinceMonday, 'day');
  const lastWeekMonday = thisWeekMonday.subtract(7, 'day');
  return [lastWeekMonday, lastWeekMonday.add(6, 'day')] as [dayjs.Dayjs, dayjs.Dayjs];
}

function formatYearMonth(year: number, month?: number) {
  return month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`;
}

export default function Station() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message } = AntApp.useApp();
  const { can } = useAuth();
  const canExport = can('retail:export');
  const { region, station } = useNameI18n();
  const requestedMonth = searchParams.get('month') || '';
  const [ym, setYm] = useState(requestedMonth || defaultRetailMonth);
  const [shopKey, setShopKey] = useState<number | null>(null);
  const [weeklyReportRange, setWeeklyReportRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>(defaultWeeklyReportRange);
  const [weeklyReportLoading, setWeeklyReportLoading] = useState(false);
  const queryShopKey = Number(searchParams.get('shopKey'));
  const queryName = searchParams.get('name') || '';

  useEffect(() => {
    if (requestedMonth) {
      setYm((prev) => (prev === requestedMonth ? prev : requestedMonth));
    }
  }, [requestedMonth]);

  const staQ = useApiQuery(['retail', 'stations', ym], () => getStations(ym));
  const detailQ = useApiQuery(
    ['retail', 'station', ym, shopKey],
    () => getStationMonthly(ym, shopKey!),
    { enabled: !!shopKey },
  );

  const stations: any[] = (staQ.data as any)?.stations ?? [];

  useEffect(() => {
    if (stations.length === 0) return;
    const requestedShopKey = Number.isFinite(queryShopKey) && queryShopKey > 0 ? queryShopKey : null;
    const requestedStation = requestedShopKey
      ? stations.find((s: any) => Number(s.shopKey) === requestedShopKey)
      : queryName
        ? stations.find((s: any) => s.name === queryName || s.short === queryName)
        : null;
    if (requestedStation && shopKey !== requestedStation.shopKey) {
      setShopKey(requestedStation.shopKey);
      return;
    }
    if (!shopKey) {
      setShopKey(stations[0].shopKey);
    }
  }, [stations, shopKey, queryShopKey, queryName]);
  const detail = detailQ.data;

  const regionStations = useMemo(() => {
    if (!detail) return [];
    const rgn = (detail as any).region;
    return sortRankingRows(
      stations.filter((s: any) => s.region === rgn && s.status !== 'closed'),
      (row: any) => row.amount,
    );
  }, [stations, detail]);

  const productRows = useMemo(
    () => sortRankingRows(detail?.byResource ?? [], (row: any) => row.volume),
    [detail],
  );

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
  const selectShopKey = (nextShopKey?: number | null) => {
    setShopKey(nextShopKey ?? null);
    const query = new URLSearchParams(searchParams);
    query.set('month', ym);
    if (nextShopKey) {
      const selected = stations.find((s: any) => Number(s.shopKey) === Number(nextShopKey));
      query.set('shopKey', String(nextShopKey));
      if (selected?.name) query.set('name', selected.name);
    } else {
      query.delete('shopKey');
      query.delete('name');
    }
    const suffix = query.toString();
    navigate(`/retail/station${suffix ? `?${suffix}` : ''}`, { replace: true });
  };

  const changeMonth = (year: number, month?: number) => {
    const nextYm = formatYearMonth(year, month);
    setYm(nextYm);
    const query = new URLSearchParams(searchParams);
    query.set('month', nextYm);
    if (shopKey) query.set('shopKey', String(shopKey));
    const selected = stations.find((s: any) => Number(s.shopKey) === Number(shopKey));
    if (selected?.name) query.set('name', selected.name);
    const suffix = query.toString();
    navigate(`/retail/station${suffix ? `?${suffix}` : ''}`, { replace: true });
  };

  const onGenerateWeeklyReport = async () => {
    if (!weeklyReportRange?.[0] || !weeklyReportRange?.[1]) {
      message.warning(t('retail.selectWeeklyReportRange'));
      return;
    }
    const dateFrom = weeklyReportRange[0].format('YYYY-MM-DD');
    const dateTo = weeklyReportRange[1].format('YYYY-MM-DD');
    setWeeklyReportLoading(true);
    try {
      await downloadRetailRangeReport(dateFrom, dateTo);
      message.success(t('common.downloadStarted'));
    } catch (err: any) {
      message.error(`${t('common.downloadFailed')}: ${err?.message || ''}`);
    } finally {
      setWeeklyReportLoading(false);
    }
  };

  const language = i18n.language;
  const detailSummary = detail?.summary as any;
  const stationAmount = Number(detailSummary?.amount ?? detailSummary?.totalSales ?? 0);
  const stationLiters = Number(detailSummary?.volume ?? detailSummary?.totalLiters ?? 0);
  const stationSalesCny = retailCnyAmountOf(
    detailSummary ? { ...detailSummary, amount: stationAmount, avgCnyKgs: detailSummary.avgCnyKgs ?? (detail as any)?.avgCnyKgs } : null,
  );
  const stationMom = (detail as any)?.comparison?.mom || {};
  const stationYoy = (detail as any)?.comparison?.yoy || {};
  const stationMomSales = stationMom.sales ?? stationMom.amount;
  const stationYoySales = stationYoy.sales ?? stationYoy.amount;
  const stationMomVolume = stationMom.volume;
  const stationYoyVolume = stationYoy.volume;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Space wrap>
          <Text type="secondary">{t('common.month')}</Text>
          <PeriodPicker value={ym} onChange={changeMonth} picker="month" />
          <Select
            showSearch placeholder={t('retail.stationSelector')}
            value={shopKey} onChange={selectShopKey}
            options={options}
            style={{ width: 300 }}
            allowClear
          />
        </Space>
        {canExport && (
          <Space wrap style={{ marginLeft: 'auto' }}>
            <Text strong>{t('retail.financeWeeklyReport')}:</Text>
            <RangePicker
              allowClear={false}
              value={weeklyReportRange}
              onChange={(value) => value?.[0] && value?.[1] && setWeeklyReportRange(value as [dayjs.Dayjs, dayjs.Dayjs])}
            />
            <Button type="primary" loading={weeklyReportLoading} onClick={onGenerateWeeklyReport}>
              {t('retail.generateWeeklyReport')}
            </Button>
          </Space>
        )}
      </div>
      {detail && (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={24}>
              <Card size="small" title={station(detail as any)}>
                <Text>{t('retail.ruName')}: {(detail as any).short}</Text> | <Text>{t('retail.region')}: {region((detail as any).region)}</Text>
              </Card>
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={6}>
              <KpiCard
                title={t('retail.totalSales')}
                value={formatRetailSomKpi(stationAmount, language)}
                compare={[
                  { value: stationMomSales, label: t('common.mom') },
                  { value: stationYoySales, label: t('common.yoy') },
                ]}
                extra={<span>人民币 {formatRetailCnyKpi(stationSalesCny, language)}</span>}
                onClick={() => navigate('/retail/report')}
              />
            </Col>
            <Col xs={12} lg={6}>
              <KpiCard
                title={t('retail.totalLiters')}
                value={formatRetailLitersKpi(stationLiters, language)}
                compare={[
                  { value: stationMomVolume, label: t('common.mom') },
                  { value: stationYoyVolume, label: t('common.yoy') },
                ]}
                extra={<span>{t('retail.totalTons')} {formatRetailTonsKpi(retailTonsOf(detail.summary), language)}</span>}
                onClick={() => navigate('/retail/resource')}
              />
            </Col>
            <Col xs={12} lg={6}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/report')}><Statistic title={t('retail.cash')} value={Math.round(detail.summary.cashLiters ?? 0)} suffix="L" /></Card></Col>
            <Col xs={12} lg={6}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/report')}><Statistic title={t('retail.card')} value={Math.round(detail.summary.cardLiters ?? 0)} suffix="L" /></Card></Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <ChartCard title={t('retail.trend30')} loading={detailQ.isLoading}
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
                  xAxis: { type: 'category', data: (detail.daily ?? []).map((d: any) => d.date.slice(5)) },
                  yAxis: [
                    { type: 'value', name: CHART_AXIS.liters },
                    { type: 'value', name: CHART_AXIS.wanSom },
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
                  tooltip: { trigger: 'item', formatter: (p: any) => {
                    const value = Number(p?.value || 0).toLocaleString();
                    const percent = p?.percent == null ? '-' : `${p.percent}%`;
                    return `${p?.marker || ''}${p?.name || ''}: ${value}升 (${percent})`;
                  } },
                  series: [{
                    type: 'pie', radius: ['40%', '70%'],
                    data: [
                      { name: t('retail.cash'), value: detail.summary.cashLiters, itemStyle: { color: '#ffa726' } },
                      { name: t('retail.card'), value: detail.summary.cardLiters, itemStyle: { color: '#a78bfa' } },
                    ],
                  }],
                }}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={8}>
              <ChartCard title={t('retail.productStruct')} loading={detailQ.isLoading}
                option={{
                  color: CHART_PALETTE,
                  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                  grid: { left: 80, right: 20 },
                  xAxis: { type: 'value', name: CHART_AXIS.liters },
                  yAxis: { type: 'category', inverse: true, data: productRows.map((r: any) => r.name), axisLabel: { fontSize: 11 } },
                  series: [{ name: t('retail.volume'), type: 'bar', data: productRows.map((r: any) => r.volume) }],
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
                      const name = /^series\d+$/i.test(String(item.seriesName || '')) ? t('retail.cardRatio') : (item.seriesName || t('retail.cardRatio'));
                      html += `<br/>${item.marker} ${name}: ${item.value}%`;
                    });
                    return html;
                  } },
                  grid: { left: 60, right: 20 },
                  xAxis: { type: 'category', data: (detail.daily ?? []).map((d: any) => d.date.slice(5)) },
                  yAxis: { type: 'value', max: 100, name: CHART_AXIS.percent },
                  series: [{
                    name: t('retail.cardRatio'),
                    type: 'line',
                    data: (detail.daily ?? []).map((d: any) => {
                      const sumAmount = (detail.summary as any).amount || 0;
                      const sumCard = (detail.summary as any).cardSales || 0;
                      const monthRatio = sumAmount > 0 ? sumCard / sumAmount : 0;
                      // 优先使用后端返回的每日现金/刷卡数据，缺失时按月度比例折算兜底
                      const cash = d.cashSales;
                      const card = d.cardSales;
                      if (cash != null && card != null && (cash + card) > 0) {
                        return Math.round((card / (cash + card)) * 100);
                      }
                      return Math.round(monthRatio * 100);
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
                  grid: { left: 120, right: 20, bottom: 58 },
                  xAxis: {
                    type: 'value',
                    name: CHART_AXIS.som,
                    axisLabel: {
                      rotate: 35,
                      margin: 16,
                      formatter: (value: number) => {
                        if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(1)}亿`;
                        if (Math.abs(value) >= 10000) return `${Math.round(value / 10000)}万`;
                        return String(Math.round(value));
                      },
                    },
                  },
                  yAxis: { type: 'category', inverse: true, data: regionStations.map((s: any) => station(s)), axisLabel: { fontSize: 11 } },
                  series: [{ name: t('retail.amount'), type: 'bar', data: regionStations.map((s: any) => ({
                    value: s.amount,
                    shopKey: s.shopKey,
                  })) }],
                }}
                onEvents={{ click: (params: any) => {
                  const nextShopKey = Number(params?.data?.shopKey);
                  if (Number.isFinite(nextShopKey) && nextShopKey > 0) selectShopKey(nextShopKey);
                } }}
              />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}
