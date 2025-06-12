// src/components/admin/RetailPanel.jsx — 零售维护
import { useState, useEffect, useCallback } from 'react';
import { fmtDate } from '../../utils/admin-helpers';
import { getStationCatalog, getStationStatuses, saveStationStatus, closeStationStatus } from '../../api/admin';

export default function RetailPanel({ refresh }) {
  const [catalog, setCatalog] = useState([]);
  const [statusTypes, setStatusTypes] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [formStatus, setFormStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const [catData, stData] = await Promise.all([getStationCatalog(), getStationStatuses()]);
      setCatalog(catData.items || []);
      setStatusTypes(stData.statusTypes || {});
      setStatuses(stData.items || []);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.shopKey = Number(payload.shopKey);
    payload.affectsSales = form.has('affectsSales');
    payload.affectsInventory = form.has('affectsInventory');
    payload.suppressAlerts = form.has('suppressAlerts');
    setFormStatus('正在保存...');
    try {
      await saveStationStatus(payload);
      setFormStatus('站点状态已保存');
      await load(); refresh();
    } catch (err) { setFormStatus(err.message); }
  };

  const handleClose = async (id) => {
    await closeStationStatus(id);
    await load(); refresh();
  };

  // 状态类型切换时自动联动 checkbox
  const handleStatusTypeChange = (e) => {
    const type = e.target.value;
    const form = e.currentTarget.form;
    const statusLabel = form.querySelector('[name="statusLabel"]');
    const affects = form.querySelector('[name="affectsSales"]');
    const inventory = form.querySelector('[name="affectsInventory"]');
    const suppress = form.querySelector('[name="suppressAlerts"]');
    if (statusLabel) statusLabel.value = statusTypes[type] || '';
    const abnormal = !['normal', 'data_anomaly'].includes(type);
    if (affects) affects.checked = abnormal;
    if (inventory) inventory.checked = abnormal;
    if (suppress) suppress.checked = false;
    if (type === 'normal') {
      if (affects) affects.checked = false;
      if (inventory) inventory.checked = false;
    }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>零售维护</h2><span>站点营业状态同步到零售预警、站点、区域和报表页面</span></div>
      <div className="admin-workbench">
        <section className="panel admin-form-panel">
          <div className="panel-head"><h2>加油站状态</h2><span>选择站点后保存</span></div>
          <form className="form-grid admin-status-form" onSubmit={handleSubmit}>
            <label className="field-wide">加油站<select name="shopKey" required>{catalog.map(s => <option key={s.shopKey} value={s.shopKey}>{s.shopKey} · {s.name}（{s.short}）</option>)}</select></label>
            <label>状态类型<select name="statusType" required onChange={handleStatusTypeChange}>{Object.entries(statusTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>状态标签<input name="statusLabel" placeholder="正常营业 / 装修中 / 停电" /></label>
            <label>开始时间<input name="startedAt" type="datetime-local" /></label>
            <label>预计恢复<input name="expectedResumeAt" type="datetime-local" /></label>
            <div className="status-options field-wide">
              <label className="check-row"><input name="affectsSales" type="checkbox" /><span>影响销售统计/营业状态</span></label>
              <label className="check-row"><input name="affectsInventory" type="checkbox" /><span>影响库存预警</span></label>
              <label className="check-row"><input name="suppressAlerts" type="checkbox" /><span>暂停普通预警</span></label>
            </div>
            <label className="field-wide">备注<textarea name="note" rows="3" placeholder="填写停电、装修、修路、已恢复等说明" /></label>
            <button type="submit">保存站点状态</button>
          </form>
          <p className="form-status muted">{formStatus}</p>
        </section>
        <section className="panel admin-table-panel">
          <div className="panel-head"><h2>当前站点状态</h2><span>后台状态优先</span></div>
          <div className="table-wrap admin-status-table">
            <table>
              <thead><tr><th>站点</th><th>区域</th><th>状态</th><th>开始</th><th>预计恢复</th><th>影响</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>
                {statuses.length ? statuses.map((item, i) => {
                  const impact = [item.affectsSales ? '销售' : '', item.affectsInventory ? '库存' : '', item.suppressAlerts ? '暂停预警' : ''].filter(Boolean).join(' / ') || '无';
                  return (
                    <tr key={i}><td>{item.name}<br /><small>{item.short}</small></td><td>{item.region}</td><td><span className={`status-pill ${item.statusType === 'normal' ? 'ok' : 'warn'}`}>{item.statusLabel}</span></td><td>{fmtDate(item.startedAt)}</td><td>{fmtDate(item.expectedResumeAt)}</td><td>{impact}</td><td>{item.note || '--'}</td><td>{item.isActive && !item.endedAt ? <button type="button" onClick={() => handleClose(item.id)}>结束</button> : <span className="muted">已结束</span>}</td></tr>
                  );
                }) : <tr><td colSpan="8">暂无状态记录</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
