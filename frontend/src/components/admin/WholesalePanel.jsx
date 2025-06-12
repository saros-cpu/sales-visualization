// src/components/admin/WholesalePanel.jsx — 批发维护
import { useState, useEffect, useCallback } from 'react';
import { fmtDate } from '../../utils/admin-helpers';
import { num } from '../../utils/format';
import { getImportBatches, rollbackBatch, organizeWholesale, deduplicateWholesale, uploadWholesaleFile, saveManualDetail, saveManualContract } from '../../api/admin';

const batchStatusLabel = (v) => ({ created: '已创建', parsed: '已解析', validated: '已校验', imported: '已导入', failed: '已回滚/失败' }[v] || v || '--');

export default function WholesalePanel({ products, customerOptions, refresh }) {
  const [batches, setBatches] = useState([]);
  const [orgStatus, setOrgStatus] = useState('');
  const [dedStatus, setDedStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [detailStatus, setDetailStatus] = useState('');
  const [contractStatus, setContractStatus] = useState('');
  const [entryType, setEntryType] = useState('detail');

  const loadBatches = useCallback(async () => {
    try { const d = await getImportBatches(); setBatches(d.items || []); } catch {}
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const productOpts = products.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name}</option>);

  const handleOrganize = async () => {
    setOrgStatus('正在整理批发数据...');
    try {
      const d = await organizeWholesale();
      const recalc = d.recalculation || {};
      setOrgStatus(`整理完成：匹配 ${num.format(recalc.matched || 0)} 条，待复核 ${num.format(recalc.unmatched || 0)} 条`);
      await loadBatches(); refresh();
    } catch (err) { setOrgStatus(err.message); }
  };

  const handleDeduplicate = async () => {
    setDedStatus('正在扫描重复...');
    try {
      const d = await deduplicateWholesale();
      setDedStatus(`扫描完成：发现 ${num.format(d.groupCount || 0)} 组疑似重复`);
      refresh();
    } catch (err) { setDedStatus(err.message); }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    const file = e.currentTarget.elements.file.files[0];
    if (!file) return;
    setUploadStatus('正在上传并识别...');
    try {
      const d = await uploadWholesaleFile(file);
      setUploadStatus(`${d.uploadLabel || '文件'} 已导入，批次 ${d.batchId}`);
      e.currentTarget.reset();
      await loadBatches(); refresh();
    } catch (err) { setUploadStatus(err.message); }
  };

  const handleRollback = async (batchId) => {
    if (!confirm(`确定回滚批次 ${batchId} 吗？`)) return;
    try { await rollbackBatch(batchId); await loadBatches(); refresh(); } catch {}
  };

  const handleDetail = async (e) => {
    e.preventDefault();
    setDetailStatus('正在保存明细...');
    try {
      const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
      const d = await saveManualDetail(payload);
      setDetailStatus(`明细已保存，批次 ${d.batchId}`);
      e.currentTarget.reset();
      await loadBatches(); refresh();
    } catch (err) { setDetailStatus(err.message); }
  };

  const handleContract = async (e) => {
    e.preventDefault();
    setContractStatus('正在保存合同...');
    try {
      const payload = Object.fromEntries(new FormData(e.currentTarget).entries());
      const d = await saveManualContract(payload);
      setContractStatus(`合同已保存，批次 ${d.batchId}`);
      e.currentTarget.reset();
      await loadBatches(); refresh();
    } catch (err) { setContractStatus(err.message); }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>批发维护</h2><span>Excel 上传识别、批发明细录入、合同录入统一放在后台</span></div>
      <section className="content-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><h2>一键整理批发数据</h2><div className="inline-filter"><button type="button" onClick={handleOrganize}>开始整理</button><button type="button" onClick={handleDeduplicate}>一键去重</button></div></div>
          <p className="form-status muted">{orgStatus}{dedStatus ? ` | ${dedStatus}` : ''}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>数据上传</h2><span>自动识别批发明细或合同登记 Excel</span></div>
          <form className="upload-drop upload-layout" onSubmit={handleUpload}><input name="file" type="file" accept=".xlsx,.xls" required /><button type="submit">上传并识别</button></form>
          <p className="form-status muted">{uploadStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>导入批次</h2><span>{num.format(batches.length)} 个批次</span></div>
          <div className="table-wrap review-scroll">
            <table><thead><tr><th>批次</th><th>来源</th><th>期间</th><th>状态</th><th>数据量</th><th>吨数</th><th>导入时间</th><th>操作</th></tr></thead><tbody>
              {batches.length ? batches.map(item => <tr key={item.id}><td>{item.id}</td><td>{item.sourceLabel}<br /><small>{item.filename || '--'}</small></td><td>{item.period || '--'}</td><td>{batchStatusLabel(item.status)}</td><td>{[item.rawRows ? `原始${num.format(item.rawRows)}` : '', item.detailRows ? `明细${num.format(item.detailRows)}` : '', item.contractRows ? `合同${num.format(item.contractRows)}` : ''].filter(Boolean).join(' / ') || '--'}</td><td>{num.format(item.detailTons || 0)}</td><td>{fmtDate(item.importedAt || item.createdAt)}</td><td>{item.status !== 'failed' ? <button type="button" onClick={() => handleRollback(item.id)}>回滚</button> : <span className="muted">--</span>}</td></tr>) : <tr><td colSpan="8">暂无导入批次</td></tr>}
            </tbody></table>
          </div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>在线录入</h2><label className="inline-filter">录入类型<select value={entryType} onChange={e => setEntryType(e.target.value)}><option value="detail">批发明细</option><option value="contract">合同</option></select></label></div>
          {entryType === 'detail' ? (
            <>
              <p className="muted">录入单条批发明细，保存后自动识别油品、客户/去向并参与当前统计。</p>
              <form className="form-grid manual-entry-form" onSubmit={handleDetail}>
                <label>日期<input name="businessDate" type="date" required /></label>
                <label>分类<select name="classification"><option value="export_wholesale">出口批发</option><option value="local_wholesale">本地批发</option><option value="transfer">外运</option><option value="processing">加工</option><option value="unknown">待识别</option></select></label>
                <label>油品<select name="productCode"><option value="">自动识别</option>{productOpts}</select></label>
                <label>客户 / 去向<input name="entityName" list="wsCustomerOpts" required /></label>
                <label>重量 KG<input name="weightKg" type="number" step="0.001" required /></label>
                <label>车号<input name="vehicleNo" /></label>
                <label>备注<input name="remark" /></label>
                <button type="submit">保存明细</button>
              </form>
              <p className="form-status muted">{detailStatus}</p>
            </>
          ) : (
            <>
              <p className="muted">录入合同信息，保存后按合同有效期重新匹配批发销售金额。</p>
              <form className="form-grid manual-entry-form" onSubmit={handleContract}>
                <label>客户<input name="customerName" list="wsCustomerOpts" required /></label>
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
                <label className="field-wide">备注<textarea name="remark" rows="2" /></label>
                <button type="submit">保存合同</button>
              </form>
              <p className="form-status muted">{contractStatus}</p>
            </>
          )}
          <datalist id="wsCustomerOpts">{customerOptions.map(c => <option key={c.name} value={c.name} />)}</datalist>
        </section>
      </section>
    </section>
  );
}
