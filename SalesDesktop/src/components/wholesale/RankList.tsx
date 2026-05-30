import { List } from 'antd';
import { sortRankingRows } from '@/utils/rankingCharts';

interface Row { name: string; tons: number; amountCny?: number; matchedRows?: number; rows?: number; }

export default function RankList({ rows, mode = 'customer' }: { rows: Row[]; mode?: 'customer' | 'pending' }) {
  const sortedRows = sortRankingRows(rows, (row) => mode === 'pending' ? row.rows : row.tons);
  return (
    <List
      size="small"
      dataSource={sortedRows}
      renderItem={(r, i) => (
        <List.Item>
          <span style={{ width: 24, flex: '0 0 auto' }}>{i + 1}.</span>
          <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{r.name}</span>
          <span style={{ flex: '0 0 auto' }}>{r.tons.toLocaleString()} т</span>
          {mode === 'customer' && r.matchedRows !== undefined && r.rows !== undefined && (
            <span style={{ marginLeft: 12, color: r.matchedRows / r.rows > 0.8 ? '#3f8600' : '#cf1322' }}>
              {r.matchedRows}/{r.rows}
            </span>
          )}
          {mode === 'pending' && (
            <span style={{ marginLeft: 12, color: '#cf1322' }}>{r.rows ?? 0} 条待复核</span>
          )}
        </List.Item>
      )}
    />
  );
}
