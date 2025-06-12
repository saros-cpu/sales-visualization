// src/components/wholesale/RankList.jsx — 排行列表（客户排行等）
import { yuan, num, typeLabels } from '../../utils/format';

export default function RankList({ rows = [], mode = 'customer' }) {
  if (!rows.length) return <p className="muted">暂无数据</p>;

  return (
    <div className="rank-list compact-rank">
      {rows.map((item, i) => {
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
