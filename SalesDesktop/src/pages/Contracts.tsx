import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Space, message } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getContracts, createContract, updateContract, Contract } from '@/api/contracts';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';

export default function Contracts() {
  const { t } = useTranslation();
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  useEffect(() => {
    setLoading(true);
    getContracts({ sort_by: 'contractNo', sort_dir: 'asc', page: 1, page_size: 1000 })
      .then((res) => { setData(res.items); })
      .finally(() => setLoading(false));
  }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<Contract> }>) => {
    setSaving(true);
    try {
      for (const change of changes) {
        if (change.id > 0) {
          await updateContract(change.id, change.data);
        } else {
          await createContract(change.data);
        }
      }
      message.success('保存成功');
      setEditing(false);
      getContracts({ sort_by: 'contractNo', sort_dir: 'asc', page: 1, page_size: 1000 })
        .then((res) => { setData(res.items); });
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
      await updateContract(id, { [field]: value });
    }
  };

  const handleAddNew = useCallback((row: any) => {
    const newRow: Contract = {
      ...row,
      signedDate: dayjs().format('YYYY-MM-DD'),
      effectiveStart: dayjs().format('YYYY-MM-DD'),
      effectiveEnd: dayjs().add(1, 'year').format('YYYY-MM-DD'),
    } as Contract;
    setData(prev => [...prev, newRow]);
  }, []);

  const columns = [
    { title: t('common.contractNo'), dataIndex: 'contractNo', key: 'contractNo', width: 150, editable: true },
    { title: t('common.customerName'), dataIndex: 'customerName', key: 'customerName', width: 180, editable: true },
    { title: t('retail.product'), dataIndex: 'productName', key: 'productName', width: 100, editable: true },
    { title: t('common.signedDate'), dataIndex: 'signedDate', key: 'signedDate', width: 100, editable: true },
    { title: t('common.effectiveStart'), dataIndex: 'effectiveStart', key: 'effectiveStart', width: 100, editable: true },
    { title: t('common.effectiveEnd'), dataIndex: 'effectiveEnd', key: 'effectiveEnd', width: 100, editable: true },
    { title: t('common.plannedTons'), dataIndex: 'quantityTons', key: 'quantityTons', width: 100, editable: true },
    { title: t('common.executedTons'), dataIndex: 'executedTons', key: 'executedTons', width: 100, editable: true },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, flex: 1 }}>{t('nav.contracts')}</h2>
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
      <ExcelTable
        ref={tableRef}
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={setEditing}
        isAdmin={false}
        onBatchSave={handleBatchSave}
        onRealTimeSave={handleRealTimeSave}
        onAddNew={handleAddNew}
        rowHeight={40}
        height={600}
      />
    </div>
  );
}
