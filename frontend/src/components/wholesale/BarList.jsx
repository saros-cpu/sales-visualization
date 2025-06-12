// src/components/wholesale/BarList.jsx — 进度条列表（油品统计等）
import { yuan, num } from '../../utils/format';

export default function BarList({ rows = [], showAmount = false }) {
  if (!rows.length) return <p className="muted">暂无数据</p>;
  const max = Math.max(...rows.map(r => r.tons), 1);

  return (
    <div className="bar-list">
      {rows.map((item, i) => (
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
