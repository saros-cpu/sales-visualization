// src/pages/sales/wholesale/OverviewTab.jsx — 批发总览
import { num, card } from '../../../utils/format';

const ISSUE_LABELS = {
  contract_unmatched: '合同未匹配',
  classification_mismatch: '分类不符',
  missing_price: '缺少价格',
  missing_exchange_rate: '缺少汇率',
};

const OPERATION_ITEMS = [
  { key: 'loading-truck', operation: 'loading', transport: 'truck', label: '汽车装车', tone: 'combined', borderLeftColor: '#607D8B' },
  { key: 'loading-train', operation: 'loading', transport: 'train', label: '火车装车', tone: 'combined', borderLeftColor: '#1677ff' },
  { key: 'unloading-truck', operation: 'unloading', transport: 'truck', label: '汽车卸车', tone: 'combined', borderLeftColor: '#4CAF50' },
  { key: 'unloading-train', operation: 'unloading', transport: 'train', label: '火车卸车', tone: 'processing', borderLeftColor: '#FF9800' },
];

const CLASS_SUMMARY_ITEMS = [
  { key: 'export_wholesale', label: '出口批发', tone: 'wholesale', entityLabel: '客户', caption: '人民币销售额', showAmount: true, borderLeftColor: '#ffa726' },
  { key: 'local_wholesale', label: '本地批发', tone: 'retail', entityLabel: '客户', caption: '人民币销售额', showAmount: true, borderLeftColor: '#00e5a0' },
  { key: 'unknown', label: '待识别批发', tone: 'pending', entityLabel: '客户', caption: '数量已统计，金额待合同复核', goodWhen: 'down', borderLeftColor: '#ffcc66' },
  { key: 'transfer', label: '外运', tone: 'combined', entityLabel: '去向', caption: '外运只统计重量', borderLeftColor: '#00d4ff' },
  { key: 'procurement', label: '采购', tone: 'processing', entityLabel: '供应商', caption: '采购卸车统计', borderLeftColor: '#FF9800' },
  { key: 'processing', label: '代加工', tone: 'processing', entityLabel: '客户', caption: '外部加工统计', borderLeftColor: '#9C27B0' },
];

function compareColor(value, goodWhen = 'up') {
  if (!Number.isFinite(value) || value === 0) return '#b8c2d8';
  const good = goodWhen === 'down' ? value < 0 : value > 0;
  return good ? '#6ee7a8' : '#ff8a8a';
}

function CompareLine({ label, value, goodWhen }) {
  if (!Number.isFinite(value)) {
    return (
      <div className="wholesale-class-compare-line is-empty">
        <span className="wholesale-class-compare-label">{label}</span>
        <span className="wholesale-class-compare-value">
          <span className="wholesale-class-compare-main">
            <span className="wholesale-class-compare-arrow" />
            <span className="wholesale-class-compare-number">--</span>
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="wholesale-class-compare-line">
      <span className="wholesale-class-compare-label">{label}</span>
      <span className="wholesale-class-compare-value" style={{ color: compareColor(value, goodWhen) }}>
        <span className="wholesale-class-compare-main">
          <span className="wholesale-class-compare-arrow">{value > 0 ? '↑' : value < 0 ? '↓' : ''}</span>
          <span className="wholesale-class-compare-number">{num.format(Math.abs(value))}</span>
        </span>
        <span className="wholesale-class-compare-percent">%</span>
      </span>
    </div>
  );
}

function OperationCard({ item, values }) {
  return (
    <article className={`metric-panel ${item.tone} wholesale-transport-metric`} style={{ '--metric-accent': item.borderLeftColor }}>
      <span>{item.label}</span>
      <strong>{num.format(values.tons || 0)} 吨</strong>
      <small>批发明细按装卸与运输方式统计</small>
      <dl>
        <div><dt>单位</dt><dd>{num.format(values.entities || 0)} 个</dd></div>
        <div><dt>记录</dt><dd>{num.format(values.rows || 0)} 条</dd></div>
      </dl>
    </article>
  );
}

function SummaryCard({ item }) {
  const amountText = item.showAmount ? ` | CNY ${num.format(item.values.amountCny || 0)}` : '';
  const goodWhen = item.goodWhen || 'up';

  return (
    <article className={`metric-panel ${item.tone} wholesale-class-metric`} style={{ '--metric-accent': item.borderLeftColor }}>
      <div className="wholesale-class-body">
        <div className="wholesale-class-left">
          <div className="wholesale-class-title">{item.label}</div>
          <div className="wholesale-class-value">{num.format(item.values.tons || 0)} 吨</div>
          <div className="wholesale-class-extra">
            {item.entityLabel}: {num.format(item.values.entities || 0)} 个 | 记录: {num.format(item.values.rows || 0)} 条{amountText}
          </div>
        </div>
        <div className="wholesale-class-right">
          <CompareLine label="环比" value={item.comparison.momTons} goodWhen={goodWhen} />
          <CompareLine label="同比" value={item.comparison.yoyTons} goodWhen={goodWhen} />
        </div>
      </div>
    </article>
  );
}

export default function OverviewTab({ data }) {
  if (!data) return null;

  const operationCards = OPERATION_ITEMS.map((item) => ({
    ...item,
    values: data.operationTransportSummary?.[item.operation]?.[item.transport] || { rows: 0, entities: 0, tons: 0 },
  }));
  const summaryCards = CLASS_SUMMARY_ITEMS.map((item) => ({
    ...item,
    values: card(data, item.key),
    comparison: data.comparison?.[item.key] || {},
  }));

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
      <section className="summary-grid wholesale-transport-grid">
        {operationCards.map(item => <OperationCard key={item.key} item={item} values={item.values} />)}
      </section>

      <section className="wholesale-summary-kpi-grid">
        {summaryCards.map(item => <SummaryCard key={item.key} item={item} />)}
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
