import { List, Progress } from 'antd';

interface Row { name: string; tons: number; amountCny?: number; }

export default function BarList({ rows, showAmount }: { rows: Row[]; showAmount?: boolean }) {
  const max = Math.max(...rows.map((r) => r.tons), 1);
  return (
    <List
      size="small"
      dataSource={rows}
      renderItem={(r) => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{r.name}</span>
              <span>{r.tons.toLocaleString()} т{showAmount && r.amountCny ? ` / ¥${r.amountCny.toLocaleString()}` : ''}</span>
            </div>
            <Progress percent={Math.round((r.tons / max) * 100)} showInfo={false} strokeColor="#CC0000" />
          </div>
        </List.Item>
      )}
    />
  );
}
