import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Card, Table, Button, Space, DatePicker, Input, Modal, Form, message, Popconfirm, Tag, Statistic, Select, Upload } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined, SearchOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { getTrainEntryList, createTrainEntry, updateTrainEntry, deleteTrainEntry, batchCreateTrainEntry, TrainEntryRecord } from '@/api/trainEntry';
import { getProductOptions, getEntityOptions } from '@/api/client';

const { RangePicker } = DatePicker;
const { TextArea } = Input;

export default function TrainEntryPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<TrainEntryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TrainEntryRecord | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [productOpts, setProductOpts] = useState<{value: string; label: string}[]>([]);
  const [entityOpts, setEntityOpts] = useState<{value: string; label: string}[]>([]);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadRecords, setUploadRecords] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

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

  const openAdd = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({ entryDate: dayjs() });
    setModalOpen(true);
  };

  const openEdit = (record: TrainEntryRecord) => {
    setEditingRecord(record);
    form.setFieldsValue({ ...record, entryDate: dayjs(record.entryDate) });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload = {
        entryDate: values.entryDate.format('YYYY-MM-DD'),
        productName: values.productName,
        vehicleNo: values.vehicleNo,
        weighNo: values.weighNo || '',
        senderName: values.senderName || '',
        receiverName: values.receiverName || '',
        weightKg: values.weightKg ? Number(values.weightKg) : undefined,
        remark: values.remark || '',
      };
      if (editingRecord) {
        await updateTrainEntry(editingRecord.id, payload);
        message.success(t('common.updated'));
      } else {
        await createTrainEntry(payload);
        message.success(t('common.created'));
      }
      setModalOpen(false);
      fetchData();
    } catch { /* validation failed */ }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    await deleteTrainEntry(id);
    message.success(t('common.deleted'));
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
    } finally {
      setUploading(false);
    }
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'entryDate', key: 'entryDate', width: 100 },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 100, render: (v: string) => t(`product.${v}`, { defaultValue: v }) },
    { title: '磅单号', dataIndex: 'weighNo', key: 'weighNo', width: 100 },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 120 },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 150, ellipsis: true },
    { title: t('weighing.receiverName'), dataIndex: 'receiverName', key: 'receiverName', width: 150, ellipsis: true },
    { title: t('common.weightKg'), dataIndex: 'weightKg', key: 'weightKg', width: 100, render: (v: number | null) => v?.toLocaleString() ?? '-' },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', ellipsis: true, width: 150 },
    {
      title: t('common.edit'), key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: TrainEntryRecord) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title={t('common.deleteConfirm')} onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={t('common.trainEntry')}
        extra={
          <Space>
            <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
            <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>{t('common.reset')}</Button>
            <Button icon={<UploadOutlined />} onClick={() => document.getElementById('train-upload-input')?.click()}>{t('common.import')}</Button>
            <input id="train-upload-input" type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])} />
            <Button icon={<PlusOutlined />} type="primary" onClick={openAdd}>{t('common.add')}</Button>
          </Space>
        }
      >
        <Table
          dataSource={data} columns={columns} rowKey="id"
          loading={loading} size="small"
          pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (tot) => t('common.total', { count: tot }) }}
          scroll={{ x: 1100 }}
        />
      </Card>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={4}><Card size="small"><Statistic title={t('common.total', { count: total })} value={total} /></Card></Col>
      </Row>

      <Modal
        title={editingRecord ? t('common.edit') : t('common.addTrainEntry')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="entryDate" label={t('common.date')} rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="productName" label={t('retail.product')} rules={[{ required: true }]}>
            <Select showSearch placeholder={t('common.select')} options={productOpts} />
          </Form.Item>
          <Form.Item name="weighNo" label="磅单号">
            <Input placeholder="磅单号" />
          </Form.Item>
          <Form.Item name="vehicleNo" label={t('common.vehicleNo')} rules={[{ required: true }]}>
            <Input placeholder="01KG000AA" />
          </Form.Item>
          <Form.Item name="senderName" label={t('weighing.senderName')}>
            <Select showSearch allowClear placeholder={t('common.select')} options={entityOpts} />
          </Form.Item>
          <Form.Item name="receiverName" label={t('weighing.receiverName')}>
            <Select showSearch allowClear placeholder={t('common.select')} options={entityOpts} />
          </Form.Item>
          <Form.Item name="weightKg" label={t('common.weightKg')}>
            <Input type="number" placeholder={t('common.netWeight')} />
          </Form.Item>
          <Form.Item name="remark" label={t('weighing.remark')}>
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
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
