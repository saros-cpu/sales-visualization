// src/components/admin/AuditPanel.jsx — 审核中心
import { useState, useEffect, useCallback } from 'react';
import { num } from '../../utils/format';
import { getReviewDetails, applyReviewCorrection, getWeighAuditItems, applyWeighAudit, autoAuditWeigh } from '../../api/admin';
import { getPeriods } from '../../api/sales';

const classificationLabel = v => ({
  transfer: '外运',
  export_wholesale: '出口批发',
  local_wholesale: '本地批发',
  processing: '代加工',
  procurement: '采购',
  unknown: '待识别',
}[v] || v || '--');

export default function AuditPanel({ products, customerOptions, refresh }) {
  const [kind, setKind] = useState('contract');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('');
  const [items, setItems] = useState([]);
  const [count, setCount] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      let d;
      if (kind === 'weigh') {
        d = await getWeighAuditItems({ year, month: month || undefined });
      } else {
        d = await getReviewDetails({ kind, year, month: month || undefined });
      }
      setItems(d.items || []);
      setCount(`${num.format((d.items || []).length)} 条`);
      setStatus('');
    } catch (err) { setStatus(err.message); }
  }, [kind, year, month]);
  useEffect(() => { load(); }, [load]);

  const handleApply = async () => {
    const checked = [...document.querySelectorAll('.review-check:checked')];
    const detailIds = [...new Set(checked.map(c => c.dataset.detailId).filter(Boolean))];
    const issueIds = [...new Set(checked.map(c => c.dataset.issueId).filter(Boolean))];
    if (!detailIds.length && !issueIds.length) { setStatus('请先勾选需要处理的项目'); return; }
    setStatus('正在应用修正...');
    try {
      const fixForm = document.getElementById('reviewFixForm');
      const fd = new FormData(fixForm);
      const d = await applyReviewCorrection({ detailIds, issueIds, classification: fd.get('classification'), productCode: fd.get('productCode'), entityName: fd.get('entityName')?.trim(), issueStatus: fd.get('issueStatus') });
      setStatus(`已更新 ${d.updatedDetails || 0} 条，处理 ${d.updatedIssues || 0} 条`);
      await load(); refresh();
    } catch (err) { setStatus(err.message); }
  };

  const productOpts = products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>);
  const [years, setYears] = useState([2024, 2025, 2026]);
  useEffect(() => {
    getPeriods().then(d => { if (d.years?.length) setYears(d.years); }).catch(() => {});
  }, []);
  const isWeigh = kind === 'weigh';

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>审核中心</h2><span>运营人员在这里处理合同匹配、待复核数据和系统提示</span></div>
      <section className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><h2>待处理数据</h2><div className="inline-filter">
            <select value={kind} onChange={e => setKind(e.target.value)}><option value="contract">合同审核</option><option value="weigh">称重审核</option></select>
            <select value={year} onChange={e => setYear(e.target.value)}>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select>
            <select value={month} onChange={e => setMonth(e.target.value)}><option value="">全年</option>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m} 月</option>)}</select>
            <button type="button" onClick={load}>刷新</button>
          </div></div>
          <div className="table-wrap review-scroll">
            <table>
              <thead><tr><th><input type="checkbox" onChange={e => document.querySelectorAll('.review-check').forEach(c => c.checked = e.target.checked)} /></th>
                {isWeigh ? <><th>日期</th><th>客户</th><th>油品</th><th>车号</th><th>分类</th><th>吨数</th><th>匹配</th><th>来源</th><th>审核状态</th></> : <><th>日期</th><th>客户</th><th>标准名称</th><th>油品</th><th>分类</th><th>吨数</th><th>匹配</th><th>合同</th><th>金额</th></>}
              </tr></thead>
              <tbody>
                {items.length ? items.map((item, i) => (
                  <tr key={i}>
                    <td><input className="review-check" type="checkbox" data-detail-id={item.detailId || item.id} data-issue-id={item.id} /></td>
                    {isWeigh ? <><td>{item.date || '--'}</td><td>{item.entity || '--'}</td><td>{item.standardProduct || item.product || '--'}</td><td>{item.vehicleNo || '--'}</td><td>{classificationLabel(item.classification)}</td><td>{num.format(item.tons || 0)}</td><td>{item.matchStatus || '--'}</td><td>{item.weighSource || '储运区'}</td><td>{item.auditStatus === 'approved' ? '已通过' : item.auditStatus === 'rejected' ? '已拒绝' : '待审核'}</td></> : <><td>{item.date || '--'}</td><td>{item.entity || '--'}</td><td>{item.standardEntity || '--'}</td><td>{item.standardProduct || item.product || '--'}</td><td>{classificationLabel(item.classification)}</td><td>{num.format(item.tons || 0)}</td><td>{item.matchStatus || '--'}</td><td>{item.contractNo || '--'}</td><td>{item.amountCny == null ? '--' : num.format(item.amountCny)}</td></>}
                  </tr>
                )) : <tr><td colSpan={10}>暂无数据</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="form-status muted">{count}</p>
        </section>
          <section className="panel panel-wide">
            <div className="panel-head"><h2>批量修正</h2><span>勾选上方项目后应用</span></div>
            {isWeigh ? (
              <div className="form-grid single-form" style={{ padding: 12 }}>
                <button type="button" onClick={async () => {
                  const checked = [...document.querySelectorAll('.review-check:checked')];
                  const detailIds = [...new Set(checked.map(c => c.dataset.detailId).filter(Boolean))];
                  if (!detailIds.length) { setStatus('请先勾选需要处理的项目'); return; }
                  setStatus('正在审核通过...');
                  try {
                    const d = await applyWeighAudit({ detailIds, action: 'approve' });
                    setStatus(`已通过 ${d.updated} 条`);
                    await load();
                  } catch (err) { setStatus(err.message); }
                }}>审核通过</button>
                <button type="button" onClick={async () => {
                  const checked = [...document.querySelectorAll('.review-check:checked')];
                  const detailIds = [...new Set(checked.map(c => c.dataset.detailId).filter(Boolean))];
                  if (!detailIds.length) { setStatus('请先勾选需要处理的项目'); return; }
                  setStatus('正在拒绝...');
                  try {
                    const d = await applyWeighAudit({ detailIds, action: 'reject' });
                    setStatus(`已拒绝 ${d.updated} 条`);
                    await load();
                  } catch (err) { setStatus(err.message); }
                }}>拒绝</button>
                <button type="button" style={{ background: '#4CAF50', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 4, cursor: 'pointer' }} onClick={async () => {
                  setStatus('正在自动审核...');
                  try {
                    const d = await autoAuditWeigh({ year: parseInt(year), month: month ? parseInt(month) : undefined });
                    setStatus(`自动审核通过 ${d.updated} 条，仍待审 ${d.remaining} 条`);
                    await load();
                  } catch (err) { setStatus(err.message); }
                }}>一键自动审核</button>
              </div>
            ) : (
              <form id="reviewFixForm" className="form-grid review-correction-form">
                <label>分类<select name="classification"><option value="">不修改</option><option value="export_wholesale">出口批发</option><option value="local_wholesale">本地批发</option><option value="transfer">外运</option><option value="processing">代加工</option><option value="procurement">采购</option><option value="unknown">待识别</option></select></label>
                <label>油品<select name="productCode"><option value="">不修改</option>{productOpts}</select></label>
                <label>客户 / 去向<input name="entityName" list="auditCustomerOpts" /></label>
                <label>提示状态<select name="issueStatus"><option value="">不修改</option><option value="resolved">已解决</option><option value="ignored">忽略</option></select></label>
                <button type="button" onClick={handleApply}>应用修正</button>
              </form>
            )}
            <p className="form-status muted">{status}</p>
            <datalist id="auditCustomerOpts">{customerOptions.map(c => <option key={c.name} value={c.name} />)}</datalist>
          </section>
      </section>
    </section>
  );
}
