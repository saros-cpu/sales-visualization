import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, InputNumber, Select, Space, Table, Tabs, Tag, Tooltip } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  getProfitCostItems,
  getProfitCostTypes,
  getProfitPurchasePrices,
  getWholesaleBriefingPrices,
  saveProfitCostItems,
  saveProfitPurchasePrices,
  saveWholesaleBriefingPrices,
  type ProfitCostType,
  type ProfitPurchasePriceValue,
  type ProfitPurchaseStationRow,
  type ProfitStationRow,
  type WholesaleBriefingPriceRow,
} from '@/api/management';
import PageState from '@/components/ui/PageState';
import StationNameStack from '@/components/ui/StationNameStack';
import { useRetailYears } from '@/hooks/useRetailYears';
import { useAuth } from '@/contexts/AuthContext';

const TAB_PERMISSIONS: Array<{ key: string; permission: string }> = [
  { key: 'costs', permission: 'profit:cost_update' },
  { key: 'purchase', permission: 'profit:purchase_price_update' },
  { key: 'wholesale', permission: 'profit:wholesale_price_update' },
];

type CellKey = `${number}:${string}`;
type DraftMap = Map<CellKey, number | null>;
type PurchaseCellKey = `${number}:${number}`;
type PurchaseDraftMap = Map<PurchaseCellKey, number | null>;
type WholesaleDraftMap = Map<number, { largePrice: number | null; retailPrice: number | null }>;
type PurchaseGridRow = ProfitPurchasePriceValue & { shopKey: number; stationName: string };
type PurchaseDisplayRow = Omit<ProfitPurchasePriceValue, 'source'> & {
  key: string;
  mode: 'product' | 'station';
  shopKey?: number;
  shopKeys: number[];
  stationName?: string;
  stationCount: number;
  source: ProfitPurchasePriceValue['source'] | 'mixed';
};

function cellKey(shopKey: number, costType: string): CellKey {
  return `${shopKey}:${costType}`;
}

function purchaseCellKey(shopKey: number, resourceKey: number): PurchaseCellKey {
  return `${shopKey}:${resourceKey}`;
}

export default function ProfitCostItems() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { message } = App.useApp();
  const now = new Date();
  const { year, setYear, yearOptions } = useRetailYears(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const allowedTabKeys = useMemo(() => (
    TAB_PERMISSIONS.filter((tab) => can(tab.permission)).map((tab) => tab.key)
  ), [can]);
  const [activeTab, setActiveTab] = useState(() => allowedTabKeys[0] ?? 'costs');
  const [costTypes, setCostTypes] = useState<ProfitCostType[]>([]);
  const [rows, setRows] = useState<ProfitStationRow[]>([]);
  const [purchaseStations, setPurchaseStations] = useState<ProfitPurchaseStationRow[]>([]);
  const [draft, setDraft] = useState<DraftMap>(new Map());
  const [origin, setOrigin] = useState<DraftMap>(new Map());
  const [purchaseDraft, setPurchaseDraft] = useState<PurchaseDraftMap>(new Map());
  const [purchaseOrigin, setPurchaseOrigin] = useState<PurchaseDraftMap>(new Map());
  const [wholesaleRows, setWholesaleRows] = useState<WholesaleBriefingPriceRow[]>([]);
  const [wholesaleDraft, setWholesaleDraft] = useState<WholesaleDraftMap>(new Map());
  const [wholesaleOrigin, setWholesaleOrigin] = useState<WholesaleDraftMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadedMonth, setLoadedMonth] = useState('');
  const loadSeq = useRef(0);

  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const load = useCallback(async () => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    setLoading(true);
    setError('');
    try {
      const [types, costPayload, purchasePayload] = await Promise.all([
        getProfitCostTypes(),
        getProfitCostItems(ym),
        getProfitPurchasePrices(ym),
      ]);
      if (loadSeq.current !== seq) return;
      setCostTypes(types);
      setRows(costPayload.stations);
      setPurchaseStations(purchasePayload.stations);

      const nextDraft: DraftMap = new Map();
      const nextOrigin: DraftMap = new Map();
      for (const row of costPayload.stations) {
        for (const costType of Object.keys(row.items)) {
          const key = cellKey(row.shopKey, costType);
          const value = row.items[costType]?.value ?? null;
          nextDraft.set(key, value);
          nextOrigin.set(key, value);
        }
      }
      setDraft(nextDraft);
      setOrigin(nextOrigin);

      const nextPurchaseDraft: PurchaseDraftMap = new Map();
      const nextPurchaseOrigin: PurchaseDraftMap = new Map();
      for (const row of purchasePayload.stations) {
        for (const item of row.rows) {
          const key = purchaseCellKey(row.shopKey, item.resourceKey);
          const value = item.purchasePrice ?? null;
          nextPurchaseDraft.set(key, value);
          nextPurchaseOrigin.set(key, value);
        }
      }
      setPurchaseDraft(nextPurchaseDraft);
      setPurchaseOrigin(nextPurchaseOrigin);
      setLoadedMonth(costPayload.month || purchasePayload.month);
    } catch (e: any) {
      if (loadSeq.current === seq) setError(e?.message || t('common.failed'));
    } finally {
      if (loadSeq.current === seq) setLoading(false);
    }
  }, [ym, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadWholesale = useCallback(async () => {
    try {
      const payload = await getWholesaleBriefingPrices();
      const nextDraft: WholesaleDraftMap = new Map();
      const nextOrigin: WholesaleDraftMap = new Map();
      for (const item of payload.items) {
        const value = { largePrice: item.largePrice ?? null, retailPrice: item.retailPrice ?? null };
        nextDraft.set(item.productKey, value);
        nextOrigin.set(item.productKey, value);
      }
      setWholesaleRows(payload.items);
      setWholesaleDraft(nextDraft);
      setWholesaleOrigin(nextOrigin);
    } catch (e: any) {
      setError(e?.message || t('common.failed'));
    }
  }, [t]);

  useEffect(() => {
    if (can('profit:wholesale_price_update')) loadWholesale();
  }, [loadWholesale, can]);

  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of draft) {
      if (value !== origin.get(key)) count += 1;
    }
    return count;
  }, [draft, origin]);

  const purchaseDirtyCount = useMemo(() => {
    let count = 0;
    for (const [key, value] of purchaseDraft) {
      if (value !== purchaseOrigin.get(key)) count += 1;
    }
    return count;
  }, [purchaseDraft, purchaseOrigin]);

  const wholesaleDirtyCount = useMemo(() => {
    let count = 0;
    for (const [productKey, value] of wholesaleDraft) {
      const origin = wholesaleOrigin.get(productKey);
      if (!origin) continue;
      if ((value.largePrice ?? null) !== (origin.largePrice ?? null)) count += 1;
      if ((value.retailPrice ?? null) !== (origin.retailPrice ?? null)) count += 1;
    }
    return count;
  }, [wholesaleDraft, wholesaleOrigin]);

  const purchaseRows = useMemo<PurchaseGridRow[]>(() => (
    purchaseStations.flatMap((item) => item.rows.map((row) => ({
      ...row,
      shopKey: item.shopKey,
      stationName: item.name,
    })))
  ), [purchaseStations]);

  const purchaseDisplayRows = useMemo<PurchaseDisplayRow[]>(() => {
    const groups = new Map<string, PurchaseGridRow[]>();
    for (const row of purchaseRows) {
      const key = `${row.resourceKey}:${row.product}:${row.purchaseProduct}`;
      const items = groups.get(key) || [];
      items.push(row);
      groups.set(key, items);
    }

    const result: PurchaseDisplayRow[] = [];
    for (const group of groups.values()) {
      const sortedGroup = [...group].sort((a, b) => a.shopKey - b.shopKey);
      const first = sortedGroup[0];
      const currentPrices = sortedGroup.map((row) => purchaseDraft.get(purchaseCellKey(row.shopKey, row.resourceKey)) ?? null);
      const firstPrice = currentPrices[0] ?? null;
      const samePrice = currentPrices.every((price) => price === firstPrice);
      const sourceSet = new Set(sortedGroup.map((row) => row.source));
      const source = sourceSet.size === 1 ? first.source : 'mixed';

      if (samePrice) {
        result.push({
          ...first,
          key: `product-${first.resourceKey}-${first.purchaseProduct}`,
          mode: 'product',
          shopKeys: sortedGroup.map((row) => row.shopKey),
          stationCount: sortedGroup.length,
          purchasePrice: firstPrice,
          source,
        });
        continue;
      }

      for (const row of sortedGroup) {
        result.push({
          ...row,
          key: `station-${row.shopKey}-${row.resourceKey}`,
          mode: 'station',
          shopKey: row.shopKey,
          shopKeys: [row.shopKey],
          stationName: row.stationName,
          stationCount: 1,
          purchasePrice: purchaseDraft.get(purchaseCellKey(row.shopKey, row.resourceKey)) ?? null,
          source: row.source,
        });
      }
    }
    return result.sort((a, b) => a.resourceKey - b.resourceKey || (a.shopKey || 0) - (b.shopKey || 0));
  }, [purchaseRows, purchaseDraft]);

  const setCell = (shopKey: number, costType: string, value: number | null) => {
    setDraft((prev) => {
      const next = new Map(prev);
      next.set(cellKey(shopKey, costType), value);
      return next;
    });
  };

  const setPurchaseCells = (shopKeys: number[], resourceKey: number, value: number | null) => {
    setPurchaseDraft((prev) => {
      const next = new Map(prev);
      for (const shopKey of shopKeys) {
        next.set(purchaseCellKey(shopKey, resourceKey), value);
      }
      return next;
    });
  };

  const setWholesaleCell = (productKey: number, field: 'largePrice' | 'retailPrice', value: number | null) => {
    setWholesaleDraft((prev) => {
      const next = new Map(prev);
      const current = next.get(productKey) || { largePrice: null, retailPrice: null };
      next.set(productKey, { ...current, [field]: value });
      return next;
    });
  };

  const onSaveCosts = async () => {
    const items: Array<{ shopKey: number; costType: string; value: number | null }> = [];
    for (const [key, value] of draft) {
      if (value === origin.get(key)) continue;
      const [shopKeyText, costType] = key.split(':');
      items.push({ shopKey: Number(shopKeyText), costType, value });
    }
    if (!items.length) {
      message.info(t('common.noChangesToSave'));
      return;
    }
    setSaving(true);
    try {
      await saveProfitCostItems(loadedMonth || ym, items);
      message.success(t('common.saved'));
      await load();
    } catch (e: any) {
      message.error(e?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onSavePurchasePrices = async () => {
    const items: Array<{ shopKey: number; resourceKey: number; purchaseProduct?: string; purchasePrice: number | null }> = [];
    const rowByKey = new Map(purchaseRows.map((row) => [purchaseCellKey(row.shopKey, row.resourceKey), row]));
    for (const [key, value] of purchaseDraft) {
      if (value === purchaseOrigin.get(key)) continue;
      const [shopKeyText, resourceKeyText] = key.split(':');
      const row = rowByKey.get(key);
      items.push({
        shopKey: Number(shopKeyText),
        resourceKey: Number(resourceKeyText),
        purchaseProduct: row?.purchaseProduct,
        purchasePrice: value,
      });
    }
    if (!items.length) {
      message.info(t('common.noChangesToSave'));
      return;
    }
    setSaving(true);
    try {
      await saveProfitPurchasePrices(loadedMonth || ym, items);
      message.success(t('common.saved'));
      await load();
    } catch (e: any) {
      message.error(e?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onSaveWholesalePrices = async () => {
    const items: Array<{ productKey: number; largePrice: number | null; retailPrice: number | null }> = [];
    for (const [productKey, value] of wholesaleDraft) {
      const origin = wholesaleOrigin.get(productKey);
      if (!origin) continue;
      if ((value.largePrice ?? null) === (origin.largePrice ?? null)
        && (value.retailPrice ?? null) === (origin.retailPrice ?? null)) continue;
      items.push({ productKey, largePrice: value.largePrice ?? null, retailPrice: value.retailPrice ?? null });
    }
    if (!items.length) {
      message.info(t('common.noChangesToSave'));
      return;
    }
    setSaving(true);
    try {
      await saveWholesaleBriefingPrices(items);
      message.success(t('common.saved'));
      await loadWholesale();
    } catch (e: any) {
      message.error(e?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const renderSourceTag = (source?: string) => {
    if (source === 'db') return <Tag color="blue" style={{ marginInlineEnd: 0 }}>{t('profit.dbOverride')}</Tag>;
    if (source === 'template') return <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t('profit.templateDefault')}</Tag>;
    if (source === 'mixed') return <Tag color="purple" style={{ marginInlineEnd: 0 }}>{t('profit.mixedSource')}</Tag>;
    return <Tag style={{ marginInlineEnd: 0 }}>{t('profit.configDefault')}</Tag>;
  };

  const renderEditable = (shopKey: number, costType: string, isRate: boolean) => {
    const key = cellKey(shopKey, costType);
    const value = draft.get(key) ?? null;
    const original = origin.get(key) ?? null;
    const item = rows.find((r) => r.shopKey === shopKey)?.items[costType];
    const dirty = value !== original;

    const input = (
      <InputNumber
        style={{ width: 110 }}
        min={0}
        step={isRate ? 0.01 : 100}
        precision={2}
        value={value}
        placeholder={isRate ? t('profit.noRate') : undefined}
        onChange={(v) => setCell(shopKey, costType, v == null ? null : Number(v))}
      />
    );

    return (
      <Space direction="vertical" size={2}>
        {dirty ? (
          <Tooltip title={t('profit.dirtyTip')}>
            <span style={{ color: '#CC0000' }}>{input}</span>
          </Tooltip>
        ) : input}
        <Space size={4}>
          {renderSourceTag(item?.source)}
          {value == null && <Tag style={{ marginInlineEnd: 0 }}>{t('profit.noRate')}</Tag>}
        </Space>
      </Space>
    );
  };

  const renderPurchaseEditable = (row: PurchaseDisplayRow) => {
    const value = row.purchasePrice ?? null;
    const dirty = row.shopKeys.some((shopKey) => {
      const key = purchaseCellKey(shopKey, row.resourceKey);
      return (purchaseDraft.get(key) ?? null) !== (purchaseOrigin.get(key) ?? null);
    });
    const input = (
      <InputNumber
        style={{ width: 110 }}
        min={0}
        step={0.1}
        precision={2}
        value={value}
        onChange={(v) => setPurchaseCells(row.shopKeys, row.resourceKey, v == null ? null : Number(v))}
      />
    );
    return (
      <Space direction="vertical" size={2}>
        {dirty ? (
          <Tooltip title={t('profit.dirtyTip')}>
            <span style={{ color: '#CC0000' }}>{input}</span>
          </Tooltip>
        ) : input}
        {renderSourceTag(row.source)}
      </Space>
    );
  };

  const renderWholesaleEditable = (row: WholesaleBriefingPriceRow, field: 'largePrice' | 'retailPrice') => {
    const current = wholesaleDraft.get(row.productKey) || { largePrice: null, retailPrice: null };
    const original = wholesaleOrigin.get(row.productKey) || { largePrice: null, retailPrice: null };
    const value = current[field] ?? null;
    const dirty = (value ?? null) !== (original[field] ?? null);

    const input = (
      <InputNumber
        style={{ width: 120 }}
        min={0}
        step={0.1}
        precision={2}
        value={value}
        placeholder={t('profit.notSet')}
        onChange={(v) => setWholesaleCell(row.productKey, field, v == null ? null : Number(v))}
      />
    );

    return (
      <Space direction="vertical" size={2}>
        {dirty ? (
          <Tooltip title={t('profit.dirtyTip')}>
            <span style={{ color: '#CC0000' }}>{input}</span>
          </Tooltip>
        ) : input}
        {value == null && <Tag style={{ marginInlineEnd: 0 }}>{t('profit.notSet')}</Tag>}
      </Space>
    );
  };

  const costColumns = [
    {
      title: t('profit.stationNo'), dataIndex: 'shopKey', key: 'shopKey', width: 80,
      align: 'center' as const, sorter: (a: ProfitStationRow, b: ProfitStationRow) => a.shopKey - b.shopKey,
      render: (v: number) => <b>{v}</b>,
    },
    {
      title: t('profit.stationName'), dataIndex: 'name', key: 'name', width: 220,
      render: (_: string, row: ProfitStationRow) => <StationNameStack name={row.name} />,
    },
    ...costTypes.map((cost) => ({
      title: (
        <Tooltip title={`${cost.labelZh} / ${cost.labelRu}`}>
          <span>{cost.costType} - {cost.labelZh}</span>
        </Tooltip>
      ),
      key: cost.costType,
      align: 'center' as const,
      render: (_: unknown, row: ProfitStationRow) =>
        renderEditable(row.shopKey, cost.costType, cost.costType === 'N'),
    })),
  ];

  const purchaseColumns = [
    {
      title: t('common.productName'), dataIndex: 'product', key: 'product', width: 140,
      align: 'center' as const,
    },
    {
      title: t('profit.purchaseProduct'), dataIndex: 'purchaseProduct', key: 'purchaseProduct', width: 160,
      align: 'center' as const,
    },
    {
      title: t('profit.purchaseScope'),
      key: 'purchaseScope',
      width: 220,
      align: 'center' as const,
      render: (_: unknown, row: PurchaseDisplayRow) => row.mode === 'product'
        ? <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('profit.allStations', { count: row.stationCount })}</Tag>
        : (
          <Space direction="vertical" size={0}>
            <b>{row.shopKey}</b>
            <StationNameStack name={row.stationName || ''} />
          </Space>
        ),
    },
    {
      title: t('profit.purchasePrice'),
      key: 'purchasePrice',
      align: 'center' as const,
      width: 150,
      render: (_: unknown, row: PurchaseDisplayRow) => renderPurchaseEditable(row),
    },
  ];

  const wholesaleColumns = [
    {
      title: t('common.productName'), dataIndex: 'labelZh', key: 'productKey', width: 220,
      align: 'center' as const,
      render: (_: string, row: WholesaleBriefingPriceRow) => (
        <Tooltip title={row.labelRu}>
          <span>{row.labelZh}</span>
        </Tooltip>
      ),
    },
    {
      title: t('profit.wholesaleLargePrice'),
      key: 'largePrice',
      align: 'center' as const,
      width: 180,
      render: (_: unknown, row: WholesaleBriefingPriceRow) => renderWholesaleEditable(row, 'largePrice'),
    },
    {
      title: t('profit.wholesaleRetailPrice'),
      key: 'retailPrice',
      align: 'center' as const,
      width: 180,
      render: (_: unknown, row: WholesaleBriefingPriceRow) => renderWholesaleEditable(row, 'retailPrice'),
    },
    {
      title: t('profit.updatedAt'), dataIndex: 'updatedAt', key: 'updatedAt', width: 180,
      align: 'center' as const,
      render: (v?: string | null) => v || '--',
    },
  ];

  const activeDirtyCount = activeTab === 'costs' ? dirtyCount : activeTab === 'purchase' ? purchaseDirtyCount : wholesaleDirtyCount;
  const onSaveActive = activeTab === 'costs' ? onSaveCosts : activeTab === 'purchase' ? onSavePurchasePrices : onSaveWholesalePrices;

  if (loading && !rows.length && !purchaseStations.length) return <PageState status="loading" />;

  return (
    <div className="client-fit-page">
      <div className="client-fit-stack">
        <div className="page-toolbar" style={{ marginBottom: 0 }}>
          <div><h2 style={{ margin: 0 }}>{t('profit.title')}</h2></div>
          <Space wrap>
            <Select value={year} onChange={setYear} style={{ width: 100 }}>
              {yearOptions.map((y) => (
                <Select.Option key={y} value={y}>{y}</Select.Option>
              ))}
            </Select>
            <Select value={month} onChange={setMonth} style={{ width: 90 }}>
              {Array.from({ length: 12 }, (_, i) => (
                <Select.Option key={i + 1} value={i + 1}>{i + 1}{t('common.month')}</Select.Option>
              ))}
            </Select>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>{t('common.search')}</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!activeDirtyCount} onClick={onSaveActive}>
              {t('common.save')}{activeDirtyCount ? ` (${activeDirtyCount})` : ''}
            </Button>
          </Space>
        </div>

        {error && <Alert type="error" message={error} closable />}
        <Alert type="info" message={activeTab === 'wholesale' ? t('profit.wholesalePriceHint') : t('profit.hint')} showIcon />
      </div>

      <Tabs
        className="client-fit-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'costs',
            label: t('profit.costItemsTab'),
            children: (
              <div className="client-fit-page">
                <Card size="small" className="client-fit-table-card">
                  <div className="client-fit-table-scroll">
                    <Table
                      columns={costColumns}
                      dataSource={rows}
                      rowKey="shopKey"
                      loading={loading}
                      size="small"
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: 'purchase',
            label: t('profit.purchasePricesTab'),
            children: (
              <div className="client-fit-page">
                <Card size="small" className="client-fit-table-card">
                  <div className="client-fit-table-scroll">
                    <Table
                      columns={purchaseColumns}
                      dataSource={purchaseDisplayRows}
                      rowKey={(row) => row.key}
                      loading={loading}
                      size="small"
                      pagination={{ pageSize: 80, showSizeChanger: false }}
                      scroll={{ x: 'max-content' }}
                    />
                  </div>
                </Card>
              </div>
            ),
          },
          {
            key: 'wholesale',
            label: t('profit.wholesalePricesTab'),
            children: (
              <div className="client-fit-page">
                <Card size="small" className="client-fit-table-card">
                  <div className="client-fit-table-scroll">
                    <Table
                      columns={wholesaleColumns}
                      dataSource={wholesaleRows}
                      rowKey="productKey"
                      loading={loading}
                      size="small"
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                    />
                  </div>
                </Card>
              </div>
            ),
          },
        ].filter((item) => allowedTabKeys.includes(item.key))}
      />
    </div>
  );
}
