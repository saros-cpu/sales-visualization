import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button, Space, Alert, DatePicker, Table, Select, Row, Col, Statistic, Card } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { getRetailTransferStats, RetailTransferRecord, RetailTransferData } from '@/api/retail';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const fmtLiters = (v: number) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtTons = (v: number) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const RESOURCE_OPTIONS = [
  { value: '', label: '全部油品' },
  { value: '102', label: 'АИ 80' },
  { value: '103', label: 'АИ 92' },
  { value: '104', label: 'АИ 95' },
  { value: '106', label: 'Д/Т' },
  { value: '108', label: 'СПБТ' },
  { value: '109', label: 'Д/Т (-15)' },
  { value: '110', label: 'ДТ -35' },
];

const GROUP_OPTIONS = [
  { value: 'detail', label: '明细（日×站×油品）' },
  { value: 'station', label: '按站点' },
  { value: 'resource', label: '按油品' },
  { value: 'month', label: '按月' },
];

export default function Transfer() {
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('year'),
    dayjs(),
  ]);
  const [groupBy, setGroupBy] = useState<string>('detail');
  const [resource, setResource] = useState<string>('');
  const [data, setData] = useState<RetailTransferData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRetailTransferStats({
        start: dates[0].format('YYYY-MM-DD'),
        end: dates[1].format('YYYY-MM-DD'),
        groupBy,
        resource,
      });
      setData(res);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [dates, groupBy, resource]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const total = data?.total || { liters: 0, tons: 0, rows: 0 };
  const stationCount = (data?.summary?.byStation || []).length;
  const records: RetailTransferRecord[] = Array.isArray(data?.records) ? data.records : [];

  const columns = useMemo(() => {
    if (groupBy === 'station') {
      return [
        { title: '加油站', dataIndex: 'shopName', key: 'shopName' },
        { title: '升 (L)', dataIndex: 'liters', key: 'liters', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.liters - b.liters, render: (v: number) => fmtLiters(v) },
        { title: '吨 (t)', dataIndex: 'tons', key: 'tons', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.tons - b.tons, render: (v: number) => fmtTons(v) },
        { title: '笔数', dataIndex: 'rows', key: 'rows', align: 'right' as const, render: (v: number) => v },
      ];
    }
    if (groupBy === 'resource') {
      return [
        { title: '油品', dataIndex: 'resourceLabel', key: 'resourceLabel' },
        { title: '升 (L)', dataIndex: 'liters', key: 'liters', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.liters - b.liters, render: (v: number) => fmtLiters(v) },
        { title: '吨 (t)', dataIndex: 'tons', key: 'tons', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.tons - b.tons, render: (v: number) => fmtTons(v) },
        { title: '笔数', dataIndex: 'rows', key: 'rows', align: 'right' as const, render: (v: number) => v },
      ];
    }
    if (groupBy === 'month') {
      return [
        { title: '月份', dataIndex: 'month', key: 'month' },
        { title: '升 (L)', dataIndex: 'liters', key: 'liters', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.liters - b.liters, render: (v: number) => fmtLiters(v) },
        { title: '吨 (t)', dataIndex: 'tons', key: 'tons', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.tons - b.tons, render: (v: number) => fmtTons(v) },
        { title: '笔数', dataIndex: 'rows', key: 'rows', align: 'right' as const, render: (v: number) => v },
      ];
    }
    return [
      { title: '日期', dataIndex: 'date', key: 'date', defaultSortOrder: 'descend' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => String(a.date).localeCompare(String(b.date)) },
      { title: '加油站', dataIndex: 'shopName', key: 'shopName' },
      { title: '油品', dataIndex: 'resourceLabel', key: 'resourceLabel' },
      { title: '升 (L)', dataIndex: 'liters', key: 'liters', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.liters - b.liters, render: (v: number) => fmtLiters(v) },
      { title: '吨 (t)', dataIndex: 'tons', key: 'tons', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.tons - b.tons, render: (v: number) => fmtTons(v) },
      { title: '笔数', dataIndex: 'rows', key: 'rows', align: 'right' as const, render: (v: number) => v },
    ];
  }, [groupBy]);

  const rowKey = (row: RetailTransferRecord, i: number) => {
    if (groupBy === 'station') return `st-${row.shopKey}`;
    if (groupBy === 'resource') return `rk-${row.resourceKey}`;
    if (groupBy === 'month') return `mo-${row.month}`;
    return `d-${row.date}-${row.shopKey}-${row.resourceKey}-${i}`;
  };

  return (
    <div className="client-fit-page">
      <div className="client-fit-stack">
        {error && <Alert type="error" message={error.message} closable />}
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Select value={groupBy} onChange={setGroupBy} style={{ width: 170 }} options={GROUP_OPTIONS} />
          <Select value={resource} onChange={setResource} style={{ width: 150 }} options={RESOURCE_OPTIONS} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>查询</Button>
        </Space>
        {data?.sourceNote && (
          <Alert type="info" showIcon message={data.sourceNote} style={{ marginTop: 8 }} />
        )}
        <Row gutter={[16, 16]} className="client-fit-fixed" style={{ marginTop: 8 }}>
          <Col xs={24} sm={8} md={6}>
            <Card size="small">
              <Statistic title="合计油量" value={fmtLiters(total.liters)} suffix="L" />
            </Card>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Card size="small">
              <Statistic title="合计吨位" value={fmtTons(total.tons)} suffix="t" />
            </Card>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Card size="small">
              <Statistic title="入库笔数" value={Number(total.rows || 0)} suffix="笔" />
            </Card>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Card size="small">
              <Statistic title="涉及站点" value={stationCount} suffix="站" />
            </Card>
          </Col>
        </Row>
      </div>
      <div className="client-fit-table-scroll">
        <Table
          columns={columns}
          dataSource={records}
          rowKey={rowKey}
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showTotal: (count) => `共 ${count} 行` }}
          scroll={{ x: 'max-content' }}
        />
      </div>
    </div>
  );
}
