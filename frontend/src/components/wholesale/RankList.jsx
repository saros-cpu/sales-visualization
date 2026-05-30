// src/components/wholesale/RankList.jsx — 排行列表（客户排行等）
import { yuan, num, typeLabels } from '../../utils/format';

export default function RankList({ rows = [], mode = 'customer', compact = true }) {
  if (!rows.length) return <p className="muted">暂无数据</p>;
  const sortedRows = [...rows].sort((a, b) => {
    const left = mode === 'pending' ? Number(a.rows || 0) : Number(a.tons || 0);
    const right = mode === 'pending' ? Number(b.rows || 0) : Number(b.tons || 0);
    return right - left;
  });

  return (
    <div className={`rank-list${compact ? ' compact-rank' : ''}`}>
      {sortedRows.map((item, i) => {
        let sub;
        if (mode === 'transfer') {
          sub = `${typeLabels[item.entityType] || item.entityType} · ${item.productCount} 种油品`;
        } else if (mode === 'pending') {
          sub = `金额待合同复核 · ${item.rows || 0} 条记录`;
        } else {
          sub = `${yuan.format(item.amountCny || 0)} · ${item.matchedRows || 0}/${item.rows || 0} 已匹配`;
        }
        return (
          <div key={i} className="rank-row">
            <b>{i + 1}</b>
            <div>
              <span>{item.name}</span>
              <small>{sub}</small>
            </div>
            <strong>{num.format(item.tons || 0)} 吨</strong>
          </div>
        );
      })}
    </div>
  );
}
