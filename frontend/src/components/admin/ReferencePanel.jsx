// src/components/admin/ReferencePanel.jsx — 基础资料
import { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDate, entityTypeLabel } from '../../utils/admin-helpers';
import { num } from '../../utils/format';
import { getCustomers, saveCustomer, getEntityAliases, saveEntityAlias, getProducts, saveProductAlias, getEntityOptions } from '../../api/admin';

const salesTypeLabel = v => ({ export_wholesale: '出口批发', local_wholesale: '本地批发', mixed: '混合', unknown: '待识别' }[v] || v || '--');

export default function ReferencePanel({ products, refresh }) {
  const [customers, setCustomers] = useState([]);
  const [aliases, setAliases] = useState([]);
  const [cFilter, setCFilter] = useState({ type: '', keyword: '' });
  const [aFilter, setAFilter] = useState({ entityType: '', keyword: '' });
  const [customerStatus, setCustomerStatus] = useState('');
  const [aliasStatus, setAliasStatus] = useState('');
  const [productAliasStatus, setProductAliasStatus] = useState('');
  const [entityOptions, setEntityOptions] = useState([]);
  const [currentEntityType, setCurrentEntityType] = useState('');
  const [entityCode, setEntityCode] = useState('');
  const stdNameRef = useRef(null);

  const loadCustomers = useCallback(async () => {
    try { const d = await getCustomers(cFilter); setCustomers(d.items || []); } catch {}
  }, [cFilter]);
  const loadAliases = useCallback(async () => {
    try { const d = await getEntityAliases(aFilter); setAliases(d.items || []); } catch {}
  }, [aFilter]);

  const loadEntityOptions = useCallback(async () => {
    try { const d = await getEntityOptions(); setEntityOptions(d.items || []); } catch {}
  }, []);

  useEffect(() => { loadCustomers(); loadAliases(); loadEntityOptions(); }, [loadCustomers, loadAliases, loadEntityOptions]);

  const handleCustomer = async (e) => {
    e.preventDefault(); setCustomerStatus('正在保存...');
    try { await saveCustomer(Object.fromEntries(new FormData(e.currentTarget).entries())); e.currentTarget.reset(); setCustomerStatus('客户已保存'); await loadCustomers(); refresh(); } catch (err) { setCustomerStatus(err.message); }
  };
  const handleAlias = async (e) => {
    e.preventDefault(); setAliasStatus('正在保存...');
    try { await saveEntityAlias(Object.fromEntries(new FormData(e.currentTarget).entries())); e.currentTarget.reset(); setAliasStatus('实体别名已保存'); await loadAliases(); refresh(); } catch (err) { setAliasStatus(err.message); }
  };

  const handleProductAlias = async (e) => {
    e.preventDefault(); setProductAliasStatus('正在保存...');
    try { await saveProductAlias(Object.fromEntries(new FormData(e.currentTarget).entries())); e.currentTarget.reset(); setProductAliasStatus('油品别名已保存'); refresh(); } catch (err) { setProductAliasStatus(err.message); }
  };

  const productOpts = products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>);

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>基础资料</h2><span>油品字典和别名规则</span></div>
      <section className="content-grid reference-grid">
        <section className="panel reference-customer-panel">
          <div className="panel-head"><h2>客户资料</h2><span>出口/本地批发客户</span></div>
          <form className="form-grid single-form" onSubmit={handleCustomer}><label>客户名称<input name="name" required /></label><label>客户类型<select name="customerType"><option value="unknown">待识别</option><option value="local_wholesale">本地批发</option><option value="export_wholesale">出口批发</option><option value="mixed">混合</option></select></label><button type="submit">保存客户</button></form>
          <p className="form-status muted">{customerStatus}</p>
        </section>
        <section className="panel reference-product-panel">
          <div className="panel-head"><h2>油品别名</h2><span>用于 Excel 自动识别</span></div>
          <form className="form-grid single-form" onSubmit={handleProductAlias}><label>标准油品<select name="productCode" required>{productOpts}</select></label><label>新增别名<input name="aliasName" required /></label><button type="submit">保存别名</button></form>
          <p className="form-status muted">{productAliasStatus}</p>
        </section>
        <section className="panel reference-entity-panel">
          <div className="panel-head"><h2>实体别名</h2><span>加油站、油库、客户名称识别</span></div>
          <form className="form-grid single-form" onSubmit={handleAlias}>
            <label>实体类型<select name="entityType" onChange={e => { setCurrentEntityType(e.target.value); setEntityCode(''); if (stdNameRef.current) stdNameRef.current.value = ''; }}><option value="retail_station">加油站</option><option value="own_depot">自营油库</option><option value="wholesale_customer">批发客户</option><option value="unknown">其他</option></select></label>
            <label>标准实体<select onChange={e => { const idx = parseInt(e.target.value); if (isNaN(idx)) return; const items = entityOptions.filter(o => o.entityType === currentEntityType); const item = items[idx]; if (item) { if (stdNameRef.current) stdNameRef.current.value = item.name; setEntityCode(item.entityCode || ''); } }}><option value="">手动填写</option>{entityOptions.filter(o => o.entityType === currentEntityType).map((item, i) => <option key={i} value={i}>{item.label}</option>)}</select></label>
            <label>标准名称<input name="standardName" ref={stdNameRef} required /></label>
            <label>录入别名<input name="aliasName" required /></label>
            <label>匹配可信度<input name="confidence" type="number" min="1" max="100" defaultValue="100" /></label>
            <button type="submit">保存实体别名</button>
            <input name="entityCode" type="hidden" value={entityCode} />
          </form>
          <p className="form-status muted">{aliasStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>客户列表</h2><div className="inline-filter">
            <select value={cFilter.type} onChange={e => setCFilter(f => ({...f, type: e.target.value}))}><option value="">全部客户</option><option value="local_wholesale">本地批发</option><option value="export_wholesale">出口批发</option><option value="mixed">混合</option><option value="unknown">待识别</option></select>
            <input placeholder="客户名称" value={cFilter.keyword} onChange={e => setCFilter(f => ({...f, keyword: e.target.value}))} onKeyDown={e => e.key === 'Enter' && loadCustomers()} />
            <button type="button" onClick={loadCustomers}>筛选</button>
          </div></div>
          <div className="table-wrap review-scroll"><table><thead><tr><th>客户</th><th>类型</th><th>合同</th><th>明细</th><th>吨数</th><th>更新时间</th></tr></thead><tbody>
            {customers.length ? customers.map((item, i) => <tr key={i}><td>{item.name}</td><td>{salesTypeLabel(item.customerType)}</td><td>{num.format(item.contractCount || 0)}</td><td>{num.format(item.detailCount || 0)}</td><td>{num.format(item.detailTons || 0)}</td><td>{fmtDate(item.updatedAt || item.createdAt)}</td></tr>) : <tr><td colSpan="6">暂无客户资料</td></tr>}
          </tbody></table></div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>实体别名列表</h2><div className="inline-filter">
            <select value={aFilter.entityType} onChange={e => setAFilter(f => ({...f, entityType: e.target.value}))}><option value="">全部实体</option><option value="retail_station">加油站</option><option value="own_depot">自营油库</option><option value="wholesale_customer">批发客户</option><option value="unknown">其他</option></select>
            <input placeholder="标准名或别名" value={aFilter.keyword} onChange={e => setAFilter(f => ({...f, keyword: e.target.value}))} onKeyDown={e => e.key === 'Enter' && loadAliases()} />
            <button type="button" onClick={loadAliases}>筛选</button>
          </div></div>
          <div className="table-wrap review-scroll"><table><thead><tr><th>类型</th><th>标准名称</th><th>实体编码</th><th>别名</th><th>可信度</th><th>来源</th></tr></thead><tbody>
            {aliases.length ? aliases.map((item, i) => <tr key={i}><td>{entityTypeLabel(item.entityType)}</td><td>{item.standardName}</td><td>{item.entityCode || '--'}</td><td>{item.aliasName}</td><td>{item.confidence}</td><td>{item.source}</td></tr>) : <tr><td colSpan="6">暂无实体别名</td></tr>}
          </tbody></table></div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>油品字典</h2><span>标准名称 / 归并规则</span></div>
          <div className="table-wrap review-scroll"><table><thead><tr><th>编码</th><th>标准名称</th><th>类别</th><th>零售资源</th><th>别名</th></tr></thead><tbody>
            {products.length ? products.map((item, i) => <tr key={i}><td>{item.code}</td><td>{item.name}</td><td>{item.category}</td><td>{item.retailResourceKey || '--'}</td><td>{(item.aliases || []).map(a => a.name).join(' / ') || '--'}</td></tr>) : <tr><td colSpan="5">暂无油品字典</td></tr>}
          </tbody></table></div>
        </section>
      </section>
    </section>
  );
}
