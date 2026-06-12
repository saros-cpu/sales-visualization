import { useState, useMemo } from 'react';
import { Row, Col, Card, Statistic, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getResourcesYearly } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { formatRetailTons, numericMetric as numeric, retailTonsOf } from '@/utils/retailMetrics';
import { sortRankingRows } from '@/utils/rankingCharts';
import { CHART_PALETTE, CHART_AXIS } from '@/theme/charts';

// 与 Web 端 ResourcePage 保持一致的口径
const RESOURCE_ORDER = [102, 103, 104, 106, 110, 108];
const RESOURCE_ALIASES: Record<number, number> = { 109: 106 };
const RESOURCE_NAMES: Record<number, string> = { 102: 'АИ 80', 103: 'АИ 92', 104: 'АИ 95', 106: 'Д/Т', 108: 'СПБТ', 110: 'ДТ -35' };
const RESOURCE_COLORS: Record<number, string> = { 102: '#00b96b', 103: '#1677ff', 104: '#722ed1', 106: '#fa8c16', 108: '#f5222d', 110: '#fa541c' };

function normalizeResources(rows: any[]): any[] {
  const buckets = new Map<number, any>();
  (rows || []).forEach((row) => {
    const rawKey = Number(row.resourceKey ?? row.key ?? 0);
    const key = RESOURCE_ALIASES[rawKey] || rawKey;
    if (!RESOURCE_NAMES[key]) return; // 丢弃未知/“其他”油品
    const cur = buckets.get(key) || {
      resourceKey: key, key, name: RESOURCE_NAMES[key], volume: 0, amount: 0, color: RESOURCE_COLORS[key],
      yoyVolumeParts: [] as number[], yoySalesParts: [] as number[], momVolumeParts: [] as number[], momSalesParts: [] as number[],
      latestMonthVolume: 0, latestMonthAmount: 0, mass: 0, tons: 0, latestMonthMass: 0, latestMonthTons: 0,
    };
    const rowTons = retailTonsOf(row);
    const rowMass = numeric(row.mass ?? row.latestMonthMass) || rowTons * 1000;
    const latestTons = numeric(row.latestMonthTons) || (numeric(row.latestMonthMass) > 0 ? numeric(row.latestMonthMass) / 1000 : 0);
    cur.volume += Number(row.volume || 0);
    cur.amount += Number(row.amount || 0);
    cur.mass += rowMass;
    cur.tons += rowTons || rowMass / 1000;
    cur.latestMonthVolume += Number(row.latestMonthVolume || 0);
    cur.latestMonthAmount += Number(row.latestMonthAmount || 0);
    cur.latestMonthMass += numeric(row.latestMonthMass);
    cur.latestMonthTons += latestTons;
    (['yoyVolume', 'yoySales', 'momVolume', 'momSales'] as const).forEach((f) => {
      if (row[f] != null) cur[f + 'Parts'].push(Number(row[f]));
    });
    buckets.set(key, cur);
  });
  return RESOURCE_ORDER.filter((k) => buckets.has(k)).map((k) => {
    const item = buckets.get(k);
    (['yoyVolume', 'yoySales', 'momVolume', 'momSales'] as const).forEach((f) => {
      const parts: number[] = item[f + 'Parts'];
      item[f] = parts.length ? Number((parts.reduce((s, v) => s + v, 0) / parts.length).toFixed(2)) : null;
      delete item[f + 'Parts'];
    });
    item.volume = Number(item.volume.toFixed(2));
    item.amount = Number(item.amount.toFixed(2));
    item.mass = Number(item.mass.toFixed(3));
    item.tons = Number(item.tons.toFixed(3));
    item.latestMonthMass = Number(item.latestMonthMass.toFixed(3));
    item.latestMonthTons = Number(item.latestMonthTons.toFixed(3));
    return item;
  });
}

export default function Resource() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const year = parseInt(ym.split('-')[0]);
  const month = ym.includes('-') ? parseInt(ym.split('-')[1]) : undefined;

  const resQ = useApiQuery(['retail', 'resources', `${year}${month ? '-' + String(month).padStart(2, '0') : ''}`], () => getResourcesYearly(year, month));
  const data = resQ.data;

  const resources = useMemo(() => normalizeResources((data as any)?.resources ?? []), [data]);
  const rankedResources = useMemo(() => sortRankingRows(resources, (row: any) => row.volume), [resources]);
  const totalAmount = useMemo(() => resources.reduce((s, r) => s + (r.amount || 0), 0), [resources]);
  const totalVolume = useMemo(() => resources.reduce((s, r) => s + (r.volume || 0), 0), [resources]);
  const totalTons = numeric((data as any)?.summary?.totalTons) || resources.reduce((s, r) => s + retailTonsOf(r), 0);

  const columns = [
    { title: t('retail.product'), dataIndex: 'name', key: 'name', render: (v: string, r: any) => (
      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.color, marginRight: 6 }} />{v}</span>
    ) },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', render: (v: number) => `${Math.round(v).toLocaleString()} L` },
    { title: t('retail.totalTons'), dataIndex: 'tons', key: 'tons', align: 'right' as const, render: (_: number, r: any) => `${formatRetailTons(retailTonsOf(r))} t` },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('common.yoy'), dataIndex: 'yoySales', key: 'yoySales', render: (v: number) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '--' },
    { title: t('common.mom'), dataIndex: 'momSales', key: 'momSales', render: (v: number) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '--' },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      </Space>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/report')}><Statistic title={t('retail.totalSales')} value={Math.round(totalAmount / 10000)} suffix={CHART_AXIS.wanSom} /></Card></Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/monthly')}>
            <Statistic title={t('retail.totalLiters')} value={Math.round(totalVolume).toLocaleString()} suffix="L" />
            <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{t('retail.totalTons')} {formatRetailTons(totalTons)} t</div>
          </Card>
        </Col>
        <Col xs={24} sm={8}><Card size="small" className="kpi-card-clickable" onClick={() => navigate('/retail/overview')}><Statistic title={t('retail.resource')} value={resources.length} suffix={t('common.type')} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productStruct')} loading={resQ.isLoading}
              option={{
                color: CHART_PALETTE,
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                grid: { left: 80, right: 40 },
                xAxis: { type: 'value', name: CHART_AXIS.liters },
                yAxis: { type: 'category', inverse: true, data: rankedResources.map((r) => r.name), axisLabel: { fontSize: 11 } },
                series: [{ name: t('retail.volume'), type: 'bar', barMaxWidth: 18, data: rankedResources.map((r) => ({ value: Math.round(r.volume), itemStyle: { color: r.color } })) }],
              }}
          />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productRank')} loading={resQ.isLoading}
              option={{
                tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: any) => `${Number(v || 0).toFixed(2)}%` },
                legend: { data: [t('common.yoy'), t('common.mom')], bottom: 0 },
                grid: { left: 50, right: 20, top: 20, bottom: 40 },
                xAxis: { type: 'category', data: rankedResources.map((r) => r.name), axisLabel: { fontSize: 11 } },
                yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v}%` } },
                series: [
                  { name: t('common.yoy'), type: 'bar', barMaxWidth: 18, itemStyle: { color: '#1677ff' }, data: rankedResources.map((r) => r.yoySales ?? 0),
                    label: { show: true, position: 'top', formatter: (p: any) => `${Number(p.value || 0).toFixed(1)}%`, fontSize: 10 } },
                  { name: t('common.mom'), type: 'bar', barMaxWidth: 18, itemStyle: { color: '#fa8c16' }, data: rankedResources.map((r) => r.momSales ?? 0),
                    label: { show: true, position: 'top', formatter: (p: any) => `${Number(p.value || 0).toFixed(1)}%`, fontSize: 10 } },
                ],
              }}
          />
        </Col>
      </Row>
      <TableCard
        title={t('retail.productDetail')}
        columns={columns}
        data={resources}
        rowKey="resourceKey"
        loading={resQ.isLoading}
        pagination={false}
      />
    </div>
  );
}
