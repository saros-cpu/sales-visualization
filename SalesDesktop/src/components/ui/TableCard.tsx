import { Card, Table, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface Props<T> {
  title: string;
  columns: ColumnsType<T>;
  data: T[];
  rowKey: string | ((record: T) => string);
  loading?: boolean;
  onExport?: () => void;
  exportText?: string;
  pageSize?: number;
  scrollY?: number | string;
  pagination?: false;
  className?: string;
}

export default function TableCard<T extends object>({
  title,
  columns,
  data,
  rowKey,
  loading,
  onExport,
  exportText = '导出',
  pageSize = 20,
  scrollY,
  pagination,
  className,
}: Props<T>) {
  const tableScroll = scrollY ? { x: 'max-content' as const, y: scrollY } : { x: 'max-content' as const };

  return (
    <Card
      title={title}
      size="small"
      className={['table-card', className].filter(Boolean).join(' ')}
      extra={onExport && <Button onClick={onExport}>{exportText}</Button>}
    >
      <div className="table-card-body-scroll">
        <Table<T>
          columns={columns}
          dataSource={data}
          rowKey={rowKey}
          loading={loading}
          size="small"
          pagination={pagination === false ? false : { pageSize }}
          scroll={tableScroll}
        />
      </div>
    </Card>
  );
}
