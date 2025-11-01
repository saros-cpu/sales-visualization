import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, Space, DatePicker, Button, message, Popconfirm } from 'antd';
import { SearchOutlined, UploadOutlined, PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { getTrainEntryList, updateTrainEntry, deleteTrainEntry, batchCreateTrainEntry, TrainEntryRecord } from '@/api/trainEntry';
import { getProductOptions, getEntityOptions } from '@/api/client';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';
import { KpiGrid } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

const { RangePicker } = DatePicker;

export default function TrainEntryPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canCreate = can('train_entry:create');
  const canUpdate = can('train_entry:update');
  const canDelete = can('train_entry:delete');
  const canEdit = canCreate || canUpdate;
  const [data, setData] = useState<TrainEntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [editing, setEditing] = useState(false);
  const [productOpts, setProductOpts] = useState<{value: string; label: string}[]>([]);
  const [entityOpts, setEntityOpts] = useState<{value: string; label: string}[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadRecords, setUploadRecords] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTrainEntryList({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page: 1, page_size: 1000,
      });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } finally { setLoading(false); }
  }, [dates]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    getProductOptions().then(setProductOpts);
    getEntityOptions().then(setEntityOpts);
  }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<TrainEntryRecord> }>) => {
    const updates: Array<{ id: number; data: Partial<TrainEntryRecord> }> = [];
    const creates: Array<Partial<TrainEntryRecord>> = [];

    for (const change of changes) {
      if (change.id > 0) {
        updates.push(change);
      } else {
        creates.push(change.data);
      }
    }
    if ((creates.length > 0 && !canCreate) || (updates.length > 0 && !canUpdate)) {
      message.error(t('common.noPermission'));
      return;
    }

    setSaving(true);
    try {
      if (creates.length > 0) {
        await batchCreateTrainEntry(creates);
      }
      for (const u of updates) {
        await updateTrainEntry(u.id, u.data);
      }
      message.success(`${t('common.save')} ${t('common.success')}`);
      setEditing(false);
      fetchData();
    } catch {
      message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRealTimeSave = async (id: number, field: string, value: any) => {
    if (id > 0 && !canUpdate) return;
    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateTrainEntry(id, { [field]: value });
    }
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as TrainEntryRecord]);
  }, []);

  const handleDeleteRows = async (ids: number[]) => {
    if (!canDelete) {
      message.error(t('common.noPermission'));
      return;
    }
    const savedIds = ids.filter(id => id > 0);
    try {
      for (const id of savedIds) {
        await deleteTrainEntry(id);
      }
      setData(prev => prev.filter(row => !ids.includes(row.id)));
      setSelectedIds([]);
      if (savedIds.length > 0) fetchData();
    } catch {
      message.error(t('common.deleteFailedRetry'));
      throw new Error('delete_failed');
    }
  };

  const classifyOilFlow = useCallback((record: Partial<TrainEntryRecord>) => {
    const sender = String(record.senderName || '').trim();
    const receiver = String(record.receiverName || '').trim();
    const text = `${sender} ${receiver}`;
    const internalWords = ['油库', '加油站', '仓库', 'ProductTeam', '物流管理部', 'CUSTOMER-S-АББР', 'Example'];
    const senderInternal = internalWords.some(word => sender.includes(word));
    const receiverInternal = internalWords.some(word => receiver.includes(word));
    if (senderInternal && receiverInternal) return { type: '外运', result: '内部单位之间油品流转，系统按外运识别' };
    if (/供应|采购|炼厂|завод|постав/i.test(text)) return { type: '采购', result: '按发货单位/收货单位识别为采购' };
    if (/客户|出口|销售|покуп|client/i.test(text)) return { type: '批发', result: '按收货单位识别为批发销售' };
    return { type: '待确认', result: '单位匹配不明确，保存前请核对' };
  }, []);

  const validateRow = useCallback((row: Partial<TrainEntryRecord>) => {
    const errors: Record<string, string> = {};
    if (!row.entryDate) errors.entryDate = t('common.date') + ' ' + t('common.required');
    if (!row.vehicleNo) errors.vehicleNo = t('common.vehicleNo') + ' ' + t('common.required');
    if (!row.senderName) errors.senderName = t('common.senderUnit') + ' ' + t('common.required');
    if (!row.receiverName) errors.receiverName = t('common.receiverUnit') + ' ' + t('common.required');
    if (!row.productName) errors.productName = t('common.product') + ' ' + t('common.required');
    const tons = Number(row.weightTons ?? 0);
    if (!tons || tons <= 0) errors.weightTons = t('common.tons') + ' ' + t('common.required');
    return errors;
  }, [t]);

  const entryKpis = useMemo(() => {
    const draftRows = data.filter(row => row.id < 0);
    const invalidRows = data.filter(row => Object.keys(validateRow(row)).length > 0);
    const totalTons = data.reduce((sum, row) => sum + Number((row.weightTons ?? (row.weightKg ? Number(row.weightKg) / 1000 : 0)) || 0), 0);
    return [
      { key: 'rows', title: t('common.currentBatch'), value: data.length, suffix: t('common.rows') },
      { key: 'valid', title: t('common.validRows'), value: Math.max(data.length - invalidRows.length, 0), suffix: t('common.rows'), tone: invalidRows.length ? 'warning' as const : 'success' as const },
      { key: 'invalid', title: t('common.invalidRows'), value: invalidRows.length, suffix: t('common.rows'), goodWhen: 'down' as const, tone: invalidRows.length ? 'danger' as const : 'success' as const },
      { key: 'draft', title: t('common.unsavedRows'), value: draftRows.length, suffix: t('common.rows'), tone: draftRows.length ? 'warning' as const : 'neutral' as const },
      { key: 'tons', title: t('common.weightTons'), value: totalTons, precision: 3, suffix: 't' },
    ];
  }, [data, t, validateRow]);

  const handleUploadFile = (file: File) => {
    if (!canCreate) {
      message.error(t('common.noPermission'));
      return false;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const headerRow = rows.find((r) => r[1] && String(r[1]).includes('入厂日期'));
        if (!headerRow) { message.error('未找到表头行（需包含「入厂日期」列）'); return; }
        const headerIdx = rows.indexOf(headerRow);
        const records: any[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[1]) continue;
          const entryDate = String(r[1]).trim();
          const productName = String(r[2] || '').trim();
          const weighNo = String(r[3] || '').trim();
          const vehicleNo = String(r[4] || '').trim();
          const senderName = String(r[5] || '').trim();
          const receiverName = String(r[6] || '').trim();
          const weightKg = r[7] != null ? Number(r[7]) : undefined;
          const remark = String(r[8] || '').trim();
          if (!entryDate || !productName || !vehicleNo) continue;
          records.push({ entryDate, productName, weighNo, vehicleNo, senderName, receiverName, weightKg, remark });
        }
        if (records.length === 0) { message.error('未解析到有效数据'); return; }
        setUploadRecords(records);
        setUploadModalOpen(true);
      } catch (err: any) {
        message.error('文件解析失败: ' + (err.message || ''));
      }
    };
    reader.readAsBinaryString(file);
    return false;
  };

  const handleUploadConfirm = async () => {
    if (!canCreate) {
      message.error(t('common.noPermission'));
      return;
    }
    setUploading(true);
    try {
      const res = await batchCreateTrainEntry(uploadRecords);
      message.success('导入成功 ' + (res.data?.inserted ?? uploadRecords.length));
      setUploadModalOpen(false);
      setUploadRecords([]);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err.message || '导入失败');
    } finally { setUploading(false); }
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'entryDate', key: 'entryDate', width: 130, editable: true, required: true, editorType: 'date' as const },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 120, editable: true, required: true },
    { title: t('common.senderUnit'), dataIndex: 'senderName', key: 'senderName', width: 170, editable: true, required: true },
    { title: t('common.receiverUnit'), dataIndex: 'receiverName', key: 'receiverName', width: 170, editable: true, required: true },
    { title: t('common.product'), dataIndex: 'productName', key: 'productName', width: 130, editable: true, required: true },
    { title: t('common.tons'), dataIndex: 'weightTons', key: 'weightTons', width: 100, editable: true, required: true, editorType: 'number' as const },
    { title: t('common.businessType'), dataIndex: 'businessType', key: 'businessType', width: 110, render: (_: any, row: TrainEntryRecord) => classifyOilFlow(row).type },
    { title: t('common.recognitionResult'), dataIndex: 'recognitionResult', key: 'recognitionResult', width: 240, render: (_: any, row: TrainEntryRecord) => classifyOilFlow(row).result },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', width: 160, editable: true },
  ];

  return (
    <Card
      title={t('common.trainEntry')}
      extra={
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          {canDelete && (
            <Popconfirm
              title={t('common.deleteConfirm')}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
              onConfirm={() => tableRef.current?.deleteSelectedRows()}
              disabled={selectedIds.length === 0}
            >
              <Button danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0}>
                {selectedIds.length > 0 ? `${t('common.delete')} (${selectedIds.length})` : t('common.delete')}
              </Button>
            </Popconfirm>
          )}
          {canCreate && (
            <>
              <Button icon={<UploadOutlined />} onClick={() => document.getElementById('train-upload-input')?.click()}>
                {t('common.import')}
              </Button>
              <input id="train-upload-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])} />
              <Button icon={<PlusOutlined />} type="primary" onClick={() => { if (!editing) setEditing(true); tableRef.current?.addNewRow(); }}>
                {t('common.add')}
              </Button>
            </>
          )}
          {editing && canEdit && (
            <>
              <Button icon={<SaveOutlined />} type="primary" onClick={async () => { try { await tableRef.current?.saveAllChanges(); setEditing(false); } catch {} }} loading={saving}>
                {t('common.save')}
              </Button>
              <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          )}
          {!editing && canEdit && (
            <Button onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </Space>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <KpiGrid items={entryKpis} defaultSpan={6} />
      </div>
      <ExcelTable
        ref={tableRef}
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={(value) => setEditing(canEdit && value)}
        isAdmin={false}
        canDelete={canDelete}
        onBatchSave={handleBatchSave}
        onRealTimeSave={handleRealTimeSave}
        onAddNew={handleAddNew}
        onDelete={handleDeleteRows}
        onSelectionChange={setSelectedIds}
        validateRow={validateRow}
        initialNewRow={() => ({ entryDate: dayjs().format('YYYY-MM-DD') })}
        draftKey="train-entry-spreadsheet-draft"
        rowHeight={40}
        height={600}
      />
    </Card>
  );
}
