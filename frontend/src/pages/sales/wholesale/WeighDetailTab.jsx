// src/pages/sales/wholesale/WeighDetailTab.jsx — 称重明细
import { useState, useEffect } from 'react';
import { num } from '../../../utils/format';
import { fetchWeighDetails, fetchWeighFilterOptions, exportWeighDetails } from '../../../api/wholesale';
import ColumnFilter from '../../../components/common/ColumnFilter';

const CLASSIFICATION_LABELS = {
  local_wholesale: '本地批发', export_wholesale: '出口批发',
  transfer: '外运', processing: '代加工', procurement: '采购', unknown: '待识别',
};
const MATCH_OPTIONS = [
  { value: '', label: '全部' }, { value: 'matched', label: '已匹配' },
  { value: 'unmatched', label: '未匹配' }, { value: 'needs_review', label: '待审核' },
];
const AUDIT_OPTIONS = [
  { value: '', label: '全部' }, { value: 'approved', label: '已通过' },
  { value: 'pending', label: '待审核' }, { value: 'rejected', label: '已拒绝' },
];
const MATCH_LABELS = { matched: '已匹配', unmatched: '未匹配', needs_review: '待审核' };
const AUDIT_LABELS = { approved: '已通过', pending: '待审核', rejected: '已拒绝' };

export default function WeighDetailTab({ year, month }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    vehicle: '', matchStatus: '', auditStatus: '',
  });
  const [colFilters, setColFilters] = useState({
    product: [], sender: [], receiver: [], classification: [],
  });
  const [filterOptions, setFilterOptions] = useState({
    product_name: [], sender_name: [], standard_entity_name: [], classification: [],
  });

  const loadData = (f, cf) => {
    if (!year) return;
    setLoading(true);
    fetchWeighDetails({
      year, month,
      vehicle: f.vehicle, matchStatus: f.matchStatus, auditStatus: f.auditStatus,
      colProduct: cf.product, colSender: cf.sender,
      colReceiver: cf.receiver, colClassification: cf.classification,
    })
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData(filter, colFilters);
    fetchWeighFilterOptions({ year, month })
      .then(d => { if (d) setFilterOptions(d); })
      .catch(() => {});
  }, [year, month]);

  const handleFilter = () => loadData(filter, colFilters);
  const handleReset = () => {
    const f = { vehicle: '', matchStatus: '', auditStatus: '' };
    const cf = { product: [], sender: [], receiver: [], classification: [] };
    setFilter(f);
    setColFilters(cf);
    loadData(f, cf);
  };

  const handleColFilter = (col, vals) => {
    const next = { ...colFilters, [col]: vals };
    setColFilters(next);
    loadData(filter, next);
  };

  const totalTons = items.reduce((s, i) => s + (i.weightTons || 0), 0);
  const clsLabel = v => CLASSIFICATION_LABELS[v] || v || '--';
  const matchLabel = v => MATCH_LABELS[v] || v || '--';
  const auditLabel = v => AUDIT_LABELS[v] || v || '--';
  const withStandard = (raw, standard) => {
    if (!raw && !standard) return '--';
    if (!standard || standard === raw) return raw || standard;
    return <>{raw || standard}<br /><small className="muted">标准：{standard}</small></>;
  };

  return (
    <div className="overview-tab">
      <section className="cards-row">
        <div className="card"><span>称重明细</span><strong>{num.format(items.length)} 条</strong></div>
        <div className="card"><span>总吨数</span><strong>{num.format(totalTons)}</strong></div>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => exportWeighDetails(year, month)}>
          <span>生成报表</span><strong style={{ color: '#1a3a5c' }}>点击下载</strong>
        </div>
      </section>

      <div className="inline-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
        <input placeholder="车号" value={filter.vehicle} onChange={e => setFilter(f => ({ ...f, vehicle: e.target.value }))} style={{ width: 90, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }} />
        <select value={filter.matchStatus} onChange={e => setFilter(f => ({ ...f, matchStatus: e.target.value }))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
          {MATCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filter.auditStatus} onChange={e => setFilter(f => ({ ...f, auditStatus: e.target.value }))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
          {AUDIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" onClick={handleFilter} style={{ padding: '4px 12px' }}>筛选</button>
        <button type="button" onClick={handleReset} style={{ padding: '4px 12px' }}>重置</button>
      </div>

      {loading ? <p className="muted">加载中...</p> : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>序号</th>
                <th>入厂日期</th>
                <th>
                  <ColumnFilter label="货名" column="product" options={filterOptions.product_name || []}
                    selected={colFilters.product} onChange={handleColFilter} />
                </th>
                <th>磅单号</th>
                <th>车号</th>
                <th>
                  <ColumnFilter label="发货单位" column="sender" options={filterOptions.sender_name || []}
                    selected={colFilters.sender} onChange={handleColFilter} />
                </th>
                <th>
                  <ColumnFilter label="收货单位" column="receiver" options={filterOptions.standard_entity_name || []}
                    selected={colFilters.receiver} onChange={handleColFilter} />
                </th>
                <th>过磅重量</th>
                <th>
                  <ColumnFilter label="分类" column="classification" options={filterOptions.classification || []}
                    selected={colFilters.classification} onChange={handleColFilter} formatOption={clsLabel} />
                </th>
                <th>来源</th>
                <th>匹配</th>
                <th>审核</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item, idx) => (
                <tr key={item.id}>
                  <td>{idx + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.businessDate}</td>
                  <td>{withStandard(item.rawProductName, item.productName)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.weighSerialNo || '--'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.vehicleNo || '--'}</td>
                  <td>{item.senderName || '--'}</td>
                  <td>{withStandard(item.rawEntityName, item.standardEntityName)}</td>
                  <td style={{ textAlign: 'right' }}>{num.format(item.weightKg)}</td>
                  <td>{clsLabel(item.classification)}</td>
                  <td>{item.weighSource || '--'}</td>
                  <td>{matchLabel(item.matchStatus)}</td>
                  <td>{auditLabel(item.auditStatus)}</td>
                  <td>{item.remark || '--'}</td>
                </tr>
              )) : <tr><td colSpan="13">暂无称重数据生成的批发明细</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
