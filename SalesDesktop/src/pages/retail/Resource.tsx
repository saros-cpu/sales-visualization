import { useState } from 'react';
import { Row, Col, Card, Statistic, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getResourcesYearly } from '@/api/retail';
import ChartCard from '@/components/ui/ChartCard';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';

export default function Resource() {
  const { t } = useTranslation();
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}`);
  const year = parseInt(ym.split('-')[0]);
  const month = ym.includes('-') ? parseInt(ym.split('-')[1]) : undefined;

  const resQ = useApiQuery(['retail', 'resources', ym], () => getResourcesYearly(year, month));
  const data = resQ.data;

  const columns = [
    { title: t('retail.product'), dataIndex: 'name', key: 'name' },
    { title: t('retail.volume'), dataIndex: 'volume', key: 'volume', render: (v: number) => Math.round(v).toLocaleString() },
    { title: t('retail.amount'), dataIndex: 'amount', key: 'amount', render: (v: number) => `${Math.round(v / 10000)}${t('common.wan')}` },
    { title: t('common.yoy'), dataIndex: 'yoyAmount', key: 'yoyAmount', render: (v: number) => v != null ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '-' },
    { title: t('common.mom'), dataIndex: 'momAmount', key: 'momAmount', render: (v: number) => v != null ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '-' },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={ym} onChange={(y, m) => setYm(m ? `${y}-${String(m).padStart(2, '0')}` : `${y}`)} picker="month" />
      </Space>
      {data?.summary && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={8} lg={6}><Card size="small"><Statistic title={t('retail.totalSales')} value={Math.round(data.summary.totalAmount / 10000)} suffix={t('common.wan')} /></Card></Col>
          <Col xs={8} lg={6}><Card size="small"><Statistic title={t('retail.totalLiters')} value={Math.round(data.summary.totalVolume).toLocaleString()} suffix="L" /></Card></Col>
          <Col xs={8} lg={6}><Card size="small"><Statistic title={t('retail.resource')} value={data.summary.resourceCount} suffix={t('common.type')} /></Card></Col>
        </Row>
      )}
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productStruct')} loading={resQ.isLoading}
            option={{
              tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
              grid: { left: 80, right: 20 },
              xAxis: { type: 'value' },
              yAxis: { type: 'category', data: (data?.resources ?? []).map((r: any) => r.name).reverse(), axisLabel: { fontSize: 11 } },
              series: [{ type: 'bar', data: (data?.resources ?? []).map((r: any) => r.volume).reverse() }],
            }}
          />
        </Col>
        <Col xs={24} lg={12}>
          <ChartCard title={t('retail.productRank')} loading={resQ.isLoading}
            option={{
              tooltip: { trigger: 'axis' },
              grid: { left: 80, right: 60 },
              xAxis: { type: 'value' },
              yAxis: { type: 'category', data: (data?.resources ?? []).map((r: any) => r.name).reverse(), axisLabel: { fontSize: 11 } },
              legend: { data: [t('common.yoy'), t('common.mom')], bottom: 0 },
              series: [
                { name: t('common.yoy'), type: 'bar', data: (data?.resources ?? []).map((r: any) => (r.yoyAmount ?? 0) * 100).reverse() },
                { name: t('common.mom'), type: 'bar', data: (data?.resources ?? []).map((r: any) => (r.momAmount ?? 0) * 100).reverse() },
              ],
            }}
          />
        </Col>
      </Row>
      <TableCard
        title={t('retail.productDetail')}
        columns={columns}
        data={data?.resources ?? []}
        rowKey="resourceKey"
        loading={resQ.isLoading}
      />
    </div>
  );
}
