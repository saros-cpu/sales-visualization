// src/pages/sales/wholesale/TransferTab.jsx — 外运详情
import { useState } from 'react';
import { num } from '../../../utils/format';
import BarList from '../../../components/wholesale/BarList';

export default function TransferTab({ data }) {
  const summary = data?.transferSummary || {};
  const [region, setRegion] = useState('');

  const byRegion = summary.byRegion || [];
  const byProduct = summary.byProduct || [];

  const regionRows = (summary.byRegionProduct || [])
    .filter(item => !region || item.region === region);

  // 按区域分组
  const grouped = new Map();
  regionRows.forEach(item => {
    if (!grouped.has(item.region)) grouped.set(item.region, []);
    grouped.get(item.region).push(item);
  });

  return (
    <section className="content-grid">
      <section className="panel">
        <div className="panel-head"><h2>外运区域汇总</h2><span>参考零售区域</span></div>
        <BarList rows={byRegion.map(r => ({ name: r.region, tons: r.tons }))} />
      </section>

      <section className="panel">
        <div className="panel-head"><h2>外运油品汇总</h2><span>按吨数排序</span></div>
        <BarList rows={byProduct.map(p => ({ name: p.name, tons: p.tons }))} />
      </section>

      <section className="panel panel-wide">
        <div className="panel-head">
          <h2>区域 / 油品明细</h2>
          <label className="inline-filter">
            区域
            <select value={region} onChange={e => setRegion(e.target.value)}>
              <option value="">全部区域</option>
              {byRegion.map(r => (
                <option key={r.region} value={r.region}>{r.region}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>区域</th><th>油品</th><th>记录</th><th>吨数</th></tr></thead>
            <tbody>
              {[...grouped.entries()].length ? (
                [...grouped.entries()].map(([rgn, rows]) =>
                  rows.map((item, i) => (
                    <tr key={`${rgn}-${i}`}>
                      {i === 0 && (
                        <td className="transfer-region-cell" rowSpan={rows.length}>{rgn}</td>
                      )}
                      <td>{item.product}</td>
                      <td>{num.format(item.rows || 0)}</td>
                      <td>{num.format(item.tons || 0)}</td>
                    </tr>
                  ))
                )
              ) : (
                <tr><td colSpan="4">暂无外运汇总数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
