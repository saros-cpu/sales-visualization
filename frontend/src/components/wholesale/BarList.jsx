// src/components/wholesale/BarList.jsx — 进度条列表（油品统计等）
import { yuan, num } from '../../utils/format';

export default function BarList({ rows = [], showAmount = false }) {
  if (!rows.length) return <p className="muted">暂无数据</p>;
  const sortedRows = [...rows].sort((a, b) => Number(b.tons || 0) - Number(a.tons || 0));
  const max = Math.max(...sortedRows.map(r => r.tons), 1);

  return (
    <div className="bar-list">
      {sortedRows.map((item, i) => (
        <div key={i} className="bar-row">
          <div>
            <span>{item.name}</span>
            {showAmount && <small>{yuan.format(item.amountCny || 0)}</small>}
          </div>
          <strong>{num.format(item.tons)} 吨</strong>
          <i style={{ width: `${Math.max(4, (item.tons / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
