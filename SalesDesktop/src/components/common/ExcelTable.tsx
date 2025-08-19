import React, { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { Table, message, Input, InputNumber, Select, DatePicker } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

export interface ExcelTableHandle {
  saveAllChanges: () => Promise<void>;
  addNewRow: () => void;
  deleteSelectedRows: () => Promise<void>;
}

interface ColumnDefinition<T> {
  title: string;
  dataIndex: keyof T | string;
  key: string;
  width?: number;
  editable?: boolean;
  editorType?: 'text' | 'select' | 'date';
  editorOptions?: { value: string | number; label: string }[];
  dateFormat?: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
}

interface ExcelTableProps<T extends { id: number }> {
  dataSource: T[];
  columns: ColumnDefinition<T>[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  isAdmin: boolean;
  onBatchSave?: (changes: Array<{ id: number; data: Partial<T> }>) => Promise<void>;
  onRealTimeSave?: (id: number, field: string, value: any) => Promise<void>;
  onAddNew?: (row: T) => void;
  onDelete?: (ids: number[]) => Promise<void>;
  rowHeight?: number;
  height?: number;
  onKeyDown?: (e: KeyboardEvent) => void;
  pagination?: false | {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
    showTotal?: (total: number) => string;
  };
}

const ExcelTable = forwardRef(<T extends { id: number },>(props: ExcelTableProps<T>, ref: React.Ref<ExcelTableHandle>) => {
  const {
    dataSource,
    columns,
    editing,
    setEditing,
    isAdmin,
    onBatchSave,
    onRealTimeSave,
    onAddNew,
    onDelete,
    height,
    onKeyDown,
    pagination,
  } = props;
  const [editData, setEditData] = useState<Record<number, any>>({});
  const [saving, setSaving] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [cellSaveStatus, setCellSaveStatus] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [batchSaveStatus, setBatchSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const nextTempId = useRef(-1);

  const editDataRef = useRef(editData);
  editDataRef.current = editData;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editing) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddNew();
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

  const handleAddNew = useCallback(() => {
    const blankRow: any = {};
    blankRow.id = nextTempId.current--;
    columns.forEach(col => {
      if (col.editable) {
        blankRow[col.dataIndex] = '';
      }
    });
    onAddNew?.(blankRow as T);
  }, [columns, onAddNew]);

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
      await onDelete?.(selectedRowKeys.map(k => Number(k)));
      setEditData(prev => {
        const newEditData = { ...prev };
        selectedRowKeys.forEach(k => {
          const id = Number(k);
          if (!isNaN(id)) delete newEditData[id];
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
  }, [selectedRowKeys, onDelete]);

  const saveAllChanges = async () => {
    const changes: Array<{ id: number; data: Partial<T> }> = [];

    for (const [idStr, record] of Object.entries(editData)) {
      const id = Number(idStr);
      if (id < 0) {
        changes.push({
          id,
          data: record as Partial<T>
        });
        continue;
      }
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
      await onBatchSave?.(changes);
      setEditData({});
      message.success(`已保存 ${changes.length} 条记录`);
      setBatchSaveStatus('saved');
      setTimeout(() => setBatchSaveStatus('idle'), 2000);
    } catch (error) {
      message.error('保存失败，请重试');
      setBatchSaveStatus('idle');
    }
  };

  const saveAllChangesRef = useRef(saveAllChanges);
  saveAllChangesRef.current = saveAllChanges;
  const handleAddNewRef = useRef(handleAddNew);
  handleAddNewRef.current = handleAddNew;

  const deleteSelectedRowsRef = useRef(deleteSelectedRows);
  deleteSelectedRowsRef.current = deleteSelectedRows;

  useImperativeHandle(ref, () => ({
    saveAllChanges: () => saveAllChangesRef.current(),
    addNewRow: () => handleAddNewRef.current(),
    deleteSelectedRows: () => deleteSelectedRowsRef.current(),
  }), []);

  const renderCell = (id: number, field: string, value: any, col?: ColumnDefinition<T>) => {
    if (!editing) return value || '-';

    const current = editDataRef.current[id]?.[field] ?? value;

    if (col?.editorType === 'select' && col.editorOptions) {
      return (
        <Select
          value={current || undefined}
          onChange={(v) => updateCell(id, field, v)}
          size="small" style={{ width: '100%' }}
          options={col.editorOptions}
          allowClear
        />
      );
    }

    if (col?.editorType === 'date') {
      return (
        <DatePicker
          value={current ? dayjs(current) : null}
          onChange={(_, dateStr) => updateCell(id, field, dateStr)}
          size="small" style={{ width: '100%' }}
          format={col.dateFormat || 'YYYY-MM-DD'}
        />
      );
    }

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

  const columnsWithRender = useMemo(() => columns.map(col => ({
    ...col,
    render: (value: any, record: T, index: number) => {
      if (col.editable) {
        if (!editing && col.render) {
          return col.render(value, record, index);
        }
        return renderCell(record.id, col.dataIndex as string, value, col);
      }
      if (col.render) {
        return col.render(value, record, index);
      }
      return value;
    }
  })) as ColumnsType<T>, [columns, editing]);

  return (
    <Table
      dataSource={dataSource}
      columns={columnsWithRender}
      rowKey="id"
      size="middle"
      bordered
      pagination={pagination ?? false}
      onChange={pagination ? () => {} : undefined}
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
      scroll={height ? { y: height } : undefined}
      style={{ position: 'relative' }}
    />
  );
});
export default ExcelTable;
