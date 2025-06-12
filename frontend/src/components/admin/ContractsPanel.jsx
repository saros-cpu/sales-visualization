// src/components/admin/ContractsPanel.jsx — 合同管理
import { useState, useEffect, useCallback } from 'react';
import { fmtDate } from '../../utils/admin-helpers';
import { num } from '../../utils/format';
import { getContracts, saveContract, getProducts } from '../../api/admin';
import { getPeriods } from '../../api/sales';

const salesTypeLabel = v => ({ export_wholesale: '出口批发', local_wholesale: '本地批发', internal: '内部', unknown: '待识别' }[v] || v || '--');

export default function ContractsPanel({ products, customerOptions, refresh }) {
  const [contracts, setContracts] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ year: String(new Date().getFullYear()), month: '', salesType: '', productCode: '', customer: '' });
  const [editId, setEditId] = useState(null);
  const [editStatus, setEditStatus] = useState('');
  const [listStatus, setListStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await getContracts(filters);
      setContracts(d.items || []);
      setTotal(d.total || 0);
      setListStatus(`${num.format(d.total || 0)} 条合同`);
    } catch (err) { setListStatus(err.message); }
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const handleEdit = (id) => {
    const item = contracts.find(c => String(c.id) === String(id));
    if (!item) return;
    setEditId(item.id);
    setEditStatus('');
    const form = document.getElementById('contractEditForm');
    if (form) {
      const set = (name, val) => { if (form.elements[name]) form.elements[name].value = val ?? ''; };
      set('id', item.id); set('customerName', item.rawCustomerName || item.customerName);
      set('contractNo', item.contractNo); set('appendixNo', item.appendixNo);
      set('salesType', item.salesType); set('signedDate', item.signedDate);
      set('effectiveStart', item.effectiveStart); set('effectiveEnd', item.effectiveEnd);
      set('productCode', item.productCode); set('productName', item.rawProductName || item.productName);
      set('destination', item.destination); set('priceWithLogistics', item.priceWithLogistics);
      set('priceWithoutLogistics', item.priceWithoutLogistics); set('quantityTons', item.quantityTons);
      set('amountOriginal', item.amountOriginal); set('currencyCode', item.currencyCode || 'KGS');
      set('remark', item.remark);
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editId) { setEditStatus('请先从合同列表选择合同'); return; }
    const form = e.currentTarget;  // capture before await
    setEditStatus('正在保存合同并重算...');
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      await fetch(`/api/admin/contracts/${editId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || '保存失败'); return d; });
      setEditStatus('合同已保存，批发金额已重新计算');
      setEditId(null);
      await load(); refresh();
    } catch (err) { setEditStatus(err.message); }
  };

  const productOpts = products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>);
  const [years, setYears] = useState([2024, 2025, 2026]);

  useEffect(() => {
    getPeriods().then(d => {
      if (d.years?.length) setYears(d.years);
    }).catch(() => {});
  }, []);

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>合同管理</h2><span>维护合同价格、有效期、币种和匹配状态</span></div>
      <section className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><h2>合同列表</h2><div className="inline-filter">
            <select value={filters.year} onChange={e => setFilters(f => ({...f, year: e.target.value}))}>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select>
            <select value={filters.month} onChange={e => setFilters(f => ({...f, month: e.target.value}))}><option value="">全年</option>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} 月</option>)}</select>
            <select value={filters.salesType} onChange={e => setFilters(f => ({...f, salesType: e.target.value}))}><option value="">全部类型</option><option value="export_wholesale">出口批发</option><option value="local_wholesale">本地批发</option><option value="internal">内部</option><option value="unknown">待识别</option></select>
            <select value={filters.productCode} onChange={e => setFilters(f => ({...f, productCode: e.target.value}))}><option value="">全部油品</option>{productOpts}</select>
            <input placeholder="客户筛选" value={filters.customer} onChange={e => setFilters(f => ({...f, customer: e.target.value}))} onKeyDown={e => e.key === 'Enter' && load()} />
            <button type="button" onClick={load}>筛选</button>
          </div></div>
          <div className="table-wrap review-scroll">
            <table><thead><tr><th>合同</th><th>客户</th><th>油品</th><th>有效期</th><th>单价</th><th>币种</th><th>匹配</th><th>金额</th><th>操作</th></tr></thead><tbody>
              {contracts.length ? contracts.map(item => {
                const price = item.priceWithoutLogistics ?? item.priceWithLogistics;
                return <tr key={item.id}><td>{item.contractNo || '--'}<br /><small>{item.appendixNo || ''}</small></td><td>{item.customerName || '--'}<br /><small>{salesTypeLabel(item.salesType)}</small></td><td>{item.productName || '--'}<br /><small>{item.productCode || '--'}</small></td><td>{item.effectiveStart || '--'} 至 {item.effectiveEnd || '--'}</td><td>{price == null ? '--' : `${num.format(price)}`}</td><td>{item.currencyCode || 'KGS'}</td><td>{num.format(item.matchedRows || 0)} 条<br /><small>{num.format(item.matchedTons || 0)} 吨</small></td><td>{item.amountCny == null ? '--' : num.format(item.amountCny)}</td><td><button type="button" onClick={() => handleEdit(item.id)}>编辑</button></td></tr>;
              }) : <tr><td colSpan="9">暂无合同</td></tr>}
            </tbody></table>
          </div>
          <p className="form-status muted">{listStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>合同编辑</h2><span>{editId ? `正在编辑合同` : '从上方列表选择合同'}</span></div>
          <form id="contractEditForm" className="form-grid" onSubmit={handleSave}>
            <input name="id" type="hidden" />
            <label>客户<input name="customerName" list="contractCustomerOpts" required /></label>
            <label>合同号<input name="contractNo" required /></label>
            <label>附件号<input name="appendixNo" /></label>
            <label>销售类型<select name="salesType"><option value="export_wholesale">出口批发</option><option value="local_wholesale">本地批发</option><option value="internal">内部</option><option value="unknown">待识别</option></select></label>
            <label>签订日期<input name="signedDate" type="date" /></label>
            <label>生效开始<input name="effectiveStart" type="date" /></label>
            <label>生效结束<input name="effectiveEnd" type="date" /></label>
            <label>油品<select name="productCode"><option value="">自动识别</option>{productOpts}</select></label>
            <label>原始油品名<input name="productName" /></label>
            <label>到站 / 目的地<input name="destination" /></label>
            <label>含物流单价<input name="priceWithLogistics" type="number" step="0.000001" /></label>
            <label>不含物流单价<input name="priceWithoutLogistics" type="number" step="0.000001" /></label>
            <label>合同吨数<input name="quantityTons" type="number" step="0.001" /></label>
            <label>合同金额<input name="amountOriginal" type="number" step="0.01" /></label>
            <label>币种<select name="currencyCode"><option value="KGS">KGS</option><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
            <label className="field-wide">备注<textarea name="remark" rows="3" /></label>
            <button type="submit">保存合同并重算</button>
          </form>
          <p className="form-status muted">{editStatus}</p>
          <datalist id="contractCustomerOpts">{customerOptions.map(c => <option key={c.name} value={c.name} />)}</datalist>
        </section>
      </section>
    </section>
  );
}
