import { List } from 'antd';

interface Row { name: string; tons: number; amountCny?: number; matchedRows?: number; rows?: number; }

export default function RankList({ rows, mode = 'customer' }: { rows: Row[]; mode?: 'customer' | 'pending' }) {
  return (
    <List
      size="small"
      dataSource={rows}
      renderItem={(r, i) => (
        <List.Item>
          <span style={{ width: 24 }}>{i + 1}.</span>
          <span style={{ flex: 1 }}>{r.name}</span>
          <span>{r.tons.toLocaleString()} т</span>
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
