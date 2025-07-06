import { useEffect, useState, useCallback, useRef } from 'react';
import { Row, Col, Card, Table, Button, Space, DatePicker, Input, InputNumber, Select, Popconfirm, message, Tag, Statistic, Modal } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SaveOutlined, CloseOutlined, UploadOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { getTrainEntryList, createTrainEntry, updateTrainEntry, deleteTrainEntry, batchCreateTrainEntry, TrainEntryRecord } from '@/api/trainEntry';
import { getProductOptions, getEntityOptions } from '@/api/client';

const { RangePicker } = DatePicker;

export default function TrainEntryPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<TrainEntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [editingKeys, setEditingKeys] = useState<Set<number>>(new Set());
  const [editData, setEditData] = useState<Record<number, any>>({});
  const [productOpts, setProductOpts] = useState<{value: string; label: string}[]>([]);
  const [entityOpts, setEntityOpts] = useState<{value: string; label: string}[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadRecords, setUploadRecords] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const tempIdCounter = useRef(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTrainEntryList({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page, page_size: 50,
      });
      setData(res.data.items);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [dates, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    getProductOptions().then(setProductOpts);
    getEntityOptions().then(setEntityOpts);
  }, []);

  const cancelEditing = (id: number) => {
    const next = new Set(editingKeys);
    next.delete(id);
    setEditingKeys(next);
    setEditData(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const startEditing = (record: TrainEntryRecord) => {
    setEditingKeys(prev => new Set(prev).add(record.id));
    setEditData(prev => ({ ...prev, [record.id]: { ...record } }));
  };

  const addRow = () => {
    const tempId = --tempIdCounter.current;
    const blank: any = {
      id: tempId, entryDate: dayjs().format('YYYY-MM-DD'), productName: '', vehicleNo: '',
      weighNo: '', senderName: '', receiverName: '', weightKg: null, remark: '',
    };
    setData(prev => [blank as any, ...prev]);
    setEditingKeys(prev => new Set(prev).add(tempId));
    setEditData(prev => ({ ...prev, [tempId]: { ...blank } }));
  };

  const updateCell = (id: number, field: string, value: any) => {
    setEditData(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const saveRow = async (id: number) => {
    const record = editData[id];
    if (!record) return;
    if (!record.productName || !record.vehicleNo) {
      message.error('产品名和车号必填');
      return;
    }
    try {
      const payload = {
        entryDate: dayjs.isDayjs(record.entryDate) ? record.entryDate.format('YYYY-MM-DD') : record.entryDate,
        productName: record.productName,
        vehicleNo: record.vehicleNo,
        weighNo: record.weighNo || '',
        senderName: record.senderName || '',
        receiverName: record.receiverName || '',
        weightKg: record.weightKg ? Number(record.weightKg) : undefined,
        remark: record.remark || '',
      };
      if (id > 0) {
        await updateTrainEntry(id, payload);
      } else {
        await createTrainEntry(payload);
      }
      message.success(t('common.saved'));
      cancelEditing(id);
      fetchData();
    } catch { message.error(t('common.error')); }
  };

  const handleDelete = async (id: number) => {
    if (id > 0) await deleteTrainEntry(id);
    setData(prev => prev.filter(r => r.id !== id));
    cancelEditing(id);
    if (id > 0) message.success(t('common.deleted'));
    fetchData();
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
      message.success(t('common.uploadSuccess', { count: res.data?.inserted ?? uploadRecords.length }));
      setUploadModalOpen(false);
      setUploadRecords([]);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err.message || '导入失败');
    } finally { setUploading(false); }
  };

  const renderCell = (id: number, field: string, value: any, record: any) => {
    const isEditing = editingKeys.has(id);
    if (!isEditing) {
      if (field === 'productName') return t(`product.${value}`, { defaultValue: value });
      if (field === 'weightKg') return value?.toLocaleString() ?? '-';
      return value || '-';
    }
    const current = editData[id]?.[field] ?? value;
    switch (field) {
      case 'entryDate':
        return (
          <DatePicker
            value={current ? dayjs(current) : null}
            onChange={(d) => updateCell(id, field, d?.format('YYYY-MM-DD') || '' )}
            size="small" style={{ width: 130 }}
          />
        );
      case 'productName':
        return (
          <Select
            value={current || undefined}
            onChange={(v) => updateCell(id, field, v)}
            options={productOpts}
            size="small" style={{ width: 100 }}
          />
        );
      case 'vehicleNo':
      case 'weighNo':
      case 'remark':
        return (
          <Input
            value={current}
            onChange={(e) => updateCell(id, field, e.target.value)}
            size="small" style={{ width: 120 }}
          />
        );
      case 'senderName':
      case 'receiverName':
        return (
          <Select
            value={current || undefined}
            onChange={(v) => updateCell(id, field, v)}
            options={entityOpts}
            size="small" style={{ width: 130 }}
            allowClear
          />
        );
      case 'weightKg':
        return (
          <InputNumber
            value={current}
            onChange={(v) => updateCell(id, field, v)}
            size="small" style={{ width: 100 }}
            min={0}
          />
        );
      default:
        return current ?? '-';
    }
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'entryDate', key: 'entryDate', width: 140, render: (v: string, r: any) => renderCell(r.id, 'entryDate', v, r) },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 110, render: (v: string, r: any) => renderCell(r.id, 'productName', v, r) },
    { title: '磅单号', dataIndex: 'weighNo', key: 'weighNo', width: 130, render: (v: string, r: any) => renderCell(r.id, 'weighNo', v, r) },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 130, render: (v: string, r: any) => renderCell(r.id, 'vehicleNo', v, r) },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 140, ellipsis: true, render: (v: string, r: any) => renderCell(r.id, 'senderName', v, r) },
    { title: t('weighing.receiverName'), dataIndex: 'receiverName', key: 'receiverName', width: 140, ellipsis: true, render: (v: string, r: any) => renderCell(r.id, 'receiverName', v, r) },
    { title: t('common.weightKg'), dataIndex: 'weightKg', key: 'weightKg', width: 110, render: (v: number | null, r: any) => renderCell(r.id, 'weightKg', v, r) },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true, width: 130, render: (v: string, r: any) => renderCell(r.id, 'remark', v, r) },
    {
      title: t('common.action'), key: 'action', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: any) => {
        const isEditing = editingKeys.has(r.id);
        if (isEditing) {
          return (
            <Space>
              <Button type="link" size="small" icon={<SaveOutlined />} onClick={() => saveRow(r.id)}>{t('common.save')}</Button>
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={() => cancelEditing(r.id)}>{t('common.cancel')}</Button>
            </Space>
          );
        }
        return (
          <Space>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => startEditing(r)} />
            <Popconfirm title={t('common.deleteConfirm')} onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Card
        title={t('common.trainEntry')}
        extra={
          <Space wrap>
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
            <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setPage(1); fetchData(); }}>{t('common.reset')}</Button>
            <Button icon={<UploadOutlined />} onClick={() => document.getElementById('train-upload-input')?.click()}>
              {t('common.import')}
            </Button>
            <input id="train-upload-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])} />
            <Button icon={<PlusOutlined />} type="primary" onClick={addRow}>{t('common.add')}</Button>
          </Space>
        }
      >
        <Table
          dataSource={data} columns={columns} rowKey="id"
          loading={loading} size="small"
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
          scroll={{ x: 1250 }}
        />
      </Card>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={4}><Card size="small"><Statistic title={t('common.total', { count: total })} value={total} /></Card></Col>
      </Row>
      <Modal
        title={t('common.uploadPreview')}
        open={uploadModalOpen}
        onCancel={() => { setUploadModalOpen(false); setUploadRecords([]); }}
        onOk={handleUploadConfirm}
        confirmLoading={uploading}
        width={800}
      >
        <p>{t('common.total', { count: uploadRecords.length })}</p>
        <Table
          dataSource={uploadRecords.slice(0, 50)} columns={[
            { title: t('common.date'), dataIndex: 'entryDate', width: 100 },
            { title: t('retail.product'), dataIndex: 'productName', width: 100 },
            { title: '磅单号', dataIndex: 'weighNo', width: 100 },
            { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', width: 120 },
            { title: t('weighing.senderName'), dataIndex: 'senderName', width: 120, ellipsis: true },
            { title: t('weighing.receiverName'), dataIndex: 'receiverName', width: 120, ellipsis: true },
            { title: t('common.weightKg'), dataIndex: 'weightKg', width: 100, render: (v: number | undefined) => v?.toLocaleString() ?? '-' },
          ]} rowKey="vehicleNo" size="small" pagination={false} scroll={{ y: 300 }}
        />
        {uploadRecords.length > 50 && <p style={{ marginTop: 8, color: '#999' }}>...{t('common.andMore', { count: uploadRecords.length - 50 })}</p>}
      </Modal>
    </div>
  );
}
