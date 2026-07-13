import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Card, Tabs, Button, Space, message, Select, Table, Popconfirm } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import client from '@/api/client';
import {
  getCategories, getMaterials, createMaterial, deleteMaterial, Material, MaterialCategory,
  getDepots, DepotOption,
  getInboundList, createInbound, InboundRecord,
  getTransferOrders, createTransferOrder, updateOrderStatus, TransferOrder,
  getInventory, InventoryItem,
} from '@/api/materials';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';
import { KpiGrid } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

function MaterialDictTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canCreate = can('materials:create');
  const canUpdate = can('materials:update');
  const canDelete = can('materials:delete');
  const canEdit = canCreate || canUpdate;
  const [data, setData] = useState<Material[]>([]);
  const [cats, setCats] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
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
      message.success(`${t('common.save')} ${t('common.success')}`);
      setEditing(false);
      fetchData();
    } catch {
      message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const updateMaterial = async (id: number, data: Partial<Material>) => {
    await client.put(`/materials/${id}`, data);
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as Material]);
  }, []);

  const nextMaterialCode = useMemo(() => {
    const maxNo = data.reduce((max, row) => {
      const match = /^A(\d+)$/.exec(row.material_code || '');
      if (!match) return max;
      return Math.max(max, Number(match[1]) || 0);
    }, 0);
    return `A${String(maxNo + 1).padStart(4, '0')}`;
  }, [data]);

  const defaultCategoryId = useMemo(
    () => cats.find((cat) => cat.category_code === 'other')?.id ?? cats[0]?.id,
    [cats],
  );

  const handleAddRow = useCallback(() => {
    setEditing(true);
    window.setTimeout(() => tableRef.current?.addNewRow(), 0);
  }, []);

  const handleDeleteMaterials = useCallback(async (ids: number[]) => {
    if (!canDelete) throw new Error(t('common.noPermission'));
    try {
      for (const id of ids.filter((item) => item > 0)) {
        await deleteMaterial(id);
      }
      setData(prev => prev.filter(row => !ids.includes(row.id)));
    } catch (error: any) {
      if (error?.response?.data?.code === 4092) {
        throw new Error(t('materials.deleteInUse'));
      }
      throw new Error(t('common.deleteFailedRetry'));
    }
  }, [canDelete, t]);

  const validateMaterialRow = useCallback((row: Partial<Material>) => {
    const errors: Record<string, string> = {};
    if (!String(row.material_code || '').trim()) errors.material_code = t('materials.materialNo') + ' ' + t('common.required');
    if (!String(row.name_zh || '').trim()) errors.name_zh = t('common.nameZh') + ' ' + t('common.required');
    if (!row.category_id) errors.category_id = t('materials.category') + ' ' + t('common.required');
    if (!String(row.unit || '').trim()) errors.unit = t('materials.unit') + ' ' + t('common.required');
    return errors;
  }, [t]);

  const centerAlign = { align: 'center' as const };

  const columns = [
    { title: t('materials.materialNo'), dataIndex: 'material_code', key: 'material_code', width: 100, editable: true, required: true, ...centerAlign },
    { title: t('common.nameZh'), dataIndex: 'name_zh', key: 'name_zh', editable: true, required: true, ...centerAlign },
    { title: t('common.nameRu'), dataIndex: 'name_ru', key: 'name_ru', editable: true, ...centerAlign },
    {
      title: t('materials.category'),
      dataIndex: 'category_id',
      key: 'category_id',
      width: 140,
      editable: true,
      required: true,
      ...centerAlign,
      editorType: 'select' as const,
      editorOptions: cats.map((cat) => ({ value: cat.id, label: cat.name_zh })),
      render: (value: number, record: Material) => cats.find((cat) => cat.id === value)?.name_zh || record.category_name || '-',
    },
    { title: t('common.spec'), dataIndex: 'specification', key: 'specification', editable: true, ...centerAlign },
    { title: t('materials.unit'), dataIndex: 'unit', key: 'unit', width: 60, editable: true, required: true, ...centerAlign },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80, editable: true, editorType: 'number' as const, ...centerAlign },
    {
      title: t('materials.status'),
      dataIndex: 'is_active',
      key: 'is_active',
      width: 90,
      editable: true,
      ...centerAlign,
      editorType: 'select' as const,
      editorOptions: [
        { value: 1, label: t('materials.active') },
        { value: 0, label: t('materials.inactive') },
      ],
      render: (value: boolean | number) => Number(value) ? t('materials.active') : t('materials.inactive'),
    },
  ];

  return (
    <div className="client-fit-page">
      <Space wrap className="client-fit-fixed">
        {canCreate && (
          <Button icon={<PlusOutlined />} type="primary" onClick={handleAddRow}>
            {t('common.add')}
          </Button>
        )}
        {canDelete && (
          <Popconfirm
            title={t('common.deleteConfirm')}
            okText={t('common.confirm')}
            cancelText={t('common.cancel')}
            onConfirm={() => tableRef.current?.deleteSelectedRows()}
          >
            <Button danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0}>
              {selectedIds.length > 0 ? `${t('common.delete')} (${selectedIds.length})` : t('common.delete')}
            </Button>
          </Popconfirm>
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
      <div className="client-fit-table-scroll">
        <ExcelTable
          ref={tableRef}
          dataSource={data}
          columns={columns}
          editing={editing}
          setEditing={(value) => setEditing(canEdit && value)}
          isAdmin={false}
          canDelete={canDelete}
          onBatchSave={handleBatchSave}
          onAddNew={handleAddNew}
          onDelete={handleDeleteMaterials}
          onSelectionChange={setSelectedIds}
          validateRow={validateMaterialRow}
          initialNewRow={() => ({
            material_code: nextMaterialCode,
            category_id: defaultCategoryId,
            unit: '\u4e2a',
            unit_price: 0,
            is_active: true,
          })}
          draftKey="material-dict-spreadsheet-draft"
          rowHeight={40}
          height="100%"
        />
      </div>
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
  const [materials, setMaterials] = useState<Material[]>([]);
  const [depots, setDepots] = useState<DepotOption[]>([]);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getInboundList({ page: 1, page_size: 1000 });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    Promise.all([getMaterials(), getDepots()]).then(([m, d]) => {
      setMaterials(Array.isArray(m) ? m : (m?.data ?? []));
      setDepots(Array.isArray(d) ? d : (d?.data ?? []));
    });
  }, []);

  const materialOptions = useMemo(
    () => materials.map((item) => ({ value: item.id, label: item.name_zh || item.name_ru || item.material_code })),
    [materials],
  );
  const depotOptions = useMemo(
    () => depots.map((item) => ({ value: item.id, label: item.name_zh || item.name_ru || item.depot_code })),
    [depots],
  );
  const materialName = useCallback(
    (value: number, record: InboundRecord) => materials.find((item) => item.id === value)?.name_zh || record.material_name || '-',
    [materials],
  );
  const depotName = useCallback(
    (value: number, record: InboundRecord) => depots.find((item) => item.id === value)?.name_zh || record.depot_name || '-',
    [depots],
  );

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
    {
      title: t('materials.name'),
      dataIndex: 'material_id',
      key: 'material_id',
      editable: true,
      editorType: 'select' as const,
      editorOptions: materialOptions,
      render: materialName,
    },
    {
      title: t('common.warehouse'),
      dataIndex: 'depot_id',
      key: 'depot_id',
      width: 120,
      editable: true,
      editorType: 'select' as const,
      editorOptions: depotOptions,
      render: depotName,
    },
    { title: t('common.supplier'), dataIndex: 'supplier_name', key: 'supplier_name', editable: true },
    { title: t('common.qty'), dataIndex: 'quantity', key: 'quantity', width: 80, editable: true },
    { title: t('common.unitPrice'), dataIndex: 'unit_price', key: 'unit_price', width: 80, editable: true },
    { title: t('common.totalAmount'), dataIndex: 'total_amount', key: 'total_amount', width: 100, editable: true },
    { title: t('common.invoiceNo'), dataIndex: 'invoice_no', key: 'invoice_no', width: 120, editable: true },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', editable: true },
  ];

  return (
    <div className="client-fit-page">
      <Space wrap className="client-fit-fixed">
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
      <div className="client-fit-table-scroll">
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
          height="100%"
        />
      </div>
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
  const [materials, setMaterials] = useState<Material[]>([]);
  const [depots, setDepots] = useState<DepotOption[]>([]);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    const res = await getTransferOrders({ page: 1, page_size: 1000 });
      setData(res?.items ?? []);
      setTotal(res?.total ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    Promise.all([getMaterials(), getDepots()]).then(([m, d]) => {
      setMaterials(Array.isArray(m) ? m : (m?.data ?? []));
      setDepots(Array.isArray(d) ? d : (d?.data ?? []));
    });
  }, []);

  const materialOptions = useMemo(
    () => materials.map((item) => ({ value: item.id, label: item.name_zh || item.name_ru || item.material_code })),
    [materials],
  );
  const depotOptions = useMemo(
    () => depots.map((item) => ({ value: item.id, label: item.name_zh || item.name_ru || item.depot_code })),
    [depots],
  );
  const materialName = useCallback(
    (value: number, record: TransferOrder) => materials.find((item) => item.id === value)?.name_zh || record.material_name || '-',
    [materials],
  );
  const fromDepotName = useCallback(
    (value: number, record: TransferOrder) => depots.find((item) => item.id === value)?.name_zh || record.from_depot_name || '-',
    [depots],
  );
  const toDepotName = useCallback(
    (value: number, record: TransferOrder) => depots.find((item) => item.id === value)?.name_zh || record.to_depot_name || '-',
    [depots],
  );
  const materialUnit = useCallback(
    (_: any, record: TransferOrder) => record.material_unit || materials.find((item) => item.id === record.material_id)?.unit || '-',
    [materials],
  );

  const validateRow = useCallback((row: Partial<TransferOrder>) => {
    const errors: Record<string, string> = {};
    if (!row.order_date) errors.order_date = t('common.date') + ' ' + t('common.required');
    if (!row.from_depot_id) errors.from_depot_id = t('common.fromWarehouse') + ' ' + t('common.required');
    if (!row.to_depot_id) errors.to_depot_id = t('common.toWarehouse') + ' ' + t('common.required');
    if (row.from_depot_id && row.to_depot_id && row.from_depot_id === row.to_depot_id) errors.to_depot_id = t('materials.sameWarehouseError');
    if (!row.material_id) errors.material_id = t('materials.name') + ' ' + t('common.required');
    const qty = Number(row.requested_qty ?? 0);
    if (!qty || qty <= 0) errors.requested_qty = t('common.qty') + ' ' + t('common.required');
    return errors;
  }, [t]);

  const transferKpis = useMemo(() => {
    const invalidRows = data.filter(row => Object.keys(validateRow(row)).length > 0);
    const pendingRows = data.filter(row => row.status === 'pending').length;
    const totalQty = data.reduce((sum, row) => sum + Number(row.requested_qty || 0), 0);
    return [
      { key: 'rows', title: t('common.currentBatch'), value: data.length, suffix: t('common.rows') },
      { key: 'pending', title: t('common.pending'), value: pendingRows, suffix: t('common.rows'), goodWhen: 'down' as const, tone: pendingRows ? 'warning' as const : 'success' as const },
      { key: 'invalid', title: t('common.invalidRows'), value: invalidRows.length, suffix: t('common.rows'), goodWhen: 'down' as const, tone: invalidRows.length ? 'danger' as const : 'success' as const },
      { key: 'qty', title: t('common.qty'), value: totalQty, precision: 2 },
    ];
  }, [data, t, validateRow]);

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
          const { status, ...rest } = change.data as Partial<TransferOrder>;
          if (Object.keys(rest).length > 0) await updateTransferOrder(change.id, rest);
          if (status) await updateOrderStatus(change.id, status);
        } else {
          await createTransferOrder(change.data);
        }
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
      if (field === 'status') await updateOrderStatus(id, value);
      else await updateTransferOrder(id, { [field]: value });
    }
  };

  const updateTransferOrder = async (id: number, data: Partial<TransferOrder>) => {
    await client.put(`/materials/orders/${id}`, data);
  };

  const handleAddNew = useCallback((row: any) => {
    setData(prev => [...prev, row as TransferOrder]);
  }, []);

  const columns = [
    { title: t('common.date'), dataIndex: 'order_date', key: 'order_date', width: 120, editable: true, required: true, editorType: 'date' as const },
    {
      title: t('common.fromWarehouse'),
      dataIndex: 'from_depot_id',
      key: 'from_depot_id',
      width: 150,
      editable: true,
      required: true,
      editorType: 'select' as const,
      editorOptions: depotOptions,
      render: fromDepotName,
    },
    {
      title: t('common.toWarehouse'),
      dataIndex: 'to_depot_id',
      key: 'to_depot_id',
      width: 150,
      editable: true,
      required: true,
      editorType: 'select' as const,
      editorOptions: depotOptions,
      render: toDepotName,
    },
    {
      title: t('materials.name'),
      dataIndex: 'material_id',
      key: 'material_id',
      width: 160,
      editable: true,
      required: true,
      editorType: 'select' as const,
      editorOptions: materialOptions,
      render: materialName,
    },
    { title: t('common.qty'), dataIndex: 'requested_qty', key: 'requested_qty', width: 100, editable: true, required: true, editorType: 'number' as const },
    { title: t('materials.unit'), dataIndex: 'material_unit', key: 'material_unit', width: 80, render: materialUnit },
    { title: t('common.handler'), dataIndex: 'handler_name', key: 'handler_name', width: 120, editable: true },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 120,
      editable: true,
      editorType: 'select' as const,
      editorOptions: [
        { value: 'pending', label: t('materials.statusPending') },
        { value: 'approved', label: t('materials.statusApproved') },
        { value: 'completed', label: t('materials.statusCompleted') },
      ],
    },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', editable: true },
  ];

  return (
    <div className="client-fit-page">
      <div className="client-fit-fixed">
        <KpiGrid items={transferKpis} defaultSpan={6} />
      </div>
      <Space wrap className="client-fit-fixed">
        {canCreate && (
          <Button icon={<PlusOutlined />} type="primary" onClick={() => { if (!editing) setEditing(true); tableRef.current?.addNewRow(); }}>
            {t('common.add')}
          </Button>
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
      <div className="client-fit-table-scroll">
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
          validateRow={validateRow}
          initialNewRow={() => ({ order_date: new Date().toISOString().slice(0, 10), status: 'pending' })}
          draftKey="material-transfer-spreadsheet-draft"
          rowHeight={40}
          height="100%"
        />
      </div>
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
    <div className="client-fit-page">
      <Space wrap className="client-fit-fixed">
        <Select value={depotId} onChange={setDepotId} allowClear placeholder={t('common.filterWarehouse')} style={{ width: 150 }}>
          <Select.Option value={1}>{t('common.defaultWarehouse')}</Select.Option>
        </Select>
      </Space>
      <div className="client-fit-table-scroll">
        <Table dataSource={data} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 800 }} />
      </div>
    </div>
  );
}

export default function MaterialsPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('common.materialsManagement')} className="client-fit-page client-fit-table-card">
      <Tabs className="client-fit-tabs" items={[
        { key: 'dict', label: t('common.materialDict'), children: <MaterialDictTab /> },
        { key: 'inbound', label: t('common.inboundMgmt'), children: <InboundTab /> },
        { key: 'orders', label: t('common.transferOrders'), children: <TransferOrdersTab /> },
        { key: 'inventory', label: t('common.inventory'), children: <InventoryTab /> },
      ]} />
    </Card>
  );
}
