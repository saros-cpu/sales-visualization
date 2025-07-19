// src/pages/sales/wholesale/ReviewTab.jsx — 审核
import { num } from '../../../utils/format';

const ISSUE_LABELS = {
  contract_unmatched: '合同未匹配',
  classification_mismatch: '分类不符',
  missing_price: '缺少价格',
  missing_exchange_rate: '缺少汇率',
};

export default function ReviewTab({ data }) {
  if (!data) return null;

  // 合同审核
  const status = data.review?.status || {};
  const matched = status.matched || { rows: 0, tons: 0 };
  const review = status.needs_review || { rows: 0, tons: 0 };

  // 待复核
  const reviewRows = data.review?.topNeedsReview || [];
  // 数据审核
  const issues = data.issues || [];

  return (
    <section className="content-grid">
      <section className="panel panel-wide review-entry-card" data-review-kind="contract">
        <div className="panel-head"><h2>合同审核</h2><span>合同匹配状态</span></div>
        <div className="stack-list">
          <div className="stack-row">
            <span>已匹配合同</span>
            <strong>{num.format(matched.rows || 0)} 条</strong>
            <small>{num.format(matched.tons || 0)} 吨</small>
          </div>
          <div className="stack-row warning">
            <span>需要复核</span>
            <strong>{num.format(review.rows || 0)} 条</strong>
            <small>{num.format(review.tons || 0)} 吨</small>
          </div>
        </div>
      </section>

      <section className="panel panel-wide review-entry-card" data-review-kind="pending">
        <div className="panel-head"><h2>待复核数据</h2><span>客户 / 油品</span></div>
        <div className="review-scroll table-wrap">
          <table>
            <thead><tr><th>客户</th><th>油品</th><th>记录</th><th>吨数</th></tr></thead>
            <tbody>
              {reviewRows.length ? reviewRows.map((item, i) => (
                <tr key={i}>
                  <td>{item.entity}</td>
                  <td>{item.product}</td>
                  <td>{num.format(item.rows || 0)}</td>
                  <td>{num.format(item.tons || 0)}</td>
                </tr>
              )) : <tr><td colSpan="4">暂无待复核数据</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-wide review-entry-card" data-review-kind="issues">
        <div className="panel-head"><h2>数据审核</h2><span>需要人工处理</span></div>
        <div className="stack-list review-scroll">
          {issues.length ? issues.map((item, i) => (
            <div key={i} className={`stack-row ${item.severity === 'info' ? '' : 'warning'}`}>
              <span>{ISSUE_LABELS[item.type] || item.type}</span>
              <strong>{item.date || '未指定日期'}</strong>
              <small>{item.message}</small>
            </div>
          )) : <p className="muted">没有待处理提示</p>}
        </div>
      </section>
    </section>
  );
}
