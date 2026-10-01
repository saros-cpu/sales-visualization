import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button, Space, Alert, DatePicker, Table, Select, Row, Col, Statistic, Card } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { getRetailTransferStats, RetailTransferRecord, RetailTransferData } from '@/api/retail';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

const fmtLiters = (v: number) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtTons = (v: number) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fmtDensity = (v: number) => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

const RESOURCE_OPTIONS = [
  { value: '', label: '全部油品' },
  { value: '102', label: 'АИ 80' },
  { value: '103', label: 'АИ 92' },
  { value: '104', label: 'АИ 95' },
  { value: '106', label: 'Д/Т（含 -15/-35）' },
  { value: '108', label: 'СПБТ' },
];

const GROUP_OPTIONS = [
  { value: 'detail', label: '明细（日×站×油品）' },
  { value: 'station', label: '按站点' },
  { value: 'resource', label: '按油品' },
  { value: 'month', label: '按月' },
];

const MODE_OPTIONS = [
  { value: 'range', label: '按日期区间' },
  { value: 'year', label: '按年' },
  { value: 'month', label: '按月' },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }));

const YEAR_OPTIONS = (() => {
  const y = dayjs().year();
  return [y, y - 1].map((yy) => ({ value: yy, label: `${yy} 年` }));
})();

export default function Transfer() {
  const [mode, setMode] = useState<string>('range');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('year'), dayjs()]);
  const [year, setYear] = useState<number>(dayjs().year());
  const [month, setMonth] = useState<number>(dayjs().month() + 1);
  const [groupBy, setGroupBy] = useState<string>('detail');
  const [resource, setResource] = useState<string>('');
  const [station, setStation] = useState<string>('');
  const [data, setData] = useState<RetailTransferData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params: Record<string, unknown> = { groupBy, resource };
    if (mode === 'year') {
      params.mode = 'year';
      params.year = year;
    } else if (mode === 'month') {
      params.mode = 'month';
      params.year = year;
      params.month = month;
    } else {
      params.start = dates[0].format('YYYY-MM-DD');
      params.end = dates[1].format('YYYY-MM-DD');
    }
    if (station === 'blank') params.nameStatus = 'blank';
    else if (station) params.shopKey = station;
    try {
      const res = await getRetailTransferStats(params as any);
      setData(res);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [mode, dates, year, month, groupBy, resource, station]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const total = data?.total || { liters: 0, tons: 0, rows: 0, density: 0 };
  const stationCount = (data?.summary?.byStation || []).length;
  const records: RetailTransferRecord[] = Array.isArray(data?.records) ? data.records : [];
  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const byResource = data?.summary?.byResource || [];

  const stationOptions = [
    { value: '', label: '全部加油站' },
    ...stations.map((s) => ({ value: String(s.shopKey), label: s.shopName })),
    { value: 'blank', label: '空白名称（未知站）' },
  ];

  const columns = useMemo(() => {
    const base = [
      { title: '升 (L)', dataIndex: 'liters', key: 'liters', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.liters - b.liters, render: (v: number) => fmtLiters(v) },
      { title: '吨 (t)', dataIndex: 'tons', key: 'tons', align: 'right' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => a.tons - b.tons, render: (v: number) => fmtTons(v) },
      { title: '密度 (kg/L)', dataIndex: 'density', key: 'density', align: 'right' as const, render: (v: number) => fmtDensity(v) },
      { title: '笔数', dataIndex: 'rows', key: 'rows', align: 'right' as const, render: (v: number) => v },
    ];
    if (groupBy === 'station') {
      return [
        { title: '加油站', dataIndex: 'shopName', key: 'shopName' },
        ...base,
      ];
    }
    if (groupBy === 'resource') {
      return [
        { title: '油品', dataIndex: 'resourceLabel', key: 'resourceLabel' },
        ...base,
      ];
    }
    if (groupBy === 'month') {
      return [
        { title: '月份', dataIndex: 'month', key: 'month' },
        ...base,
      ];
    }
    return [
      { title: '日期', dataIndex: 'date', key: 'date', defaultSortOrder: 'descend' as const, sorter: (a: RetailTransferRecord, b: RetailTransferRecord) => String(a.date).localeCompare(String(b.date)) },
      { title: '加油站', dataIndex: 'shopName', key: 'shopName' },
      { title: '油品', dataIndex: 'resourceLabel', key: 'resourceLabel' },
      ...base,
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
          <Select value={mode} onChange={setMode} style={{ width: 140 }} options={MODE_OPTIONS} />
          {mode === 'range' && (
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          )}
          {mode === 'year' && (
            <Select value={year} onChange={setYear} style={{ width: 110 }} options={YEAR_OPTIONS} />
          )}
          {mode === 'month' && (
            <>
              <Select value={year} onChange={setYear} style={{ width: 110 }} options={YEAR_OPTIONS} />
              <Select value={month} onChange={setMonth} style={{ width: 90 }} options={MONTH_OPTIONS} />
            </>
          )}
          <Select value={groupBy} onChange={setGroupBy} style={{ width: 170 }} options={GROUP_OPTIONS} />
          <Select value={resource} onChange={setResource} style={{ width: 170 }} options={RESOURCE_OPTIONS} />
          <Select value={station} onChange={setStation} style={{ width: 180 }} options={stationOptions} />
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
              <Statistic title="平均密度" value={fmtDensity(total.density)} suffix="kg/L" />
            </Card>
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Card size="small">
              <Statistic title="入库笔数" value={Number(total.rows || 0)} suffix="笔" />
            </Card>
          </Col>
        </Row>
        {byResource.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
              按油品分类（随所选择同步更新）
            </div>
            <Row gutter={[12, 12]}>
              {byResource.map((r) => (
                <Col key={r.resourceKey} xs={12} sm={8} md={6} lg={4}>
                  <Card size="small">
                    <div style={{ fontSize: 13, color: '#374151' }}>{r.resourceLabel}</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{fmtTons(r.tons)} t</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {fmtLiters(r.liters)} L ｜ {fmtDensity(r.density || 0)} kg/L
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          </div>
        )}
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
