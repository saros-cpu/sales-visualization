// src/pages/sales/wholesale/OverviewTab.jsx — 批发总览
import { yuan, num, card } from '../../../utils/format';

const ISSUE_LABELS = {
  contract_unmatched: '合同未匹配',
  classification_mismatch: '分类不符',
  missing_price: '缺少价格',
  missing_exchange_rate: '缺少汇率',
};

export default function OverviewTab({ data }) {
  if (!data) return null;

  const exportCard = card(data, 'export_wholesale');
  const localCard = card(data, 'local_wholesale');
  const pendingCard = card(data, 'unknown');
  const transferCard = card(data, 'transfer');
  const procurementCard = card(data, 'procurement');
  const processingCard = card(data, 'processing');

  // 合同审核
  const status = data.review?.status || {};
  const matched = status.matched || { rows: 0, tons: 0 };
  const review = status.needs_review || { rows: 0, tons: 0 };

  // 待复核
  const reviewRows = data.review?.topNeedsReview || [];
  // 数据审核
  const issues = data.issues || [];

  return (
    <>
      <section className="summary-grid">
        <article className="metric-panel wholesale">
          <span>出口批发</span>
          <strong>{yuan.format(exportCard.amountCny || 0)}</strong>
          <small>人民币销售额</small>
          <dl>
            <div><dt>吨数</dt><dd>{num.format(exportCard.tons || 0)} 吨</dd></div>
            <div><dt>客户</dt><dd>{num.format(exportCard.entities || 0)} 个</dd></div>
          </dl>
        </article>
        <article className="metric-panel retail">
          <span>本地批发</span>
          <strong>{yuan.format(localCard.amountCny || 0)}</strong>
          <small>人民币销售额</small>
          <dl>
            <div><dt>吨数</dt><dd>{num.format(localCard.tons || 0)} 吨</dd></div>
            <div><dt>客户</dt><dd>{num.format(localCard.entities || 0)} 个</dd></div>
          </dl>
        </article>
        <article className="metric-panel pending">
          <span>待审核批发</span>
          <strong>{num.format(pendingCard.tons || 0)} 吨</strong>
          <small>数量已统计，金额待合同复核</small>
          <dl>
            <div><dt>客户</dt><dd>{num.format(pendingCard.entities || 0)} 个</dd></div>
            <div><dt>记录</dt><dd>{num.format(pendingCard.rows || 0)} 条</dd></div>
          </dl>
        </article>
        <article className="metric-panel combined">
          <span>外运</span>
          <strong>{num.format(transferCard.tons || 0)} 吨</strong>
          <small>外运只统计重量</small>
          <dl>
            <div><dt>去向</dt><dd>{num.format(transferCard.entities || 0)} 个</dd></div>
            <div><dt>记录</dt><dd>{num.format(transferCard.rows || 0)} 条</dd></div>
          </dl>
        </article>
        <article className="metric-panel processing" style={{borderLeftColor:'#FF9800'}}>
          <span>采购入库</span>
          <strong>{num.format(procurementCard.tons || 0)} 吨</strong>
          <small>外部采购</small>
          <dl>
            <div><dt>供应商</dt><dd>{num.format(procurementCard.entities || 0)} 个</dd></div>
            <div><dt>记录</dt><dd>{num.format(procurementCard.rows || 0)} 条</dd></div>
          </dl>
        </article>
        <article className="metric-panel processing" style={{borderLeftColor:'#9C27B0'}}>
          <span>代加工</span>
          <strong>{num.format(processingCard.tons || 0)} 吨</strong>
          <small>外部加工</small>
          <dl>
            <div><dt>客户</dt><dd>{num.format(processingCard.entities || 0)} 个</dd></div>
            <div><dt>记录</dt><dd>{num.format(processingCard.rows || 0)} 条</dd></div>
          </dl>
        </article>
      </section>

      <section className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><h2>合同审核</h2><span>待复核优先</span></div>
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

        <section className="panel">
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

        <section className="panel">
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
    </>
  );
}
