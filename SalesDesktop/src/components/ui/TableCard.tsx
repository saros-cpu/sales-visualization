import { Card, Table, Button, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface Props<T> {
  title: string;
  columns: ColumnsType<T>;
  data: T[];
  rowKey: string | ((record: T) => string);
  loading?: boolean;
  onExport?: () => void;
  exportText?: string;
}

export default function TableCard<T extends object>({ title, columns, data, rowKey, loading, onExport, exportText = '导出' }: Props<T>) {
  return (
    <Card
      title={title}
      size="small"
      style={{ marginBottom: 16 }}
      extra={onExport && <Button onClick={onExport}>{exportText}</Button>}
    >
      <div style={{ overflow: 'auto' }}>
        <Table<T> columns={columns} dataSource={data} rowKey={rowKey} loading={loading} size="small" pagination={{ pageSize: 20 }} scroll={{ x: 'max-content' }} />
      </div>
    </Card>
  );
}
