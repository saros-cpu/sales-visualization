import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Tabs, Tag, Space, Spin, Alert, Button, message } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import client, { getProductAliasesList, getEntityAliasesList, createProductAlias, deleteProductAlias, createEntityAlias, deleteEntityAlias } from '@/api/client';
import ExcelTable, { ExcelTableHandle } from '@/components/common/ExcelTable';

export default function Aliases() {
  const { t } = useTranslation();
  const [productList, setProductList] = useState<any[]>([]);
  const [entityList, setEntityList] = useState<any[]>([]);
  const [productOpts, setProductOpts] = useState<{value: number; label: string}[]>([]);
  const [entityTypeOpts] = useState([
    { value: 'retail_station', label: t('aliases.retailStation') },
    { value: 'own_depot', label: t('aliases.ownDepot') },
    { value: 'wholesale_customer', label: t('aliases.wholesaleCustomer') },
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const tableRef = useRef<ExcelTableHandle>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [pList, eList, pOpts] = await Promise.all([
        getProductAliasesList(),
        getEntityAliasesList(),
        client.get('/aliases/products'),
      ]);
      setProductList(pList);
      setEntityList(eList);
      const opts = (pOpts.data || []).map((p: any) => ({ value: p.id, label: p.displayName }));
      opts.sort((a: any, b: any) => a.label.localeCompare(b.label));
      setProductOpts(opts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleBatchSave = async (changes: Array<{ id: number; data: any }>) => {
    setSaving(true);
    try {
      for (const change of changes) {
        if (change.id > 0) {
          if (change.data._type === 'product') {
            await deleteProductAlias(change.id);
          } else {
            await deleteEntityAlias(change.id);
          }
        } else {
          if (change.data._type === 'product') {
            await createProductAlias(change.data.productId, change.data.aliasName);
          } else {
            await createEntityAlias(change.data.entityType, '', change.data.standardName, change.data.aliasName);
          }
        }
      }
      message.success('保存成功');
      setEditing(false);
      fetchAll();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRealTimeSave = async (id: number, field: string, value: any) => {
    if (id > 0) {
      if (field === 'displayName') {
        await deleteProductAlias(id);
      } else if (field === 'aliasName') {
        const record = productList.find(p => p.id === id);
        if (record) {
          await createProductAlias(id, value);
        }
      }
    }
  };

  const handleAddNew = useCallback((row: any) => {
    const newRow = {
      ...row,
      _type: 'product',
      productId: undefined,
      entityType: 'retail_station',
      standardName: '',
    };
    setProductList(prev => [...prev, newRow]);
  }, []);

  const columns = [
    { title: t('common.product'), dataIndex: 'displayName', key: 'displayName', width: 200, editable: true },
    { title: t('aliases.aliasName'), dataIndex: 'aliasName', key: 'aliasName', width: 200, editable: true },
  ];

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
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
        dataSource={productList}
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
