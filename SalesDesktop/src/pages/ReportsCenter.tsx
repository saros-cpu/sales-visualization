import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Card, Col, DatePicker, InputNumber, Row, Select, Space, Typography, message } from 'antd';
import { FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import {
  downloadMonthlyReport,
  downloadRetailRangeReport,
  downloadSelfUseReport,
  downloadWholesaleDetails,
  downloadWholesaleReport,
  downloadYearlyReport,
  exportExcel,
} from '@/api/export';
import { useAuth } from '@/contexts/AuthContext';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

interface ReportCardProps {
  title: string;
  desc: string;
  icon: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onRun: () => void;
}

function ReportCard({ title, desc, icon, disabled, loading, onRun }: ReportCardProps) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space align="start">
          <span style={{ fontSize: 22, color: '#CC0000' }}>{icon}</span>
          <div>
            <Text strong>{title}</Text>
            <div><Text type="secondary">{desc}</Text></div>
          </div>
        </Space>
        <Button type="primary" block disabled={disabled} loading={loading} onClick={onRun}>
          生成/下载
        </Button>
      </Space>
    </Card>
  );
}

export default function ReportsCenter() {
  const { user, can } = useAuth();
  const now = dayjs();
  const [year, setYear] = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([now.subtract(6, 'day'), now]);
  const [running, setRunning] = useState('');

  const isAdmin = user?.role === 'admin';
  const canRetailExport = isAdmin || can('retail:export');
  const canWholesaleExport = isAdmin || can('wholesale:export');
  const canAnyReport = canRetailExport || canWholesaleExport;

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: `${index + 1} 月`,
  })), []);

  const run = async (key: string, task: () => Promise<unknown>) => {
    setRunning(key);
    try {
      await task();
      message.success('报表已生成或下载已开始');
    } catch (err: any) {
      message.error(err?.message || '报表生成失败');
    } finally {
      setRunning('');
    }
  };

  const rangeValues = () => ({
    dateFrom: range[0].format('YYYY-MM-DD'),
    dateTo: range[1].format('YYYY-MM-DD'),
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ marginBottom: 4 }}>报表中心</Title>
        <Text type="secondary">统一调用现有报表模板，保留原有模板格式与生成逻辑。</Text>
      </div>

      <Card size="small">
        <Space wrap>
          <span>报表月份</span>
          <InputNumber min={2020} max={2100} value={year} onChange={(value) => setYear(Number(value || now.year()))} />
          <Select style={{ width: 120 }} value={month} options={monthOptions} onChange={setMonth} />
          <span>日期范围</span>
          <RangePicker
            value={range}
            onChange={(values) => {
              if (values?.[0] && values?.[1]) setRange([values[0], values[1]]);
            }}
          />
        </Space>
      </Card>

      {!canAnyReport && (
        <Card size="small">
          <Text type="danger">当前账号没有报表导出权限。</Text>
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="综合月度分析报告"
            desc="按月生成现有综合分析模板"
            icon={<FileTextOutlined />}
            disabled={!canAnyReport}
            loading={running === 'monthly'}
            onRun={() => run('monthly', () => downloadMonthlyReport(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="综合年度分析报告"
            desc="按年度生成现有综合分析模板"
            icon={<FileTextOutlined />}
            disabled={!canAnyReport}
            loading={running === 'yearly'}
            onRun={() => run('yearly', () => downloadYearlyReport(year))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="批发分析报告"
            desc="按月调用批发分析报告模板"
            icon={<FileTextOutlined />}
            disabled={!canWholesaleExport}
            loading={running === 'wholesale'}
            onRun={() => run('wholesale', () => downloadWholesaleReport({ year, month }))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="零售月度 Excel"
            desc="按月导出零售日销表"
            icon={<FileExcelOutlined />}
            disabled={!canRetailExport}
            loading={running === 'retail-excel'}
            onRun={() => run('retail-excel', () => exportExcel(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="零售日期范围报表"
            desc="按日期范围生成零售周报/区间报表"
            icon={<FileExcelOutlined />}
            disabled={!canRetailExport}
            loading={running === 'retail-range'}
            onRun={() => run('retail-range', () => {
              const { dateFrom, dateTo } = rangeValues();
              return downloadRetailRangeReport(dateFrom, dateTo);
            })}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="自用油报表"
            desc="按日期范围导出自用油明细"
            icon={<FileExcelOutlined />}
            disabled={!canRetailExport}
            loading={running === 'self-use'}
            onRun={() => run('self-use', () => {
              const { dateFrom, dateTo } = rangeValues();
              return downloadSelfUseReport(dateFrom, dateTo);
            })}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title="批发明细 Excel"
            desc="按月导出批发明细数据"
            icon={<FileExcelOutlined />}
            disabled={!canWholesaleExport}
            loading={running === 'wholesale-detail'}
            onRun={() => run('wholesale-detail', () => downloadWholesaleDetails(ym(year, month)))}
          />
        </Col>
      </Row>
    </Space>
  );
}
