import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, DatePicker, Space, Tabs, message } from 'antd';
import { ClearOutlined, DownloadOutlined, EditOutlined, PlusOutlined, SaveOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { uploadWholesaleDetailXlsx, manualCreateWholesaleDetail, updateWholesaleDetail } from '@/api/trainEntry';
import type { ManualWholesaleDetailPayload } from '@/api/trainEntry';
import { downloadWholesaleDetailsExport, getWholesaleDetails, getWholesaleDetailFilterOptions, type WholesaleItem } from '@/api/wholesale';
import ExcelTable, { type ColumnDefinition, type ExcelTableHandle } from '@/components/common/ExcelTable';
import BilingualName from '@/components/common/BilingualName';
import { KpiGrid } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

const { RangePicker } = DatePicker;
const ENTRY_PAGE_SIZE = 50;

interface EntryRow {
  id: number;
  businessDate: string;
  transportMode: string;
  weighSerialNo: string;
  productName: string;
  rawProductName?: string;
  standardProductName?: string;
  vehicleNo: string;
  senderName: string;
  standardSenderName?: string;
  entityName: string;
  rawEntityName?: string;
  standardEntityName?: string;
  classification: string;
  weightKg: number | string;
  weightTons?: number;
  sourceType?: string;
  sourceRowNumber?: number | string | null;
  matchStatus?: string;
  importBatchId?: number | string | null;
  remark: string;
  createdAt?: string;
}

type CustomerOption = { value: string; label: string; customerType?: string };

export default function TrainEntryPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canEntry = can('wholesale_entry:create');
  const canUpdate = can('wholesale_entry:update');
  const entryTableRef = useRef<ExcelTableHandle>(null);
  const maintenanceTableRef = useRef<ExcelTableHandle>(null);
  const [data, setData] = useState<EntryRow[]>([]);
  const [draftRows, setDraftRows] = useState<EntryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'entry' | 'maintenance'>('entry');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [productOpts, setProductOpts] = useState<{ value: string; label: string }[]>([]);
  const [customerOpts, setCustomerOpts] = useState<CustomerOption[]>([]);

  const processingSenderValues = useMemo(() => new Set([
    'Р‘РђР™Р­Р›Р¬-Р—',
    'OcOO  вЂњРЎРїРµРєС‚СЂСѓРј РџРµС‚СЂРѕР»РµСѓРјвЂќ',
    'РћРЎРћРћ "РђР РўР­Р›Р¬  Р“Р РЈРџРџ"',
    'Р‘РµС‚С‚Р° РўСЂРµР№Рґ',
    'РћСЃРћРћ "РџСЂРѕРјРµС‚РµР№"',
  ]), []);

  const senderOptions = useMemo(() => [
    {
      value: 'дё­е¤§дё­е›ЅзџіжІ№е…¬еЏё / РћСЃРћРћ Р§Р°Р№РЅР° РџРµС‚СЂРѕР»СЊ РљРѕРјРїР°РЅРё Р”Р¶СѓРЅРґР°',
      label: t('wholesaleEntry.senderZd'),
    },
    {
      value: 'жІ№ж°”е…¬еЏё / РћСЃРћРћ РљС‹СЂРіС‹Р·СЃРєР°СЏ РїСЂРѕРјС‹С€Р»РµРЅРЅР°СЏ РєРѕРјРїР°РЅРёСЏ РЅРµС„С‚СЊ Рё РіР°Р· (РљРџРљ)',
      label: t('wholesaleEntry.senderCustomerSAbbr'),
    },
    { value: 'Р‘РђР™Р­Р›Р¬-Р—', label: t('wholesaleEntry.senderCustomerH') },
    { value: 'OcOO  вЂњРЎРїРµРєС‚СЂСѓРј РџРµС‚СЂРѕР»РµСѓРјвЂќ', label: t('wholesaleEntry.senderCustomerF') },
    { value: 'РћРЎРћРћ "РђР РўР­Р›Р¬  Р“Р РЈРџРџ"', label: t('wholesaleEntry.senderCustomerE') },
    { value: 'Р‘РµС‚С‚Р° РўСЂРµР№Рґ', label: t('wholesaleEntry.senderCustomerG') },
    { value: 'РћСЃРћРћ "РџСЂРѕРјРµС‚РµР№"', label: t('wholesaleEntry.senderCustomerJ') },
  ], [t]);

  const transportOptions = useMemo(() => [
    { value: 'truck', label: t('transport.truck') },
    { value: 'train', label: t('transport.train') },
  ], [t]);

  const classificationOptions = useMemo(() => [
    { value: 'unknown', label: t('wholesale.unknown') },
    { value: 'local_wholesale', label: t('wholesale.local_wholesale') },
    { value: 'export_wholesale', label: t('wholesale.export_wholesale') },
    { value: 'transfer', label: t('wholesale.transferClass') },
    { value: 'processing', label: t('wholesale.processing') },
    { value: 'procurement', label: t('wholesale.procurement') },
  ], [t]);

  const mapItem = (item: WholesaleItem): EntryRow => {
    const numericId = Number(item.sourceId ?? item.id);
    const weightKg = Number(item.weightKg ?? (Number(item.weightTons || 0) * 1000));
    return {
      id: Number.isFinite(numericId) ? numericId : Number(item.id),
      businessDate: item.businessDate,
      transportMode: item.transportMode || 'truck',
      weighSerialNo: item.weighSerialNo || '',
      productName: item.rawProductName || item.productName || '',
      rawProductName: item.rawProductName,
      standardProductName: item.standardProductName,
      vehicleNo: item.vehicleNo || '',
      senderName: item.senderName || '',
      standardSenderName: item.standardSenderName,
      entityName: item.rawEntityName || item.entityName || '',
      rawEntityName: item.rawEntityName,
      standardEntityName: item.standardEntityName,
      classification: item.classification || 'unknown',
      weightKg: Number.isFinite(weightKg) ? weightKg : '',
      weightTons: Number(item.weightTons || 0),
      sourceType: item.sourceType || item.weighSource,
      sourceRowNumber: item.sourceRowNumber,
      matchStatus: item.matchStatus,
      importBatchId: item.importBatchId,
      remark: item.remark || '',
      createdAt: item.createdAt,
    };
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWholesaleDetails({
        data_source: 'uploaded',
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        page: 1,
        page_size: 2000,
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      setData(items.map(mapItem));
      setTotal(Number(res?.total ?? items.length));
      setPage(1);
    } finally {
      setLoading(false);
    }
  }, [dates]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    getWholesaleDetailFilterOptions().then((options) => {
      setProductOpts(options.products || []);
      const customerList = (Array.isArray(options.companies) ? options.companies : [])
        .map((item: any) => ({
          value: String(item.value || ''),
          label: String(item.label || ''),
          customerType: item.customerType,
        }))
        .filter((item) => item.value);
      customerList.sort((a, b) => a.label.localeCompare(b.label));
      setCustomerOpts(customerList);
    });
  }, []);

  const sourceLabel = (value?: string) => t(`wholesale.sources.${value || 'unknown'}`, { defaultValue: value || '--' });
  const matchStatusLabel = (value?: string) => t(`common.${value || 'unknown'}`, { defaultValue: value || '--' });
  const displayCustomerName = (raw?: string, standard?: string) => (
    <BilingualName value={standard} raw={raw} />
  );
  const displayProductName = (raw?: string, standard?: string) => (
    <BilingualName value={standard} raw={raw} />
  );

  const entryKpis = useMemo(() => {
    const totalTons = data.reduce((sum, row) => sum + Number(row.weightTons || Number(row.weightKg || 0) / 1000), 0);
    const draftCount = draftRows.length;
    const manualRows = data.filter((row) => (row.sourceType || '') === 'manual').length;
    const importedRows = data.filter((row) => row.id > 0 && (row.sourceType || '') !== 'manual').length;
    return [
      { key: 'rows', title: t('common.rows'), value: total, suffix: t('common.rows') },
      { key: 'imported', title: t('wholesaleEntry.importedRows'), value: importedRows, suffix: t('common.rows') },
      { key: 'manual', title: t('wholesaleEntry.manualRows'), value: manualRows, suffix: t('common.rows') },
      { key: 'draft', title: t('common.unsavedRows'), value: draftCount, suffix: t('common.rows') },
      { key: 'tons', title: t('common.weightTons'), value: totalTons, precision: 3, suffix: 't' },
    ];
  }, [data, draftRows.length, t, total]);

  const defaultClassification = (row: Partial<EntryRow>) => {
    if (row.classification && row.classification !== 'unknown') return row.classification;
    if (processingSenderValues.has(String(row.senderName || ''))) return 'processing';
    const customer = customerOpts.find((item) => item.value === row.entityName);
    if (customer?.customerType === 'local_wholesale' || customer?.customerType === 'export_wholesale') {
      return customer.customerType;
    }
    return row.classification || 'unknown';
  };

  const validateRow = (row: Partial<EntryRow>) => {
    const errors: Record<string, string> = {};
    if (!row.businessDate) errors.businessDate = t('common.required');
    if (!row.productName) errors.productName = t('common.required');
    if (!row.entityName) errors.entityName = t('common.required');
    if (!row.senderName) errors.senderName = t('common.required');
    if (!(Number(row.weightKg) > 0)) errors.weightKg = t('common.required');
    return errors;
  };

  const handleBatchSave = async (changes: Array<{ id: number; data: Partial<EntryRow> }>) => {
    const newRows = changes.filter((change) => change.id < 0);
    const existingRows = changes.filter((change) => change.id > 0);
    if (newRows.length && !canEntry) {
      message.error(t('common.noPermission'));
      return;
    }
    if (existingRows.length && !canUpdate) {
      message.error(t('common.noPermission'));
      return;
    }
    for (const change of newRows) {
      const row = change.data;
      const payload: ManualWholesaleDetailPayload = {
        businessDate: String(row.businessDate || dayjs().format('YYYY-MM-DD')),
        productName: String(row.productName || '').trim(),
        entityName: String(row.entityName || '').trim(),
        classification: defaultClassification(row),
        transportMode: row.transportMode || 'truck',
        weightKg: Number(row.weightKg || 0),
        vehicleNo: String(row.vehicleNo || '').trim(),
        senderName: String(row.senderName || '').trim(),
        weighSerialNo: String(row.weighSerialNo || '').trim(),
        remark: String(row.remark || '').trim(),
      };
      await manualCreateWholesaleDetail(payload);
    }
    for (const change of existingRows) {
      const row = change.data;
      await updateWholesaleDetail(change.id, {
        ...(row.businessDate !== undefined ? { businessDate: String(row.businessDate || '') } : {}),
        ...(row.productName !== undefined ? { productName: String(row.productName || '').trim() } : {}),
        ...(row.entityName !== undefined ? { entityName: String(row.entityName || '').trim() } : {}),
        ...(row.classification !== undefined ? { classification: defaultClassification(row) } : {}),
        ...(row.transportMode !== undefined ? { transportMode: row.transportMode || 'truck' } : {}),
        ...(row.weightKg !== undefined ? { weightKg: Number(row.weightKg || 0) } : {}),
        ...(row.vehicleNo !== undefined ? { vehicleNo: String(row.vehicleNo || '').trim() } : {}),
        ...(row.senderName !== undefined ? { senderName: String(row.senderName || '').trim() } : {}),
        ...(row.weighSerialNo !== undefined ? { weighSerialNo: String(row.weighSerialNo || '').trim() } : {}),
        ...(row.remark !== undefined ? { remark: String(row.remark || '').trim() } : {}),
      });
    }
    await fetchData();
  };

  const handleManualBatchSave = async (changes: Array<{ id: number; data: Partial<EntryRow> }>) => {
    await handleBatchSave(changes);
    setDraftRows([]);
  };

  const handleMaintenanceBatchSave = async (changes: Array<{ id: number; data: Partial<EntryRow> }>) => {
    await handleBatchSave(changes);
    setEditing(false);
  };

  const addRow = () => {
    if (!canEntry) {
      message.error(t('common.noPermission'));
      return;
    }
    setActiveTab('entry');
    entryTableRef.current?.addNewRow();
  };

  const saveDraftRows = async () => {
    if (!canEntry) {
      message.error(t('common.noPermission'));
      return;
    }
    await entryTableRef.current?.saveAllChanges();
  };

  const saveMaintenanceRows = async () => {
    if (!canUpdate) {
      message.error(t('common.noPermission'));
      return;
    }
    await maintenanceTableRef.current?.saveAllChanges();
  };

  const clearDraft = () => {
    entryTableRef.current?.clearDraft();
    setDraftRows([]);
  };

  const handleImportFile = async (file: File) => {
    if (!canEntry) {
      message.error(t('common.noPermission'));
      return;
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      message.error(t('wholesaleEntry.selectFile'));
      return;
    }
    try {
      const result = await uploadWholesaleDetailXlsx(file);
      if (result?.error) {
        message.error(result.error);
      } else {
        message.success(result?.uploadLabel || t('wholesaleEntry.importSuccess'));
        setActiveTab('maintenance');
        await fetchData();
      }
    } catch (err: any) {
      message.error(err?.message || t('wholesaleEntry.importFailed'));
    }
  };

  const handleExportMaintenance = async () => {
    setExporting(true);
    try {
      await downloadWholesaleDetailsExport({
        data_source: 'uploaded',
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
      });
      message.success(t('common.downloadStarted'));
    } catch (err: any) {
      message.error(err?.message || t('common.downloadFailed'));
    } finally {
      setExporting(false);
    }
  };

  const centerAlign = { align: 'center' as const };
  const columns: ColumnDefinition<EntryRow>[] = [
    { title: t('common.source'), dataIndex: 'sourceType', key: 'sourceType', width: 130, render: sourceLabel, ...centerAlign },
    { title: t('wholesaleEntry.sourceRow'), dataIndex: 'sourceRowNumber', key: 'sourceRowNumber', width: 90, render: (value) => value || '--', ...centerAlign },
    { title: t('wholesaleEntry.entryDate'), dataIndex: 'businessDate', key: 'businessDate', width: 118, editable: true, required: true, editorType: 'date', ...centerAlign },
    { title: t('common.transportMode'), dataIndex: 'transportMode', key: 'transportMode', width: 100, editable: true, editorType: 'select', editorOptions: transportOptions, render: (value) => t(`transport.${value}`, { defaultValue: value || '--' }), ...centerAlign },
    { title: t('weighing.weighSerialNo'), dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: 120, editable: true, render: (value) => value || '--', ...centerAlign },
    { title: t('common.productName'), dataIndex: 'productName', key: 'productName', width: 180, editable: true, required: true, editorType: 'select', editorOptions: productOpts, render: (_, row) => displayProductName(row.productName || row.rawProductName, row.standardProductName), ...centerAlign },
    { title: t('common.vehicleNo'), dataIndex: 'vehicleNo', key: 'vehicleNo', width: 120, editable: true, render: (value) => value || '--', ...centerAlign },
    {
      title: t('common.senderUnit'),
      dataIndex: 'senderName',
      key: 'senderName',
      width: 260,
      editable: true,
      required: true,
      editorType: 'select',
      editorOptions: senderOptions,
      render: (_, row) => displayCustomerName(row.senderName, row.standardSenderName),
      ...centerAlign,
    },
    { title: t('common.receiverUnit'), dataIndex: 'entityName', key: 'entityName', width: 240, editable: true, required: true, editorType: 'select', editorOptions: customerOpts, render: (_, row) => displayCustomerName(row.entityName || row.rawEntityName, row.standardEntityName), ...centerAlign },
    { title: t('common.weightKg'), dataIndex: 'weightKg', key: 'weightKg', width: 120, editable: true, required: true, editorType: 'number', render: (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }), ...centerAlign },
    {
      title: t('common.weightTons'),
      dataIndex: 'weightTons',
      key: 'weightTons',
      width: 110,
      render: (_: unknown, row: EntryRow) => {
        const kg = row.weightKg;
        const tons = kg !== undefined && kg !== null && kg !== '' ? Number(kg) / 1000 : Number(row.weightTons || 0);
        return Number(tons).toLocaleString(undefined, { maximumFractionDigits: 3 });
      },
      ...centerAlign,
    },
    { title: t('common.classification'), dataIndex: 'classification', key: 'classification', width: 150, editable: true, editorType: 'select', editorOptions: classificationOptions, render: (value) => t(`wholesale.${value}`, { defaultValue: value || '--' }), ...centerAlign },
    { title: t('common.matchStatus', { defaultValue: 'еЊ№й…ЌзЉ¶жЂЃ' }), dataIndex: 'matchStatus', key: 'matchStatus', width: 110, render: matchStatusLabel, ...centerAlign },
    { title: t('common.remark'), dataIndex: 'remark', key: 'remark', width: 220, editable: true, render: (value) => value || '--', ...centerAlign },
    { title: t('common.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (value) => value || '--', ...centerAlign },
  ];
  const manualHiddenColumns = new Set(['sourceType', 'sourceRowNumber', 'weightTons', 'matchStatus', 'createdAt']);
  const manualColumns = columns.filter((col) => !manualHiddenColumns.has(col.key));

  return (
    <Card
      title={t('common.trainEntry')}
      className="client-fit-page client-fit-table-card"
      extra={
        <Space wrap>
          <RangePicker value={dates} onChange={(value) => value && setDates(value as [dayjs.Dayjs, dayjs.Dayjs])} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          {activeTab === 'maintenance' && (
            <Button icon={<DownloadOutlined />} loading={exporting} onClick={handleExportMaintenance}>
              {t('common.export')}
            </Button>
          )}
          {canEntry && (
            <>
              {activeTab === 'maintenance' && (
                <>
                  <Button icon={<UploadOutlined />} onClick={() => document.getElementById('wholesale-detail-import-input')?.click()}>
                    {t('common.import')}
                  </Button>
                  <input
                    id="wholesale-detail-import-input"
                    type="file"
                    accept=".xlsx"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleImportFile(file);
                      event.target.value = '';
                    }}
                  />
                </>
              )}
              {activeTab === 'entry' && (
                <>
                  <Button icon={<PlusOutlined />} onClick={addRow}>{t('wholesaleEntry.addRow')}</Button>
                  <Button icon={<ClearOutlined />} onClick={clearDraft}>{t('common.clearDraft')}</Button>
                </>
              )}
            </>
          )}
          {activeTab === 'maintenance' && canUpdate && (
            <Button icon={<EditOutlined />} onClick={() => setEditing((value) => !value)}>
              {editing ? t('common.cancel') : t('common.edit')}
            </Button>
          )}
          {activeTab === 'entry' && canEntry && (
            <Button icon={<SaveOutlined />} type="primary" onClick={saveDraftRows}>{t('wholesaleEntry.saveRows')}</Button>
          )}
          {activeTab === 'maintenance' && canUpdate && (
            <Button icon={<SaveOutlined />} type="primary" onClick={saveMaintenanceRows}>{t('wholesaleEntry.saveRows')}</Button>
          )}
        </Space>
      }
    >
      <div className="client-fit-card-fixed">
        <KpiGrid items={entryKpis} defaultSpan={4} />
      </div>
      <Tabs
        className="client-fit-tabs train-entry-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'entry' | 'maintenance')}
        items={[
          {
            key: 'entry',
            label: t('wholesaleEntry.manualEntry'),
            children: (
              <div className="client-fit-table-scroll train-entry-table-scroll">
                <ExcelTable<EntryRow>
                  ref={entryTableRef}
                  dataSource={draftRows}
                  columns={manualColumns}
                  editing
                  setEditing={() => undefined}
                  isAdmin={canEntry}
                  canDelete
                  onBatchSave={handleManualBatchSave}
                  onDelete={async (ids) => setDraftRows((rows) => rows.filter((row) => !ids.includes(row.id)))}
                  onAddNew={(row) => setDraftRows((rows) => [...rows, row])}
                  validateRow={validateRow}
                  isCellEditable={() => canEntry}
                  initialNewRow={() => ({
                    businessDate: dayjs().format('YYYY-MM-DD'),
                    transportMode: 'truck',
                    classification: 'unknown',
                    senderName: senderOptions[0]?.value,
                    weightKg: '',
                    remark: '',
                  })}
                  draftKey="wholesale-detail-entry-draft"
                  height="100%"
                />
              </div>
            ),
          },
          {
            key: 'maintenance',
            label: t('wholesaleEntry.detailMaintenance'),
            children: (
              <div className="client-fit-table-scroll train-entry-table-scroll">
                <ExcelTable<EntryRow>
                  ref={maintenanceTableRef}
                  dataSource={data}
                  columns={columns}
                  editing={editing}
                  setEditing={setEditing}
                  isAdmin={canUpdate}
                  canDelete={false}
                  onBatchSave={handleMaintenanceBatchSave}
                  validateRow={validateRow}
                  isCellEditable={() => canUpdate}
                  height="100%"
                  pagination={{
                    current: page,
                    pageSize: ENTRY_PAGE_SIZE,
                    total: data.length,
                    onChange: setPage,
                    showTotal: (count) => t('common.total', { count }),
                  }}
                />
              </div>
            ),
          },
        ]}
      />
    </Card>
  );
}
