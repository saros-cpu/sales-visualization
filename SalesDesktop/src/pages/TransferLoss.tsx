import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Select, Row, Col, Statistic, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { getTransferLoss, LossItem } from '@/api/transferLoss';

export default function TransferLoss() {
  const { t } = useTranslation();
  const [data, setData] = useState<LossItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTransferLoss({ year, quarter });
      setData(res.data || []);
    } finally { setLoading(false); }
  }, [year, quarter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalWeighing = data.reduce((s, i) => s + Number(i.system_qty || 0), 0);
  const totalRetailSupply = data.reduce((s, i) => s + Number(i.actual_qty || 0), 0);
  const directRows = data.filter((item) => item.route_code === 'main_to_station').length;
  const routeLabel = (record: LossItem) => record.route_code
    ? t(`transferLoss.routeCodes.${record.route_code}`, { defaultValue: record.route })
    : record.route;
  const routeColor = (record: LossItem) => {
    if (record.route_code === 'main_to_station') return 'blue';
    if (record.route_code === 'depot_to_station') return 'cyan';
    return 'gold';
  };
  const evidenceLabel = (record: LossItem) => record.evidence_code
    ? t(`transferLoss.evidenceCodes.${record.evidence_code}`, {
        defaultValue: record.evidence || '-',
        days: record.evidence_days ?? 0,
        tons: Number(record.evidence_tons || 0).toFixed(3),
      })
    : record.evidence || '-';

  const columns: ColumnsType<LossItem> = [
    { title: t('transferLoss.route'), dataIndex: 'route', key: 'route', width: 180, render: (_: string, r: LossItem) => <Tag color={routeColor(r)}>{routeLabel(r)}</Tag> },
    { title: t('transferLoss.target'), dataIndex: 'station_name', key: 'station_name', width: 160 },
    { title: t('transferLoss.weighingDate'), dataIndex: 'report_date', key: 'report_date', width: 120 },
    { title: t('transferLoss.supplyDate'), dataIndex: 'supply_date', key: 'supply_date', width: 130, render: (v: string) => v || '-' },
    { title: t('transferLoss.weighingTons'), dataIndex: 'system_qty', key: 'system_qty', width: 130, align: 'right', render: (v: number) => Number(v || 0).toFixed(3) },
    { title: t('transferLoss.retailSupplyTons'), dataIndex: 'actual_qty', key: 'actual_qty', width: 130, align: 'right', render: (v: number) => Number(v || 0).toFixed(3) },
    { title: t('transferLoss.diffTons'), dataIndex: 'loss_qty', key: 'loss_qty', width: 110, align: 'right', render: (v: number) => <span style={{ color: v > 0 ? '#ff4d4f' : '#52c41a' }}>{Number(v || 0).toFixed(3)}</span> },
    { title: t('transferLoss.retailSupplyLiters'), dataIndex: 'retail_liters', key: 'retail_liters', width: 130, align: 'right', render: (v: number) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) },
    { title: t('transferLoss.evidence'), dataIndex: 'evidence', key: 'evidence', width: 320, render: (_: string, record: LossItem) => evidenceLabel(record) },
  ];

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col>
          <Select value={year} onChange={setYear} style={{ width: 100 }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <Select.Option key={y} value={y}>{y}</Select.Option>
            ))}
          </Select>
        </Col>
        <Col>
          <Select value={quarter} onChange={setQuarter} style={{ width: 100 }}>
            {[1, 2, 3, 4].map((q) => (
              <Select.Option key={q} value={q}>Q{q}</Select.Option>
            ))}
          </Select>
        </Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.reviewRows')} value={data.length} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.weighingTons')} value={totalWeighing.toFixed(3)} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.retailSupplyTons')} value={totalRetailSupply.toFixed(3)} suffix={t('transferLoss.directRows', { count: directRows })} /></Card></Col>
      </Row>
      <Table dataSource={data} columns={columns} rowKey={(r) => `${r.route_code || r.route}-${r.station_name}-${r.report_date}-${r.supply_date || ''}`} loading={loading} size="small" pagination={false} scroll={{ x: 1320, y: 'calc(100vh - 360px)' }} />
    </div>
  );
}
