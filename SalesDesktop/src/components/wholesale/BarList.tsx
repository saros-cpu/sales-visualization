import { List, Progress } from 'antd';
import { sortRankingRows } from '@/utils/rankingCharts';

interface Row { name: string; tons: number; amountCny?: number; }

export default function BarList({ rows, showAmount }: { rows: Row[]; showAmount?: boolean }) {
  const sortedRows = sortRankingRows(rows, (row) => row.tons);
  const max = Math.max(...sortedRows.map((r) => r.tons), 1);
  return (
    <List
      size="small"
      dataSource={sortedRows}
      renderItem={(r) => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{r.name}</span>
              <span style={{ flex: '0 0 auto' }}>{r.tons.toLocaleString()} т{showAmount && r.amountCny ? ` / ¥${r.amountCny.toLocaleString()}` : ''}</span>
            </div>
            <Progress percent={Math.round((r.tons / max) * 100)} showInfo={false} strokeColor="#CC0000" />
          </div>
        </List.Item>
      )}
    />
  );
}
