import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Button, Space, message } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getContracts, createContract, updateContract, Contract } from '@/api/contracts';
import ExcelTable from '@/components/common/ExcelTable';

export default function Contracts() {
  const { t } = useTranslation();
  const [data, setData] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<number, any>>({});
  const tempIdCounter = useRef(0);
  const [saving, setSaving] = useState(false);

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
    setEditData(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));

    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateContract(id, { [field]: value });
    }
  };

  const addNewRow = useCallback(() => {
    const tempId = --tempIdCounter.current;
    const blankRow: any = {
      id: tempId,
      contractNo: '',
      customerName: '',
      productName: '',
      signedDate: dayjs().format('YYYY-MM-DD'),
      effectiveStart: dayjs().format('YYYY-MM-DD'),
      effectiveEnd: dayjs().add(1, 'year').format('YYYY-MM-DD'),
      quantityTons: 0,
      executedTons: 0,
    };

    setEditData(prev => ({ ...prev, [tempId]: blankRow }));
  }, [tempIdCounter]);

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
    <Card
      title={t('nav.contracts')}
      extra={
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={addNewRow} disabled={editing}>
            {editing ? t('common.add') : t('common.edit')}
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
