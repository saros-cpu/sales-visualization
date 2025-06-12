// src/components/admin/FinancePanel.jsx — 财务维护
import { useState, useEffect, useCallback } from 'react';
import { fmtDate, shortText } from '../../utils/admin-helpers';
import { num } from '../../utils/format';
import { getAdminExchangeRates, saveExchangeRate, fetchMissingRates, getDensities, saveDensity } from '../../api/admin';

export default function FinancePanel({ products, refresh }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('');
  const [fetchYear, setFetchYear] = useState(year);
  const [fetchMonth, setFetchMonth] = useState('');
  const [exchangeRows, setExchangeRows] = useState([]);
  const [densityRows, setDensityRows] = useState([]);
  const [exchangeStatus, setExchangeStatus] = useState('');
  const [densityStatus, setDensityStatus] = useState('');
  const [openGaps, setOpenGaps] = useState(0);

  const loadExchange = useCallback(async () => {
    try { const d = await getAdminExchangeRates({ year, month: month || undefined }); setExchangeRows(d.items || []); setOpenGaps(d.openGaps || 0); } catch {}
  }, [year, month]);

  const loadDensity = useCallback(async () => {
    try { const d = await getDensities(); setDensityRows(d.items || []); } catch {}
  }, []);

  useEffect(() => { loadExchange(); loadDensity(); }, [loadExchange, loadDensity]);

  const handleExchange = async (e) => {
    e.preventDefault();
    setExchangeStatus('正在保存汇率...');
    try { await saveExchangeRate(Object.fromEntries(new FormData(e.currentTarget).entries())); e.currentTarget.reset(); setExchangeStatus('汇率已保存'); await loadExchange(); refresh(); } catch (err) { setExchangeStatus(err.message); }
  };

  const handleFetchMissing = async () => {
    setExchangeStatus(`正在获取 ${fetchYear} 年${fetchMonth ? ` ${fetchMonth} 月` : ''}缺失汇率...`);
    try {
      const d = await fetchMissingRates({ year: fetchYear, month: fetchMonth || undefined });
      setExchangeStatus(d.requested ? `已获取 ${d.updated || 0} 条，补齐 ${d.resolved || 0} 条` : '没有待补齐的汇率日期');
      setYear(fetchYear); setMonth(fetchMonth);
      await loadExchange(); refresh();
    } catch (err) { setExchangeStatus(err.message); }
  };

  const handleDensity = async (e) => {
    e.preventDefault();
    setDensityStatus('正在保存密度...');
    try { await saveDensity(Object.fromEntries(new FormData(e.currentTarget).entries())); e.currentTarget.reset(); setDensityStatus('密度已保存'); await loadDensity(); refresh(); } catch (err) { setDensityStatus(err.message); }
  };

  const productOpts = products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>);
  const years = [2024, 2025, 2026];

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>财务维护</h2><span>汇率快照和密度按日期生效</span></div>
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head"><h2>汇率补录</h2><div className="inline-filter">
            <select value={fetchYear} onChange={e => setFetchYear(e.target.value)}>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select>
            <select value={fetchMonth} onChange={e => setFetchMonth(e.target.value)}><option value="">全年</option>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} 月</option>)}</select>
            <button type="button" onClick={handleFetchMissing}>获取缺失汇率</button>
          </div></div>
          <form className="form-grid single-form" onSubmit={handleExchange}>
            <label>日期<input name="rateDate" type="date" required /></label>
            <label>USD/KGS<input name="usdKgs" inputMode="decimal" placeholder="例如 87.4205" /></label>
            <label>CNY/KGS<input name="cnyKgs" inputMode="decimal" placeholder="例如 12.7955" /></label>
            <label>备注<textarea name="note" rows="3" /></label>
            <button type="submit">保存汇率并重算批发金额</button>
          </form>
          <p className="form-status muted">{exchangeStatus}</p>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>密度维护</h2><span>只影响生效日期之后的计算</span></div>
          <form className="form-grid single-form" onSubmit={handleDensity}>
            <label>油品<select name="productCode" required>{productOpts}</select></label>
            <label>密度<input name="density" inputMode="decimal" placeholder="例如 0.85" required /></label>
            <label>生效日期<input name="effectiveDate" type="date" required /></label>
            <label>备注<textarea name="note" rows="3" /></label>
            <button type="submit">保存密度</button>
          </form>
          <p className="form-status muted">{densityStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>每日汇率</h2><div className="inline-filter">
            <select value={year} onChange={e => { setYear(e.target.value); setFetchYear(e.target.value); }}>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select>
            <select value={month} onChange={e => { setMonth(e.target.value); setFetchMonth(e.target.value); }}><option value="">全年</option>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} 月</option>)}</select>
          </div></div>
          <div className="table-wrap review-scroll"><table><thead><tr><th>日期</th><th>USD/KGS</th><th>CNY/KGS</th><th>来源</th><th>状态</th><th>备注</th></tr></thead><tbody>
            {exchangeRows.length ? exchangeRows.map((item, i) => { const missing = []; if (item.missingUsd) missing.push('USD'); if (item.missingCny) missing.push('CNY'); return <tr key={i}><td>{item.date}</td><td>{item.usdKgs == null ? '--' : num.format(item.usdKgs)}</td><td>{item.cnyKgs == null ? '--' : num.format(item.cnyKgs)}</td><td>{item.isManual ? '人工' : item.source}</td><td>{missing.length ? `缺 ${missing.join('/')}` : '完整'}</td><td>{shortText(item.note, 34) || '--'}</td></tr>; }) : <tr><td colSpan="6">暂无汇率快照</td></tr>}
          </tbody></table></div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>密度历史</h2><span>按油品和生效日期排序</span></div>
          <div className="table-wrap review-scroll"><table><thead><tr><th>油品</th><th>密度</th><th>生效日期</th><th>来源</th><th>创建时间</th></tr></thead><tbody>
            {densityRows.length ? densityRows.map((item, i) => <tr key={i}><td>{item.productName}<br /><small>{item.productCode}</small></td><td>{num.format(item.density)}</td><td>{item.effectiveDate}</td><td>{item.source}</td><td>{fmtDate(item.createdAt)}</td></tr>) : <tr><td colSpan="5">暂无密度记录</td></tr>}
          </tbody></table></div>
        </section>
      </section>
    </section>
  );
}
