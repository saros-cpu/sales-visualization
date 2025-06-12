// src/components/admin/MarketPanel.jsx — 市场观察
import { useState, useEffect, useCallback } from 'react';
import { getMarketWatch, saveMarketWatch, fetchMarketWatch } from '../../api/admin';
import { post } from '../../api/client';

export default function MarketPanel({ refresh }) {
  const [items, setItems] = useState([]);
  const [fetchStatus, setFetchStatus] = useState('');
  const [formStatus, setFormStatus] = useState('');

  const load = useCallback(async () => {
    try { const d = await getMarketWatch(); setItems(d.items || []); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleFetch = async () => {
    setFetchStatus('正在获取市场观察...');
    try {
      const d = await fetchMarketWatch();
      setFetchStatus(`已新增 ${d.inserted || 0} 条市场观察${(d.errors || []).length ? `，${d.errors.length} 个来源获取失败` : ''}`);
      await load(); refresh();
    } catch (err) { setFetchStatus(err.message); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormStatus('正在保存...');
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      await saveMarketWatch(payload);
      form.reset();
      setFormStatus('市场观察已保存');
      await load(); refresh();
    } catch (err) { setFormStatus(err.message); }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>市场观察</h2><span>维护主页近期国际原油与成品油市场信息</span></div>
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head"><h2>一键获取</h2><button type="button" onClick={handleFetch}>获取市场观察</button></div>
          <div className="stack-list">
            <div className="stack-row"><span>重点区域</span><strong>俄罗斯 / 乌兹别克</strong><small>成品油统一为索姆/升</small></div>
            <div className="stack-row"><span>辅助参考</span><strong>国际市场</strong><small>Brent、WTI、库存</small></div>
            <div className="stack-row"><span>展示位置</span><strong>主页市场观察</strong><small>最新优先</small></div>
          </div>
          <p className="form-status muted">{fetchStatus}</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>手工录入</h2><span>用于补充运营判断</span></div>
          <form className="form-grid single-form" onSubmit={handleSubmit}>
            <label>区域<select name="region"><option value="Russia">俄罗斯</option><option value="Uzbekistan">乌兹别克</option><option value="Global">国际</option></select></label>
            <label>类型<select name="type"><option value="refined">成品油</option><option value="crude">原油</option><option value="policy">政策</option><option value="logistics">物流</option><option value="other">其他</option></select></label>
            <label>日期<input name="observedAt" type="date" /></label>
            <label>优先级<input name="priority" inputMode="numeric" defaultValue="100" /></label>
            <label>价格信息<input name="priceText" placeholder="成品油例如：柴油 70.00 索姆/升" /></label>
            <label>标题<input name="title" required /></label>
            <label>来源名称<input name="sourceName" /></label>
            <label>来源链接<input name="sourceUrl" /></label>
            <label>摘要<textarea name="summary" rows="4" required /></label>
            <button type="submit">保存市场观察</button>
          </form>
          <p className="form-status muted">{formStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>市场观察列表</h2><span>最新 80 条</span></div>
          <div className="table-wrap review-scroll">
            <table>
              <thead><tr><th>日期</th><th>区域</th><th>类型</th><th>价格信息</th><th>标题</th><th>来源</th><th>摘要</th></tr></thead>
              <tbody>
                {items.length ? items.map((item, i) => (
                  <tr key={i}><td>{item.observedAt || '--'}</td><td>{item.regionLabel || item.region || '--'}</td><td>{item.typeLabel || item.type || '--'}</td><td>{item.priceText || '--'}</td><td>{item.title || '--'}</td><td>{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noopener">{item.sourceName || '来源'}</a> : (item.sourceName || '--')}</td><td>{item.summary || '--'}</td></tr>
                )) : <tr><td colSpan="7">暂无市场观察数据</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  );
}
