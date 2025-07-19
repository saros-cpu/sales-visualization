// src/pages/sales/wholesale/CustomersTab.jsx — 客户排行
import RankList from '../../../components/wholesale/RankList';

export default function CustomersTab({ data }) {
  const customers = data?.customerRankings || {};
  return (
    <section className="content-grid">
      <section className="panel">
        <div className="panel-head"><h2>出口客户排行</h2><span>按吨数排序</span></div>
        <RankList rows={customers.export_wholesale || []} mode="customer" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>本地客户排行</h2><span>按吨数排序</span></div>
        <RankList rows={customers.local_wholesale || []} mode="customer" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>待审核合同客户</h2><span>数量已进入统计</span></div>
        <RankList rows={customers.unknown || []} mode="pending" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>采购供应商排行</h2><span>按吨数排序</span></div>
        <RankList rows={customers.procurement || []} mode="customer" />
      </section>
      <section className="panel">
        <div className="panel-head"><h2>代加工客户排行</h2><span>按吨数排序</span></div>
        <RankList rows={customers.processing || []} mode="customer" />
      </section>
    </section>
  );
}
