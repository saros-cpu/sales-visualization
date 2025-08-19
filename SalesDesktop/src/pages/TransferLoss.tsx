import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Select, Row, Col, Statistic, Spin } from 'antd';
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

  const totalLoss = data.reduce((s, i) => s + i.loss_qty, 0);
  const avgRate = data.length > 0 ? data.reduce((s, i) => s + i.loss_rate, 0) / data.length : 0;

  const columns = [
    { title: t('transferLoss.station'), dataIndex: 'station_name', key: 'station_name' },
    { title: t('transferLoss.systemQty'), dataIndex: 'system_qty', key: 'system_qty', render: (v: number) => v?.toFixed(2) },
    { title: t('transferLoss.actualQty'), dataIndex: 'actual_qty', key: 'actual_qty', render: (v: number) => v?.toFixed(2) },
    { title: t('transferLoss.lossQty'), dataIndex: 'loss_qty', key: 'loss_qty', render: (v: number) => <span style={{ color: v > 0 ? '#ff4d4f' : '#52c41a' }}>{v?.toFixed(2)}</span> },
    { title: t('transferLoss.lossRate'), dataIndex: 'loss_rate', key: 'loss_rate', render: (v: number) => `${(v * 100)?.toFixed(2)}%` },
    { title: t('transferLoss.reportDate'), dataIndex: 'report_date', key: 'report_date' },
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
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.stationCount')} value={data.length} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.totalLoss')} value={totalLoss.toFixed(2)} /></Card></Col>
        <Col xs={24} sm={8}><Card size="small"><Statistic title={t('transferLoss.avgLossRate')} value={`${(avgRate * 100).toFixed(2)}%`} /></Card></Col>
      </Row>
      <Card title={t('nav.transferLoss')}>
        <Table dataSource={data} columns={columns} rowKey={(r) => `${r.station_name}-${r.report_date}`} loading={loading} size="small" pagination={false} scroll={{ x: 900, y: 'calc(100vh - 360px)' }} />
      </Card>
    </div>
  );
}
