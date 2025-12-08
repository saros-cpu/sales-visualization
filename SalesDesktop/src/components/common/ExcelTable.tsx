import React, { useState, useCallback, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { Table, message, Input, Select, DatePicker, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';

export interface ExcelTableHandle {
  saveAllChanges: () => Promise<void>;
  addNewRow: () => void;
  deleteSelectedRows: () => Promise<void>;
  clearDraft: () => void;
}

export interface ColumnDefinition<T> {
  title: string;
  dataIndex: keyof T | string;
  key: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  editable?: boolean;
  readOnly?: boolean;
  required?: boolean;
  editorType?: 'text' | 'number' | 'select' | 'date';
  editorOptions?: { value: string | number; label: string }[];
  dateFormat?: string;
  placeholder?: string;
  render?: (value: any, record: T, index: number) => React.ReactNode;
}

interface ExcelTableProps<T extends { id: number }> {
  dataSource: T[];
  columns: ColumnDefinition<T>[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  isAdmin: boolean;
  canDelete?: boolean;
  onBatchSave?: (changes: Array<{ id: number; data: Partial<T> }>) => Promise<void>;
  onRealTimeSave?: (id: number, field: string, value: any) => Promise<void>;
  onAddNew?: (row: T) => void;
  onDelete?: (ids: number[]) => Promise<void>;
  onSelectionChange?: (ids: number[]) => void;
  validateRow?: (row: Partial<T>, rowIndex: number) => Record<string, string>;
  initialNewRow?: () => Partial<T>;
  draftKey?: string;
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

type ExcelTableComponent = <T extends { id: number }>(
  props: ExcelTableProps<T> & React.RefAttributes<ExcelTableHandle>
) => React.ReactElement | null;

function isBlankRecord(record: Record<string, any>, editableKeys: string[]) {
  return editableKeys.every((key) => {
    const value = record[key];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

const ExcelTable = forwardRef(function ExcelTableInner<T extends { id: number }>(
  props: ExcelTableProps<T>,
  ref: React.Ref<ExcelTableHandle>,
) {
  const {
    dataSource,
    columns,
    editing,
    setEditing,
    isAdmin,
    canDelete,
    onBatchSave,
    onRealTimeSave,
    onAddNew,
    onDelete,
    onSelectionChange,
    validateRow,
    initialNewRow,
    draftKey,
    height,
    onKeyDown,
    pagination,
  } = props;
  const { t } = useTranslation();
  const [editData, setEditData] = useState<Record<number, any>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const nextTempId = useRef(-1);
  const loadedDraft = useRef(false);

  const editableColumns = useMemo(() => columns.filter(col => col.editable && !col.readOnly), [columns]);
  const editableKeys = useMemo(() => editableColumns.map(col => String(col.dataIndex)), [editableColumns]);
  const editDataRef = useRef(editData);
  editDataRef.current = editData;
  const canDeleteRows = Boolean(canDelete ?? isAdmin);

  const cellKey = (id: number, field: string) => `${id}::${field}`;

  const makeBlankRow = useCallback(() => {
    const row: any = { id: nextTempId.current--, ...(initialNewRow?.() || {}) };
    columns.forEach((col) => {
      if (col.editable && row[col.dataIndex as string] === undefined) row[col.dataIndex as string] = '';
    });
    return row as T;
  }, [columns, initialNewRow]);

  const handleAddNew = useCallback(() => {
    const row = makeBlankRow();
    onAddNew?.(row);
    setEditData(prev => ({ ...prev, [row.id]: { ...row } }));
  }, [makeBlankRow, onAddNew]);

  const clearDraft = useCallback(() => {
    setEditData({});
    setCellErrors({});
    if (draftKey) localStorage.removeItem(draftKey);
    message.success(t('common.draftCleared'));
  }, [draftKey, t]);

  useEffect(() => {
    if (!draftKey || loadedDraft.current || !onAddNew) return;
    loadedDraft.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const rows = JSON.parse(raw);
      if (!Array.isArray(rows)) return;
      const restored: Record<number, any> = {};
      rows.forEach((row: any) => {
        if (!row || typeof row !== 'object') return;
        const id = Number(row.id) < 0 ? Number(row.id) : nextTempId.current--;
        nextTempId.current = Math.min(nextTempId.current, id - 1);
        const item = { ...row, id } as T;
        restored[id] = item;
        onAddNew(item);
      });
      if (Object.keys(restored).length > 0) setEditData(restored);
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, onAddNew]);

  useEffect(() => {
    if (!draftKey) return;
    const rows = Object.entries(editData)
      .filter(([id]) => Number(id) < 0)
      .map(([id, row]) => ({ ...row, id: Number(id) }))
      .filter((row) => !isBlankRecord(row, editableKeys));
    if (rows.length > 0) localStorage.setItem(draftKey, JSON.stringify(rows));
    else localStorage.removeItem(draftKey);
  }, [draftKey, editData, editableKeys]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editing || Object.keys(editDataRef.current).length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editing]);

  const updateCell = useCallback((id: number, field: string, value: any) => {
    setEditData(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
    setCellErrors(prev => {
      const next = { ...prev };
      delete next[cellKey(id, field)];
      return next;
    });
    onRealTimeSave?.(id, field, value).catch(() => {
      setCellErrors(prev => ({ ...prev, [cellKey(id, field)]: t('common.saveFailed') }));
    });
  }, [onRealTimeSave, t]);

  const focusCell = useCallback((rowIndex: number, colIndex: number) => {
    const row = dataSource[rowIndex];
    const col = editableColumns[colIndex];
    if (!row || !col) return;
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-excel-cell="${row.id}::${String(col.dataIndex)}"] input, [data-excel-cell="${row.id}::${String(col.dataIndex)}"] .ant-select-selector`);
      target?.focus();
      target?.click();
    }, 20);
  }, [dataSource, editableColumns]);

  const moveCell = useCallback((rowIndex: number, colIndex: number, rowDelta: number, colDelta: number) => {
    let nextRow = rowIndex + rowDelta;
    let nextCol = colIndex + colDelta;
    if (nextCol >= editableColumns.length) {
      nextCol = 0;
      nextRow += 1;
    }
    if (nextCol < 0) {
      nextCol = editableColumns.length - 1;
      nextRow -= 1;
    }
    if (nextRow >= dataSource.length) {
      handleAddNew();
      nextRow = dataSource.length;
    }
    if (nextRow >= 0) focusCell(nextRow, nextCol);
  }, [dataSource.length, editableColumns.length, focusCell, handleAddNew]);

  const handlePaste = useCallback((event: React.ClipboardEvent, rowIndex: number, colIndex: number) => {
    const text = event.clipboardData.getData('text');
    if (!text || !text.includes('\t') && !text.includes('\n')) return;
    event.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter((row) => row.length > 0);
    rows.forEach((line, rOffset) => {
      const cells = line.split('\t');
      let targetRow = dataSource[rowIndex + rOffset];
      if (!targetRow) {
        targetRow = makeBlankRow();
        onAddNew?.(targetRow);
      }
      cells.forEach((value, cOffset) => {
        const col = editableColumns[colIndex + cOffset];
        if (!col) return;
        updateCell(targetRow.id, String(col.dataIndex), value);
      });
    });
  }, [dataSource, editableColumns, makeBlankRow, onAddNew, updateCell]);

  const deleteSelectedRows = useCallback(async () => {
    try {
      const ids = selectedRowKeys.map(k => Number(k));
      if (ids.length === 0) {
        message.info(t('common.selectRowsFirst'));
        return;
      }
      const savedIds = ids.filter(id => id > 0);
      if (savedIds.length > 0 && !onDelete) {
        message.error(t('common.noPermission'));
        return;
      }
      if (ids.length > 0) await onDelete?.(ids);
      setEditData(prev => {
        const next = { ...prev };
        selectedRowKeys.forEach(k => { delete next[Number(k)]; });
        return next;
      });
      setSelectedRowKeys([]);
      onSelectionChange?.([]);
      message.success(t('common.deletedCount', { count: selectedRowKeys.length }));
    } catch (error) {
      message.error(error instanceof Error && error.message ? error.message : t('common.deleteFailedRetry'));
    }
  }, [selectedRowKeys, onDelete, onSelectionChange, t]);

  const buildChanges = useCallback(() => {
    const changes: Array<{ id: number; data: Partial<T> }> = [];
    for (const [idStr, record] of Object.entries(editDataRef.current)) {
      const id = Number(idStr);
      const merged = { ...(dataSource.find(r => r.id === id) || {}), ...record };
      if (id < 0 && isBlankRecord(merged, editableKeys)) continue;
      if (id < 0) {
        changes.push({ id, data: merged as Partial<T> });
        continue;
      }
      const original = dataSource.find(r => r.id === id);
      if (!original) continue;
      const hasChanges = Object.keys(record).some(key => record[key] !== undefined && record[key] !== (original as any)[key]);
      if (hasChanges) changes.push({ id, data: record as Partial<T> });
    }
    return changes;
  }, [dataSource, editableKeys]);

  const validateChanges = useCallback((changes: Array<{ id: number; data: Partial<T> }>) => {
    const errors: Record<string, string> = {};
    changes.forEach((change) => {
      const rowIndex = dataSource.findIndex(row => row.id === change.id);
      const row = { ...(dataSource.find(r => r.id === change.id) || {}), ...change.data };
      columns.forEach((col) => {
        if (!col.required) return;
        const field = String(col.dataIndex);
        const value = (row as any)[field];
        if (value === undefined || value === null || String(value).trim() === '') {
          errors[cellKey(change.id, field)] = `${col.title} ${t('common.required')}`;
        }
      });
      const custom = validateRow?.(row, rowIndex >= 0 ? rowIndex : dataSource.length) || {};
      Object.entries(custom).forEach(([field, reason]) => {
        errors[cellKey(change.id, field)] = reason;
      });
    });
    setCellErrors(errors);
    return errors;
  }, [columns, dataSource, t, validateRow]);

  const saveAllChanges = useCallback(async () => {
    const changes = buildChanges();
    if (changes.length === 0) {
      message.info(t('common.noChangesToSave'));
      return;
    }
    const errors = validateChanges(changes);
    if (Object.keys(errors).length > 0) {
      message.error(t('common.cellsNeedFix', { count: Object.keys(errors).length }));
      throw new Error('validation_failed');
    }
    await onBatchSave?.(changes);
    setEditData(prev => {
      const next = { ...prev };
      changes.forEach(change => { delete next[change.id]; });
      return next;
    });
    setCellErrors({});
    if (draftKey) localStorage.removeItem(draftKey);
    message.success(t('common.savedCount', { count: changes.length }));
  }, [buildChanges, draftKey, onBatchSave, t, validateChanges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editing) return;
      if (e.key === 'Delete' && canDeleteRows && selectedRowKeys.length > 0) {
        e.preventDefault();
        deleteSelectedRows();
      }
      if (e.key === 'Escape') setEditing(false);
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveAllChanges().catch(() => {});
      }
      onKeyDown?.(e);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [canDeleteRows, deleteSelectedRows, editing, onKeyDown, saveAllChanges, selectedRowKeys.length, setEditing]);

  useImperativeHandle(ref, () => ({
    saveAllChanges,
    addNewRow: handleAddNew,
    deleteSelectedRows,
    clearDraft,
  }), [clearDraft, deleteSelectedRows, handleAddNew, saveAllChanges]);

  const renderEditor = (record: T, rowIndex: number, col: ColumnDefinition<T>, colIndex: number, value: any) => {
    const field = String(col.dataIndex);
    const current = editDataRef.current[record.id]?.[field] ?? value ?? '';
    const error = cellErrors[cellKey(record.id, field)];
    const commonProps = {
      size: 'small' as const,
      style: { width: '100%' },
      status: error ? 'error' as const : undefined,
      onPaste: (event: React.ClipboardEvent) => handlePaste(event, rowIndex, colIndex),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          moveCell(rowIndex, colIndex, 1, 0);
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          moveCell(rowIndex, colIndex, 0, event.shiftKey ? -1 : 1);
        }
      },
    };
    const editor = (() => {
      if (col.editorType === 'select' && col.editorOptions) {
        const selectValue = typeof current === 'boolean' ? (current ? 1 : 0) : current;
        return <Select value={selectValue === '' ? undefined : selectValue} onChange={(v) => updateCell(record.id, field, v)} options={col.editorOptions} allowClear showSearch optionFilterProp="label" {...commonProps} />;
      }
      if (col.editorType === 'date') {
        return <DatePicker value={current ? dayjs(current) : null} onChange={(_, dateStr) => updateCell(record.id, field, dateStr)} format={col.dateFormat || 'YYYY-MM-DD'} {...commonProps} />;
      }
      return <Input value={current ?? ''} type={col.editorType === 'number' ? 'number' : 'text'} placeholder={col.placeholder} onChange={(e) => updateCell(record.id, field, e.target.value)} {...commonProps} />;
    })();
    return <div data-excel-cell={cellKey(record.id, field)}>{error ? <Tooltip title={error}>{editor}</Tooltip> : editor}</div>;
  };

  const columnsWithRender = useMemo(() => columns.map(col => ({
    ...col,
    render: (value: any, record: T, index: number) => {
      if (col.editable && editing && !col.readOnly) {
        const colIndex = editableColumns.findIndex(item => String(item.dataIndex) === String(col.dataIndex));
        return renderEditor(record, index, col, colIndex, value);
      }
      if (col.render) return col.render(value, record, index);
      return value || '-';
    },
  })) as ColumnsType<T>, [columns, editing, editableColumns, cellErrors, editData]);

  return (
    <Table
      dataSource={dataSource}
      columns={columnsWithRender}
      rowKey="id"
      size="middle"
      bordered
      pagination={pagination ?? false}
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => {
          setSelectedRowKeys(keys);
          onSelectionChange?.(keys.map(k => Number(k)));
        },
        getCheckboxProps: () => ({ disabled: !editing && !canDeleteRows }),
      }}
      scroll={height ? { x: 'max-content', y: height } : { x: 'max-content' }}
      rowClassName={(record) => selectedRowKeys.includes(record.id) ? 'excel-selected-row' : ''}
    />
  );
}) as ExcelTableComponent;

export default ExcelTable;
