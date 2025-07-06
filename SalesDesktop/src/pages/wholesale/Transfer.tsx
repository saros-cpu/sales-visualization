import { useState, useMemo } from 'react';
import { Row, Col, Space, Card, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { fetchWholesale } from '@/api/wholesale';
import BarList from '@/components/wholesale/BarList';
import TableCard from '@/components/ui/TableCard';
import PeriodPicker from '@/components/ui/PeriodPicker';

export default function Transfer() {
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);

  const q = useApiQuery(['wholesale', year, month], () => fetchWholesale({ year, month }));
  const ts = q.data?.transferSummary;

  const regions = useMemo(() => {
    if (!ts?.byRegionProduct) return [];
    return [...new Set(ts.byRegionProduct.map((r) => r.region))];
  }, [ts]);

  const [filterRegion, setFilterRegion] = useState<string>('');

  const filtered = useMemo(() => {
    if (!ts?.byRegionProduct) return [];
    if (!filterRegion) return ts.byRegionProduct;
    return ts.byRegionProduct.filter((r) => r.region === filterRegion);
  }, [ts, filterRegion]);

  const regionMergeMap = useMemo(() => {
    const map: Record<number, number> = {};
    let i = 0;
    while (i < filtered.length) {
      const region = filtered[i].region;
      let j = i + 1;
      while (j < filtered.length && filtered[j].region === region) j++;
      map[i] = j - i;
      i = j;
    }
    return map;
  }, [filtered]);

  const detailColumns = [
    { title: t('retail.region'), dataIndex: 'region', key: 'region', onCell: (_: unknown, index?: number) => {
      const span = index !== undefined ? regionMergeMap[index] : undefined;
      return span ? { rowSpan: span } : { rowSpan: 0 };
    } },
    { title: t('wholesale.byProduct'), dataIndex: 'product', key: 'product' },
    { title: t('common.rows'), dataIndex: 'rows', key: 'rows' },
    { title: t('wholesale.tons'), dataIndex: 'tons', key: 'tons', render: (v: number) => `${v.toLocaleString()} т` },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`}
          onChange={(y, m) => { setYear(y); setMonth(m); }} picker="month" />
      </Space>
      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('wholesale.byRegion')} style={{ marginBottom: 16 }}>
            <BarList rows={(ts?.byRegion ?? []).map((r) => ({ name: r.region, tons: r.tons }))} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('wholesale.byProduct')} style={{ marginBottom: 16 }}>
            <BarList rows={(ts?.byProduct ?? []).map((r) => ({ name: r.product, tons: r.tons }))} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Select
            placeholder={t('retail.region')}
            allowClear
            value={filterRegion || undefined}
            onChange={(v) => setFilterRegion(v ?? '')}
            options={regions.map((r) => ({ label: r, value: r }))}
            style={{ width: '100%', marginBottom: 16 }}
          />
          <TableCard
            title={t('wholesale.transferClass')}
            columns={detailColumns}
            data={filtered}
            rowKey={(r: any) => `${r.region}-${r.product}` as any}
          />
        </Col>
      </Row>
    </div>
  );
}
