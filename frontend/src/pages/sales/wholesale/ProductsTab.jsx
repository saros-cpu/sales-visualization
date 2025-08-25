// src/pages/sales/wholesale/ProductsTab.jsx - 油品统计
import BarList from '../../../components/wholesale/BarList';

export default function ProductsTab({ data }) {
  const groups = data?.productRankings || {};
  const stackGroups = [
    { key: 'export_wholesale', title: '出口批发油品', note: '吨 / 人民币', rows: groups.export_wholesale || [], showAmount: true },
    { key: 'transfer', title: '外运油品', note: '只统计吨数', rows: groups.transfer || [] },
    { key: 'procurement', title: '采购油品', note: '只统计吨数', rows: groups.procurement || [] },
    { key: 'processing', title: '代加工油品', note: '只统计吨数', rows: groups.processing || [] },
    { key: 'unknown', title: '待识别油品', note: '吨数已统计', rows: groups.unknown || [] },
  ].filter(item => item.rows.length);
  const localRows = groups.local_wholesale || [];

  return (
    <section className="content-grid product-stat-layout">
      <div className="product-stat-stack">
        {stackGroups.length ? stackGroups.map(item => (
          <section className="panel product-stack-panel" key={item.key}>
            <div className="panel-head"><h2>{item.title}</h2><span>{item.note}</span></div>
            <BarList rows={item.rows} showAmount={item.showAmount} />
          </section>
        )) : (
          <section className="panel product-stack-panel">
            <div className="panel-head"><h2>出口批发 / 外运 / 采购</h2><span>吨数统计</span></div>
            <p className="muted">暂无数据</p>
          </section>
        )}
      </div>

      <section className="panel product-local-panel no-panel-scroll">
        <div className="panel-head"><h2>本地批发油品</h2><span>吨 / 人民币</span></div>
        <BarList rows={localRows} showAmount />
      </section>
    </section>
  );
}
