import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Table, Button, Space, message, Popconfirm, Input, InputNumber } from 'antd';
import { PlusOutlined, SaveOutlined, CloseOutlined, DeleteOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';

interface ColumnDefinition<T> {
  title: string;
  dataIndex: keyof T | string;
  key: string;
  width?: number;
  editable?: boolean;
  render?: (value: any, record: T, index: number) => React.ReactNode;
}

interface ExcelTableProps<T extends { id: number }> {
  dataSource: T[];
  columns: ColumnDefinition<T>[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  isAdmin: boolean;
  onBatchSave: (changes: Array<{ id: number; data: Partial<T> }>) => Promise<void>;
  onRealTimeSave?: (id: number, field: string, value: any) => Promise<void>;
  rowHeight?: number;
  height?: number;
  onKeyDown?: (e: KeyboardEvent) => void;
}

export default function ExcelTable<T extends { id: number }>({
  dataSource,
  columns,
  editing,
  setEditing,
  isAdmin,
  onBatchSave,
  onRealTimeSave,
  rowHeight = 40,
  height = 600,
  onKeyDown,
}: ExcelTableProps<T>) {
  const { user } = useAuth();
  const [editData, setEditData] = useState<Record<number, any>>({});
  const tempIdCounter = useRef(0);
  const [saving, setSaving] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  const tableRef = useRef<any>(null);

  const [cellSaveStatus, setCellSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [batchSaveStatus, setBatchSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editing) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        addNewRow();
      }

      if (e.key === 'Delete' && isAdmin && selectedRowKeys.length > 0) {
        e.preventDefault();
        deleteSelectedRows();
      }

      if (e.key === 'Escape') {
        setEditing(false);
      }

      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        saveAllChanges();
      }

      onKeyDown?.(e);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editing, isAdmin, selectedRowKeys]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const startIndex = Math.floor(scrollTop / rowHeight);
    setVisibleRange({
      start: Math.max(0, startIndex),
      end: Math.min(startIndex + Math.ceil(height / rowHeight), dataSource.length)
    });
  };

  const visibleDataSource = dataSource.slice(visibleRange.start, visibleRange.end);
  const tableHeight = dataSource.length * rowHeight;

  const addNewRow = useCallback(() => {
    const tempId = --tempIdCounter.current;
    const blankRow: any = {};
    columns.forEach(col => {
      if (col.editable) {
        blankRow[col.dataIndex] = '';
      }
    });

    const newRow: T = {
      id: tempId,
      ...blankRow
    } as T;

    setEditData(prev => ({ ...prev, [tempId]: newRow }));
    setTimeout(() => {
      const rows = document.querySelectorAll('.ant-table-row');
      if (rows[-tempId]) {
        rows[-tempId].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 100);
  }, [columns]);

  const updateCell = (id: number, field: string, value: any) => {
    setEditData(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));

    setCellSaveStatus(prev => ({ ...prev, [`${id}-${field}`]: 'saving' }));

    onRealTimeSave?.(id, field, value).then(() => {
      setCellSaveStatus(prev => ({ ...prev, [`${id}-${field}`]: 'saved' }));
      setTimeout(() => {
        setCellSaveStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[`${id}-${field}`];
          return newStatus;
        });
      }, 2000);
    }).catch(() => {
      setCellSaveStatus(prev => ({ ...prev, [`${id}-${field}`]: 'error' }));
    });
  };

  const deleteSelectedRows = useCallback(async () => {
    setSaving(true);
    try {
      setEditData(prev => {
        const newEditData = { ...prev };
        selectedRowKeys.forEach(key => {
          delete newEditData[key];
        });
        return newEditData;
      });
      setSelectedRowKeys([]);
      message.success(`已删除 ${selectedRowKeys.length} 条记录`);
    } catch (error) {
      message.error('删除失败，请重试');
    } finally {
      setSaving(false);
    }
  }, [selectedRowKeys]);

  const saveAllChanges = async () => {
    const changes: Array<{ id: number; data: Partial<T> }> = [];

    for (const [idStr, record] of Object.entries(editData)) {
      const id = Number(idStr);
      const original = dataSource.find(r => r.id === id);
      if (!original) continue;

      const hasChanges = Object.keys(record).some(key =>
        record[key] !== undefined && record[key] !== original[key as keyof T]
      );

      if (hasChanges) {
        changes.push({
          id,
          data: record as Partial<T>
        });
      }
    }

    if (changes.length === 0) {
      message.info('没有需要保存的修改');
      return;
    }

    setBatchSaveStatus('saving');
    try {
      await onBatchSave(changes);
      setEditData({});
      message.success(`已保存 ${changes.length} 条记录`);
      setBatchSaveStatus('saved');
      setTimeout(() => setBatchSaveStatus('idle'), 2000);
    } catch (error) {
      message.error('保存失败，请重试');
      setBatchSaveStatus('idle');
    }
  };

  const renderCell = (id: number, field: string, value: any) => {
    if (!editing) return value || '-';

    const current = editData[id]?.[field] ?? value;
    const isNum = typeof current === 'number';

    if (isNum) {
      return (
        <InputNumber
          value={current}
          onChange={(v) => updateCell(id, field, v)}
          size="small" style={{ width: '100%' }}
          min={0}
        />
      );
    }

    return (
      <Input
        value={current ?? ''}
        onChange={(e) => updateCell(id, field, e.target.value)}
        size="small" style={{ width: '100%' }}
      />
    );
  };

  const columnsWithRender = columns.map(col => ({
    ...col,
    render: (value: any, record: T, index: number) => {
      if (col.editable) {
        return renderCell(record.id, col.dataIndex as string, value, record);
      }
      if (col.render) {
        return col.render(value, record, index);
      }
      return value;
    }
  }));

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button
          icon={<PlusOutlined />}
          type="primary"
          onClick={addNewRow}
        >
          新增
        </Button>
        {editing && (
          <>
            <Button icon={<SaveOutlined />} type="primary" onClick={saveAllChanges} loading={saving || batchSaveStatus === 'saving'}>
              保存
            </Button>
            <Button icon={<CloseOutlined />} onClick={() => setEditing(false)}>
              取消
            </Button>
            {isAdmin && selectedRowKeys.length > 0 && (
              <Popconfirm title="确认删除" onConfirm={deleteSelectedRows}>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  loading={saving}
                >
                  删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
          </>
        )}
      </Space>

      <div
        style={{
          height: `${height}px`,
          overflowY: 'auto',
          border: '1px solid #d9d9d9'
        }}
        onScroll={handleScroll}
      >
        <div style={{ height: `${tableHeight}px` }}>
          <Table
            dataSource={visibleDataSource}
            columns={columnsWithRender}
            rowKey="id"
            size="middle"
            bordered
            pagination={false}
            rowClassName={(record, index) => {
              if (index === 0) return 'excel-header-row';
              if (selectedRowKeys.includes(record.id)) return 'excel-selected-row';
              return '';
            }}
            rowSelection={{
              selectedRowKeys,
              onChange: setSelectedRowKeys,
              getCheckboxProps: (record: T) => ({
                disabled: !editing || record.id < 0,
              }),
            }}
            scroll={{ y: height }}
            style={{ position: 'relative' }}
          />
        </div>
      </div>

      {dataSource.length > 50 && (
        <div style={{
          height: `${(dataSource.length - visibleRange.end) * rowHeight}px`,
          visibility: 'hidden'
        }} />
      )}
    </div>
  );
}
