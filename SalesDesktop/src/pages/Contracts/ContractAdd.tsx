import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Space, message, Tag, Typography } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined, ClearOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { batchCreateContracts } from '@/api/contracts';
import { getProductOptions, getEntityOptions } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';

interface ContractDraft {
  id: number;
  contractNo: string;
  appendixNo?: string;
  customerName: string;
  productName: string;
  signedDate: string;
  effectiveStart: string;
  effectiveEnd: string;
  quantityTons: number | string;
  amountOriginal?: number | string;
  currency?: string;
  salesType?: string;
  remark?: string;
}

export default function ContractAdd() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const navigate = useNavigate();
  const tableRef = useRef<ExcelTableHandle>(null);
  const [rows, setRows] = useState<ContractDraft[]>([]);
  const [editing, setEditing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([]);
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => { getProductOptions().then(setProductOptions); }, []);
  useEffect(() => { getEntityOptions().then(setCustomerOptions); }, []);

  const handleAddNew = useCallback((row: any) => {
    setRows(prev => [...prev, row as ContractDraft]);
  }, []);

  const handleRealTimeSave = useCallback(async (id: number, field: string, value: any) => {
    setRows(prev => prev.map(row => row.id === id ? { ...row, [field]: value } : row));
  }, []);

  const validateRow = useCallback((row: Partial<ContractDraft>) => {
    const errors: Record<string, string> = {};
    if (!row.contractNo) errors.contractNo = t('common.contractNo') + ' ' + t('common.required');
    if (!row.customerName) errors.customerName = t('common.customerName') + ' ' + t('common.required');
    if (!row.productName) errors.productName = t('common.productName') + ' ' + t('common.required');
    if (!row.signedDate) errors.signedDate = t('common.signedDate') + ' ' + t('common.required');
    if (!row.effectiveStart) errors.effectiveStart = t('common.effectiveStart') + ' ' + t('common.required');
    if (!row.effectiveEnd) errors.effectiveEnd = t('common.effectiveEnd') + ' ' + t('common.required');
    if (row.effectiveStart && row.effectiveEnd && dayjs(row.effectiveStart).isAfter(dayjs(row.effectiveEnd))) {
      errors.effectiveEnd = t('contracts.dateRangeError');
    }
    const qty = Number(row.quantityTons ?? 0);
    if (!qty || qty <= 0) errors.quantityTons = t('common.plannedTons') + ' ' + t('common.required');
    if (row.amountOriginal !== undefined && row.amountOriginal !== '' && Number(row.amountOriginal) < 0) {
      errors.amountOriginal = t('common.amount') + ' ' + t('common.failed');
    }
    return errors;
  }, [t]);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<ContractDraft> }>) => {
    if (!can('contracts:create')) {
      message.error(t('common.noPermission'));
      return;
    }
    setSaving(true);
    try {
      const records = changes.map(({ data }) => ({
        contractNo: String(data.contractNo || '').trim(),
        appendixNo: String(data.appendixNo || '').trim(),
        customerName: String(data.customerName || '').trim(),
        productName: String(data.productName || '').trim(),
        signedDate: data.signedDate || dayjs().format('YYYY-MM-DD'),
        effectiveStart: data.effectiveStart || dayjs().format('YYYY-MM-DD'),
        effectiveEnd: data.effectiveEnd || dayjs().add(1, 'year').format('YYYY-MM-DD'),
        quantityTons: Number(data.quantityTons || 0),
        amountOriginal: data.amountOriginal === '' || data.amountOriginal === undefined ? undefined : Number(data.amountOriginal),
        currency: data.currency || undefined,
        salesType: data.salesType || undefined,
        remark: data.remark || undefined,
      }));
      const res = await batchCreateContracts(records);
      if (res.errors?.length) {
        message.warning(`${t('common.save')} ${t('common.success')} ${res.inserted}，${t('common.failed')} ${res.errors.length}`);
      } else {
        message.success(t('common.save') + ' ' + t('common.success'));
      }
      setRows([]);
      setEditing(true);
    } catch {
      message.error(t('common.save') + ' ' + t('common.failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!can('contracts:create')) {
    return <Card title={t('nav.contractAdd')}><Tag color="red">{t('common.noPermission')}</Tag></Card>;
  }

  const salesTypeOptions = [
    { value: 'unknown', label: t('contracts.salesTypes.unknown') },
    { value: 'local_wholesale', label: t('contracts.salesTypes.local_wholesale') },
    { value: 'export_wholesale', label: t('contracts.salesTypes.export_wholesale') },
    { value: 'internal', label: t('contracts.salesTypes.internal') },
  ];

  const columns = [
    { title: t('common.contractNo'), dataIndex: 'contractNo', key: 'contractNo', width: 150, editable: true, required: true },
    { title: t('common.appendixNo'), dataIndex: 'appendixNo', key: 'appendixNo', width: 160, editable: true },
    {
      title: t('common.customerName'),
      dataIndex: 'customerName',
      key: 'customerName',
      width: 190,
      editable: true,
      required: true,
      editorType: 'select' as const,
      editorOptions: customerOptions,
    },
    {
      title: t('common.productName'),
      dataIndex: 'productName',
      key: 'productName',
      width: 140,
      editable: true,
      required: true,
      editorType: 'select' as const,
      editorOptions: productOptions,
    },
    { title: t('common.signedDate'), dataIndex: 'signedDate', key: 'signedDate', width: 130, editable: true, required: true, editorType: 'date' as const },
    { title: t('common.effectiveStart'), dataIndex: 'effectiveStart', key: 'effectiveStart', width: 130, editable: true, required: true, editorType: 'date' as const },
    { title: t('common.effectiveEnd'), dataIndex: 'effectiveEnd', key: 'effectiveEnd', width: 130, editable: true, required: true, editorType: 'date' as const },
    { title: t('common.plannedTons'), dataIndex: 'quantityTons', key: 'quantityTons', width: 110, editable: true, required: true, editorType: 'number' as const },
    { title: t('common.amount'), dataIndex: 'amountOriginal', key: 'amountOriginal', width: 120, editable: true, editorType: 'number' as const },
    {
      title: t('common.currency'),
      dataIndex: 'currency',
      key: 'currency',
      width: 100,
      editable: true,
      editorType: 'select' as const,
      editorOptions: ['CNY', 'USD', 'KGS', 'RUB'].map(value => ({ value, label: value })),
    },
    {
      title: t('common.salesType'),
      dataIndex: 'salesType',
      key: 'salesType',
      width: 130,
      editable: true,
      editorType: 'select' as const,
      editorOptions: salesTypeOptions,
    },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', width: 180, editable: true },
  ];

  return (
    <Card
      title={t('nav.contractAdd')}
      extra={
        <Space wrap>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => { if (!editing) setEditing(true); tableRef.current?.addNewRow(); }}>
            {t('common.add')}
          </Button>
          <Button icon={<SaveOutlined />} type="primary" loading={saving} onClick={async () => { try { await tableRef.current?.saveAllChanges(); } catch {} }}>
            {t('common.save')}
          </Button>
          <Button icon={<ClearOutlined />} onClick={() => { tableRef.current?.clearDraft(); setRows([]); }}>
            {t('common.clearDraft')}
          </Button>
          <Button icon={<CloseOutlined />} onClick={() => navigate('/contracts/view')}>
            {t('nav.contractView')}
          </Button>
        </Space>
      }
    >
      <Typography.Text type="secondary">{t('contracts.appendixNoHint')}</Typography.Text>
      <div style={{ marginTop: 12 }}>
        <ExcelTable<ContractDraft>
          ref={tableRef}
          dataSource={rows}
          columns={columns}
          editing={editing}
          setEditing={setEditing}
          isAdmin={false}
          onBatchSave={handleBatchSave}
          onRealTimeSave={handleRealTimeSave}
          onAddNew={handleAddNew}
          validateRow={validateRow}
          initialNewRow={() => ({
            signedDate: dayjs().format('YYYY-MM-DD'),
            effectiveStart: dayjs().format('YYYY-MM-DD'),
            effectiveEnd: dayjs().add(1, 'year').format('YYYY-MM-DD'),
            currency: 'KGS',
            salesType: 'unknown',
          })}
          draftKey="contract-add-spreadsheet-draft"
          height={600}
        />
      </div>
    </Card>
  );
}
