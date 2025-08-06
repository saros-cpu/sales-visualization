import { useEffect, useState, useCallback } from 'react';
import { Card, Space, DatePicker, Button, message } from 'antd';
import { SearchOutlined, ReloadOutlined, UploadOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { getTrainEntryList, createTrainEntry, updateTrainEntry, deleteTrainEntry, batchCreateTrainEntry, TrainEntryRecord } from '@/api/trainEntry';
import { getProductOptions, getEntityOptions } from '@/api/client';
import ExcelTable from '@/components/common/ExcelTable';

const { RangePicker } = DatePicker;

export default function TrainEntryPage() {
  const { t } = useTranslation();
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTrainEntryList({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page: 1, page_size: 1000,
      });
      setData(res.data.items);
      setTotal(res.data.total);
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

    setSaving(true);
    try {
      if (creates.length > 0) {
        await batchCreateTrainEntry(creates);
      }
      for (const u of updates) {
        await updateTrainEntry(u.id, u.data);
      }
      message.success('保存成功');
      setEditing(false);
      fetchData();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRealTimeSave = async (id: number, field: string, value: any) => {
    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateTrainEntry(id, { [field]: value });
    }
  };

  const handleUploadFile = (file: File) => {
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
    { title: t('common.date'), dataIndex: 'entryDate', key: 'entryDate', width: 140, editable: true },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 110, editable: true },
    { title: '磅单号', dataIndex: 'weighNo', key: 'weighNo', width: 130, editable: true },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 130, editable: true },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 140, editable: true },
    { title: t('weighing.receiverName'), dataIndex: 'receiverName', key: 'receiverName', width: 140, editable: true },
    { title: t('common.weightKg'), dataIndex: 'weightKg', key: 'weightKg', width: 110, editable: true },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: 130, editable: true },
  ];

  return (
    <Card
      title={t('common.trainEntry')}
      extra={
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchData(); }}>{t('common.reset')}</Button>
          <Button icon={<UploadOutlined />} onClick={() => document.getElementById('train-upload-input')?.click()}>
            {t('common.import')}
          </Button>
          <input id="train-upload-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])} />
          <Button icon={<SaveOutlined />} type="primary" onClick={() => setEditing(true)} disabled={editing}>
            {t('common.edit')}
          </Button>
          <Button icon={<SaveOutlined />} type="primary" onClick={() => setEditing(false)} disabled={!editing}>
            {t('common.add')}
          </Button>
          {editing && (
            <>
              <Button icon={<SaveOutlined />} type="primary" onClick={() => setEditing(false)} loading={saving}>
                {t('common.save')}
              </Button>
              <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </Space>
      }
    >
      <ExcelTable
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={setEditing}
        isAdmin={false}
        onBatchSave={handleBatchSave}
        onRealTimeSave={handleRealTimeSave}
        rowHeight={40}
        height={600}
      />
    </Card>
  );
}
