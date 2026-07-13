import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { App, Button, Card, Col, DatePicker, Row, Select, Space, Typography } from 'antd';
import { FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  downloadMonthlyReport,
  downloadProfitReport,
  downloadProfitYearReport,
  downloadRetailRangeReport,
  downloadSelfUseReport,
  downloadWholesaleDetails,
  downloadWholesaleReport,
  downloadYearlyReport,
  exportExcel,
} from '@/api/export';
import { useAuth } from '@/contexts/AuthContext';
import { useRetailYears } from '@/hooks/useRetailYears';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

function ym(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

interface ReportCardProps {
  title: string;
  desc: string;
  icon: ReactNode;
  runLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onRun: () => void;
}

function ReportCard({ title, desc, icon, runLabel, disabled, loading, onRun }: ReportCardProps) {
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
          {runLabel}
        </Button>
      </Space>
    </Card>
  );
}

export default function ReportsCenter() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { user, can } = useAuth();
  const now = dayjs();
  const { year, setYear, yearOptions } = useRetailYears(now.year());
  const [month, setMonth] = useState(now.month() + 1);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([now.subtract(6, 'day'), now]);
  const [running, setRunning] = useState('');

  const isAdmin = user?.role === 'admin';
  const canRetailExport = isAdmin || can('retail:export');
  const canWholesaleExport = isAdmin || can('wholesale:export');
  const canProfitExport = isAdmin;
  const canAnyReport = canRetailExport || canWholesaleExport;

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: t('reportsCenter.monthLabel', { month: index + 1 }),
  })), [t]);

  const run = async (key: string, task: () => Promise<unknown>) => {
    setRunning(key);
    try {
      await task();
      message.success(t('reportsCenter.success'));
    } catch (err: any) {
      message.error(err?.message || t('reportsCenter.failed'));
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
        <Title level={4} style={{ marginBottom: 4 }}>{t('reportsCenter.title')}</Title>
        <Text type="secondary">{t('reportsCenter.subtitle')}</Text>
      </div>

      <div>
        <Space wrap>
          <span>{t('reportsCenter.month')}</span>
          <Select
            style={{ width: 110 }}
            value={year}
            options={yearOptions.map((item) => ({ value: item, label: `${item}` }))}
            onChange={setYear}
          />
          <Select style={{ width: 120 }} value={month} options={monthOptions} onChange={setMonth} />
          <span>{t('reportsCenter.range')}</span>
          <RangePicker
            value={range}
            onChange={(values) => {
              if (values?.[0] && values?.[1]) setRange([values[0], values[1]]);
            }}
          />
        </Space>
      </div>

      {!canAnyReport && (
        <div className="page-inline-alert">
          <Text type="danger">{t('reportsCenter.noPermission')}</Text>
        </div>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.monthlyTitle')}
            desc={t('reportsCenter.monthlyDesc')}
            icon={<FileTextOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canAnyReport}
            loading={running === 'monthly'}
            onRun={() => run('monthly', () => downloadMonthlyReport(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.yearlyTitle')}
            desc={t('reportsCenter.yearlyDesc')}
            icon={<FileTextOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canAnyReport}
            loading={running === 'yearly'}
            onRun={() => run('yearly', () => downloadYearlyReport(year))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.wholesaleTitle')}
            desc={t('reportsCenter.wholesaleDesc')}
            icon={<FileTextOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canWholesaleExport}
            loading={running === 'wholesale'}
            onRun={() => run('wholesale', () => downloadWholesaleReport({ year, month }))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.retailExcelTitle')}
            desc={t('reportsCenter.retailExcelDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canRetailExport}
            loading={running === 'retail-excel'}
            onRun={() => run('retail-excel', () => exportExcel(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.retailRangeTitle')}
            desc={t('reportsCenter.retailRangeDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
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
            title={t('reportsCenter.selfUseTitle')}
            desc={t('reportsCenter.selfUseDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
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
            title={t('reportsCenter.wholesaleDetailTitle')}
            desc={t('reportsCenter.wholesaleDetailDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canWholesaleExport}
            loading={running === 'wholesale-detail'}
            onRun={() => run('wholesale-detail', () => downloadWholesaleDetails(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.profitTitle')}
            desc={t('reportsCenter.profitDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canProfitExport}
            loading={running === 'profit'}
            onRun={() => run('profit', () => downloadProfitReport(ym(year, month)))}
          />
        </Col>
        <Col xs={24} md={12} xl={8}>
          <ReportCard
            title={t('reportsCenter.profitYearTitle')}
            desc={t('reportsCenter.profitYearDesc')}
            icon={<FileExcelOutlined />}
            runLabel={t('reportsCenter.run')}
            disabled={!canProfitExport}
            loading={running === 'profit-year'}
            onRun={() => run('profit-year', () => downloadProfitYearReport(year))}
          />
        </Col>
      </Row>
    </Space>
  );
}
