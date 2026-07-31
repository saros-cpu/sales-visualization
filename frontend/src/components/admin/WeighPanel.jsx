// src/components/admin/WeighPanel.jsx — 称重管理
import { useState, useEffect, useCallback } from 'react';
import { fmtDate } from '../../utils/admin-helpers';
import { num } from '../../utils/format';
import { splitBilingual } from '../../utils/bilingual';
import { getWeighRecords, generateWeighDetails, getWeighRecordFilterOptions } from '../../api/admin';
import ColumnFilter from '../common/ColumnFilter';

// 中俄双语名称统一渲染：中文在上、俄文在下两行，与桌面端显示风格一致。
function withStandard(raw, standard) {
  const name = (standard || raw || '').trim();
  if (!name) return '--';
  const { top, bottom } = splitBilingual(name);
  if (!bottom) return name;
  return (
    <span style={{ display: 'inline-block', textAlign: 'center', lineHeight: 1.25 }}>
      <div style={{ fontWeight: 600 }}>{top}</div>
      <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.3 }}>{bottom}</div>
    </span>
  );
}


export default function WeighPanel() {
  const [tab, setTab] = useState('records');
  const [records, setRecords] = useState([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const [recordPage, setRecordPage] = useState(1);
  const [recordFilter, setRecordFilter] = useState({ vehicle: '', dateFrom: '', dateTo: '' });
  const [colFilters, setColFilters] = useState({ sender: [], receiver: [], product: [], source: [] });
  const [filterOptions, setFilterOptions] = useState({ sender: [], receiver: [], product: [], source: [] });

  const [genStatus, setGenStatus] = useState('');
  const [genResult, setGenResult] = useState(null);

  const loadRecords = useCallback(async (page, cf) => {
    try {
      const f = cf || colFilters;
      const d = await getWeighRecords({
        ...recordFilter, page: page || recordPage, size: 50,
        colSender: f.sender, colReceiver: f.receiver,
        colProduct: f.product, colSource: f.source,
      });
      setRecords(d.items || []);
      setRecordTotal(d.total || 0);
      setRecordPage(d.page || 1);
    } catch {}
  }, [recordFilter, recordPage, colFilters]);

  useEffect(() => {
    if (tab === 'records') {
      loadRecords();
      getWeighRecordFilterOptions()
        .then(d => { if (d) setFilterOptions(d); })
        .catch(() => {});
    }
  }, [tab, loadRecords]);

  const handleFilter = () => { setRecordPage(1); loadRecords(1); };
  const handleColFilter = (col, vals) => {
    const next = { ...colFilters, [col]: vals };
    setColFilters(next);
    loadRecords(1, next);
  };

  const handleGenerate = async () => {
    setGenStatus('正在生成明细表...');
    setGenResult(null);
    try {
      const d = await generateWeighDetails({ dateFrom: '' });
      setGenStatus(`生成完成：新增 ${d.generated} 条，跳过 ${d.skipped} 条，自动创建实体映射 ${d.autoEntityMappings} 条、油品映射 ${d.autoProductMappings} 条`);
      setGenResult(d);
      await loadRecords();
    } catch (err) { setGenStatus(err.message); }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>称重管理</h2><span>称重原始数据查看、生成明细表</span></div>
      <div className="admin-sub-tabs" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[
          { key: 'records', label: '称重原始数据' },
          { key: 'generate', label: '生成明细表' },
        ].map(t => (
          <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)} style={{ padding: '6px 14px', cursor: 'pointer', background: tab === t.key ? '#1a3a5c' : '#eee', color: tab === t.key ? '#fff' : '#333', border: 'none', borderRadius: 4 }}>{t.label}</button>
        ))}
      </div>

      {tab === 'records' && (
        <section className="panel panel-wide">
          <div className="panel-head">
            <h2>称重原始数据</h2>
            <div className="inline-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="车号" value={recordFilter.vehicle} onChange={e => setRecordFilter(f => ({...f, vehicle: e.target.value}))} style={{ width: 90 }} />
              <input type="date" value={recordFilter.dateFrom} onChange={e => setRecordFilter(f => ({...f, dateFrom: e.target.value}))} style={{ width: 130, padding: '3px 6px', borderRadius: 4, border: '1px solid #ccc' }} />
              <input type="date" value={recordFilter.dateTo} onChange={e => setRecordFilter(f => ({...f, dateTo: e.target.value}))} style={{ width: 130, padding: '3px 6px', borderRadius: 4, border: '1px solid #ccc' }} />
              <button type="button" onClick={handleFilter}>筛选</button>
            </div>
          </div>
          <p className="muted">共 {num.format(recordTotal)} 条，当前第 {recordPage} 页</p>
          <div className="table-wrap review-scroll">
            <table>
              <thead>
                <tr>
                  <th>磅单编号</th>
                  <th>日期</th>
                  <th>车号</th>
                  <th>
                    <ColumnFilter label="发货单位" column="sender" options={filterOptions.sender || []}
                      selected={colFilters.sender} onChange={handleColFilter} />
                  </th>
                  <th>
                    <ColumnFilter label="收货单位" column="receiver" options={filterOptions.receiver || []}
                      selected={colFilters.receiver} onChange={handleColFilter} />
                  </th>
                  <th>
                    <ColumnFilter label="货名" column="product" options={filterOptions.product || []}
                      selected={colFilters.product} onChange={handleColFilter} />
                  </th>
                  <th>净重</th>
                  <th>
                    <ColumnFilter label="来源" column="source" options={filterOptions.source || []}
                      selected={colFilters.source} onChange={handleColFilter} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.length ? records.map((r, i) => (
                  <tr key={i}>
                    <td>{r['编号'] || '--'}</td>
                    <td>{(r['毛重日期'] || r['皮重日期'] || '--').slice(0, 10)}</td>
                    <td>{r['车号'] || '--'}</td>
                    <td>{withStandard(r['发货单位'], r['标准发货单位'])}</td>
                    <td>{withStandard(r['收货单位'], r['标准收货单位'])}</td>
                    <td>{r['货名'] || '--'}</td>
                    <td>{r['净重'] != null ? num.format(r['净重']) : '--'}</td>
                    <td>{r.weigh_source || '储运区'}</td>
                  </tr>
                )) : <tr><td colSpan="8">暂无称重数据</td></tr>}
              </tbody>
            </table>
          </div>
          {recordTotal > 50 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
              <button type="button" disabled={recordPage <= 1} onClick={() => loadRecords(recordPage - 1)}>上一页</button>
              <span>{recordPage} / {Math.ceil(recordTotal / 50)}</span>
              <button type="button" disabled={recordPage >= Math.ceil(recordTotal / 50)} onClick={() => loadRecords(recordPage + 1)}>下一页</button>
            </div>
          )}
        </section>
      )}

      {tab === 'generate' && (
        <section className="panel panel-wide">
          <div className="panel-head"><h2>生成明细表</h2><span>将称重原始数据（kj_weighing）按映射关系转换为明细表（wholesale_detail_records）</span></div>
          <p className="muted">生成逻辑：读取最近 7 天的称重数据 → 按映射表匹配实体和油品 → 自动识别去向类型 → 插入明细表。未映射的名称会尝试自动建议并创建低可信度映射。</p>
          <button type="button" onClick={handleGenerate} style={{ marginTop: 8 }}>执行生成</button>
          {genStatus && <p className="form-status muted">{genStatus}</p>}
          {genResult && (
            <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
              <span>新增：<strong>{genResult.generated}</strong> 条</span>
              <span>跳过：<strong>{genResult.skipped}</strong> 条</span>
              <span>自动创建实体映射：<strong>{genResult.autoEntityMappings}</strong> 条</span>
              <span>自动创建油品映射：<strong>{genResult.autoProductMappings}</strong> 条</span>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
