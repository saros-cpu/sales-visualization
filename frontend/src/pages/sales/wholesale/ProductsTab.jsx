// src/pages/sales/wholesale/ProductsTab.jsx — 油品统计
import BarList from '../../../components/wholesale/BarList';

export default function ProductsTab({ data }) {
  const groups = data?.productRankings || {};
  return (
    <section className="content-grid wide-grid">
      <section className="panel">
        <div className="panel-head"><h2>出口批发油品</h2><span>吨 / 人民币</span></div>
        <BarList rows={groups.export_wholesale || []} showAmount />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>本地批发油品</h2><span>吨 / 人民币</span></div>
        <BarList rows={groups.local_wholesale || []} showAmount />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>待识别油品</h2><span>吨数已统计</span></div>
        <BarList rows={groups.unknown || []} />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>外运油品</h2><span>只统计吨数</span></div>
        <BarList rows={groups.transfer || []} />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>采购油品</h2><span>只统计吨数</span></div>
        <BarList rows={groups.procurement || []} />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>代加工油品</h2><span>只统计吨数</span></div>
        <BarList rows={groups.processing || []} />
      </section>
    </section>
  );
}
