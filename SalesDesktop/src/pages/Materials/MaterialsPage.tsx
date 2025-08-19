import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Tabs, Button, Space, message, Select, Table } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import client from '@/api/client';
import {
  getCategories, getMaterials, createMaterial, Material, MaterialCategory,
  getDepots, DepotOption,
  getInboundList, createInbound, InboundRecord,
  getTransferOrders, createTransferOrder, updateOrderStatus, TransferOrder,
  getInventory, InventoryItem,
} from '@/api/materials';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';
import { useAuth } from '@/contexts/AuthContext';

function MaterialDictTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canCreate = can('materials:create');
  const canUpdate = can('materials:update');
  const canEdit = canCreate || canUpdate;
  const [data, setData] = useState<Material[]>([]);
  const [cats, setCats] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    const [m, c] = await Promise.all([getMaterials(), getCategories()]);
    setData(Array.isArray(m) ? m : (m?.data ?? []));
    setCats(Array.isArray(c) ? c : (c?.data ?? []));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<Material> }>) => {
    if (
      (changes.some((change) => change.id < 0) && !canCreate) ||
      (changes.some((change) => change.id > 0) && !canUpdate)
    ) {
      message.error(t('common.noPermission'));
      return;
    }
    setSaving(true);
    try {
      for (const change of changes) {
        if (change.id > 0) {
          await updateMaterial(change.id, change.data);
        } else {
          await createMaterial(change.data);
        }
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
    if (id > 0 && !canUpdate) return;
    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateMaterial(id, { [field]: value });
    }
  };

  const updateMaterial = async (id: number, data: Partial<Material>) => {
    await client.put(`/materials/${id}`, data);
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as Material]);
  }, []);

  const columns = [
    { title: t('common.code'), dataIndex: 'material_code', key: 'material_code', width: 100, editable: true },
    { title: t('common.nameZh'), dataIndex: 'name_zh', key: 'name_zh', editable: true },
    { title: t('common.nameRu'), dataIndex: 'name_ru', key: 'name_ru', editable: true },
    {
      title: t('materials.category'),
      dataIndex: 'category_id',
      key: 'category_id',
      width: 140,
      editable: true,
      editorType: 'select' as const,
      editorOptions: cats.map((cat) => ({ value: cat.id, label: cat.name_zh })),
      render: (value: number, record: Material) => cats.find((cat) => cat.id === value)?.name_zh || record.category_name || '-',
    },
    { title: t('common.spec'), dataIndex: 'specification', key: 'specification', editable: true },
    { title: t('materials.unit'), dataIndex: 'unit', key: 'unit', width: 60, editable: true },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80, editable: true },
    { title: t('materials.status'), dataIndex: 'is_active', key: 'is_active', width: 70, editable: true },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        {canCreate && (
          <Button icon={<PlusOutlined />} type="primary" onClick={() => tableRef.current?.addNewRow()} disabled={!editing}>
            {t('common.add')}
          </Button>
        )}
        {editing && canEdit && (
          <>
            <Button icon={<SaveOutlined />} type="primary" onClick={async () => { await tableRef.current?.saveAllChanges(); setEditing(false); }} loading={saving}>
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
      <ExcelTable
        ref={tableRef}
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={(value) => setEditing(canEdit && value)}
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

function InboundTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canCreate = can('materials:create');
  const canUpdate = can('materials:update');
  const canEdit = canCreate || canUpdate;
  const [data, setData] = useState<InboundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getInboundList({ page: 1, page_size: 1000 });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<InboundRecord> }>) => {
    if (
      (changes.some((change) => change.id < 0) && !canCreate) ||
      (changes.some((change) => change.id > 0) && !canUpdate)
    ) {
      message.error(t('common.noPermission'));
      return;
    }
    setSaving(true);
    try {
      for (const change of changes) {
        if (change.id > 0) {
          await updateInbound(change.id, change.data);
        } else {
          await createInbound(change.data);
        }
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
    if (id > 0 && !canUpdate) return;
    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateInbound(id, { [field]: value });
    }
  };

  const updateInbound = async (id: number, data: Partial<InboundRecord>) => {
    await client.put(`/materials/inbound/${id}`, data);
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as InboundRecord]);
  }, []);

  const columns = [
    { title: t('common.date'), dataIndex: 'inbound_date', key: 'inbound_date', width: 100, editable: true },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name', editable: true },
    { title: t('common.warehouse'), dataIndex: 'depot_name', key: 'depot_name', width: 100, editable: true },
    { title: t('common.supplier'), dataIndex: 'supplier_name', key: 'supplier_name', editable: true },
    { title: t('common.qty'), dataIndex: 'quantity', key: 'quantity', width: 80, editable: true },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80, editable: true },
    { title: t('common.totalAmount'), dataIndex: 'total_amount', key: 'total_amount', width: 100, editable: true },
    { title: t('common.invoiceNo'), dataIndex: 'invoice_no', key: 'invoice_no', width: 120, editable: true },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', editable: true },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        {canCreate && (
          <Button icon={<PlusOutlined />} type="primary" onClick={() => tableRef.current?.addNewRow()} disabled={!editing}>
            {t('common.add')}
          </Button>
        )}
        {editing && canEdit && (
          <>
            <Button icon={<SaveOutlined />} type="primary" onClick={async () => { await tableRef.current?.saveAllChanges(); setEditing(false); }} loading={saving}>
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
      <ExcelTable
        ref={tableRef}
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={(value) => setEditing(canEdit && value)}
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

function TransferOrdersTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canCreate = can('materials:create');
  const canUpdate = can('materials:update');
  const canEdit = canCreate || canUpdate;
  const [data, setData] = useState<TransferOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getTransferOrders({ page: 1, page_size: 1000 });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<TransferOrder> }>) => {
    if (
      (changes.some((change) => change.id < 0) && !canCreate) ||
      (changes.some((change) => change.id > 0) && !canUpdate)
    ) {
      message.error(t('common.noPermission'));
      return;
    }
    setSaving(true);
    try {
      for (const change of changes) {
        if (change.id > 0) {
          await updateTransferOrder(change.id, change.data);
        } else {
          await createTransferOrder(change.data);
        }
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
    if (id > 0 && !canUpdate) return;
    setData(prev => prev.map(r =>
      r.id === id ? { ...r, [field]: value } : r
    ));

    if (id > 0) {
      await updateTransferOrder(id, { [field]: value });
    }
  };

  const updateTransferOrder = async (id: number, data: Partial<TransferOrder>) => {
    await client.put(`/materials/orders/${id}`, data);
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as TransferOrder]);
  }, []);

  const columns = [
    { title: t('common.orderNo'), dataIndex: 'order_no', key: 'order_no', width: 130, editable: true },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name', editable: true },
    { title: t('common.fromWarehouse'), dataIndex: 'from_depot_name', key: 'from_depot_name', width: 100, editable: true },
    { title: t('common.toWarehouse'), dataIndex: 'to_depot_name', key: 'to_depot_name', width: 100, editable: true },
    { title: t('common.qty'), dataIndex: 'requested_qty', key: 'requested_qty', width: 80, editable: true },
    { title: t('common.transportMode'), dataIndex: 'transport_mode', key: 'transport_mode', width: 80, editable: true },
    { title: t('common.vehicleNo'), dataIndex: 'vehicle_no', key: 'vehicle_no', width: 120, editable: true },
    { title: t('common.driver'), dataIndex: 'driver_name', key: 'driver_name', width: 80, editable: true },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', editable: true },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        {canCreate && (
          <Button icon={<PlusOutlined />} type="primary" onClick={() => tableRef.current?.addNewRow()} disabled={!editing}>
            {t('common.add')}
          </Button>
        )}
        {editing && canEdit && (
          <>
            <Button icon={<SaveOutlined />} type="primary" onClick={async () => { await tableRef.current?.saveAllChanges(); setEditing(false); }} loading={saving}>
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
      <ExcelTable
        ref={tableRef}
        dataSource={data}
        columns={columns}
        editing={editing}
        setEditing={(value) => setEditing(canEdit && value)}
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

function InventoryTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [depotId, setDepotId] = useState<number | undefined>();

  const fetchData = async () => {
    setLoading(true);
    const res = await getInventory(depotId);
    setData(Array.isArray(res) ? res : (res?.data ?? []));
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [depotId]);

  const columns = [
    { title: t('common.warehouse'), dataIndex: 'depot_name', key: 'depot_name' },
    { title: t('materials.name'), dataIndex: 'material_name', key: 'material_name' },
    { title: t('materials.unit'), dataIndex: 'unit', key: 'unit', width: 60 },
    { title: t('materials.inventoryQty'), dataIndex: 'quantity', key: 'quantity', width: 100 },
    { title: t('materials.lastInbound'), dataIndex: 'last_inbound_at', key: 'last_inbound_at', width: 160 },
    { title: t('materials.updatedAt'), dataIndex: 'updated_at', key: 'updated_at', width: 160 },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select value={depotId} onChange={setDepotId} allowClear placeholder={t('common.filterWarehouse')} style={{ width: 150 }}>
          <Select.Option value={1}>{t('common.defaultWarehouse')}</Select.Option>
        </Select>
      </Space>
      <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 800, y: 'calc(100vh - 360px)' }} />
    </div>
  );
}

export default function MaterialsPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('common.materialsManagement')}>
      <Tabs items={[
        { key: 'dict', label: t('common.materialDict'), children: <MaterialDictTab /> },
        { key: 'inbound', label: t('common.inboundMgmt'), children: <InboundTab /> },
        { key: 'orders', label: t('common.transferOrders'), children: <TransferOrdersTab /> },
        { key: 'inventory', label: t('common.inventory'), children: <InventoryTab /> },
      ]} />
    </Card>
  );
}
