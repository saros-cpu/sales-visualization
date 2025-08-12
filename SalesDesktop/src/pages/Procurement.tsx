import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Space, DatePicker, Button, message } from 'antd';
import { SearchOutlined, ReloadOutlined, PlusOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getProcurementDetails, ProcurementItem } from '@/api/procurement';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';

const { RangePicker } = DatePicker;

export default function Procurement() {
  const { t } = useTranslation();
  const [data, setData] = useState<ProcurementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getProcurementDetails({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page: 1, page_size: 1000,
      });
      setData(res.data.items);
      setTotal(res.data.total);
    } finally { setLoading(false); }
  }, [dates]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<ProcurementItem> }>) => {
    setSaving(true);
    try {
      for (const change of changes) {
        await updateProcurementDetails(change.id, change.data);
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

    await updateProcurementDetails(id, { [field]: value });
  };

  const updateProcurementDetails = async (id: number, data: Partial<ProcurementItem>) => {
    // 这里需要调用后端 API
    // await client.put(`/procurement/${id}`, data);
    console.log('Updating procurement:', id, data);
  };

  const columns = [
    { title: t('common.date'), dataIndex: 'businessDate', key: 'businessDate', width: 140, editable: true },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 110, editable: true },
    { title: t('weighing.senderName'), dataIndex: 'senderName', key: 'senderName', width: 140, editable: true },
    { title: t('common.weightTons'), dataIndex: 'weightTons', key: 'weightTons', width: 110, editable: true },
    { title: t('common.source'), dataIndex: 'weighSource', key: 'weighSource', width: 120, editable: true },
    { title: t('weighing.remark'), dataIndex: 'remark', key: 'remark', width: 150, editable: true },
  ];

  return (
    <Card
      title={t('nav.procurement')}
      extra={
        <Space wrap>
          <RangePicker value={dates} onChange={(v) => v && setDates(v as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { fetchData(); }}>{t('common.reset')}</Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => tableRef.current?.addNewRow()} disabled={!editing}>
            {t('common.add')}
          </Button>
          {editing && (
            <>
              <Button icon={<SaveOutlined />} type="primary" onClick={async () => { await tableRef.current?.saveAllChanges(); setEditing(false); }} loading={saving}>
                {t('common.save')}
              </Button>
              <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </>
          )}
          {!editing && (
            <Button onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
        </Space>
      }
    >
      <ExcelTable
        ref={tableRef}
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
