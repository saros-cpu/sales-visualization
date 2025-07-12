# 称重页面列筛选与UI整改 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Column-level dropdown filtering + UI fixes for weigh detail and weigh management pages

**Architecture:** Backend adds `filter-options` endpoints returning distinct column values; frontend gets a reusable `ColumnFilter` component with checkbox dropdown, used in both WeighDetailTab and WeighPanel. Column filter sends comma-separated exact-match params (`col_*`) that use SQL `IN()` clauses.

**Tech Stack:** Python/Flask (backend), React (frontend)

## Global Constraints

- Follow existing code style in each file
- No new npm dependencies
- Column filter only appears on columns listed in the requirements
- Backend filter-options endpoints use the same date range as the main query
- Column filter selections trigger a new API request (server-side filtering), coexist with existing text-search filters
- Column names match the `kj_weighing` table column names exactly

---

### Task 1: Backend — weigh-details filter-options API

**Files:**
- Modify: `D:\SalesVisualization\Sales\routes_data.py` (after existing weigh-details endpoint)

**Interfaces:**
- Consumes: GET params `year`, `month`
- Produces: JSON `{ "product_name": [...], "sender_name": [...], "standard_entity_name": [...], "classification": [...] }`

- [ ] **Step 1: Add endpoint after weigh-details handler**

```python
@app.route("/api/wholesale/weigh-details/filter-options")
def api_wholesale_weigh_details_filter_options():
    year = int(request.args.get("year", "2026"))
    month_raw = request.args.get("month")
    month = int(month_raw) if month_raw else None
    start, end = period_bounds(year, month)
    conn = get_connection()
    try:
        cur = conn.cursor()
        sql = """
            SELECT
                COALESCE(GROUP_CONCAT(DISTINCT p.display_name ORDER BY p.display_name SEPARATOR '||'), ''),
                COALESCE(GROUP_CONCAT(DISTINCT d.sender_name ORDER BY d.sender_name SEPARATOR '||'), ''),
                COALESCE(GROUP_CONCAT(DISTINCT d.standard_entity_name ORDER BY d.standard_entity_name SEPARATOR '||'), ''),
                COALESCE(GROUP_CONCAT(DISTINCT d.classification ORDER BY d.classification SEPARATOR '||'), '')
            FROM wholesale_detail_records d
            LEFT JOIN products p ON p.id = d.product_id
            WHERE d.batch_id IS NULL AND d.business_date >= %s AND d.business_date < %s
        """
        cur.execute(sql, [start, end])
        row = cur.fetchone()
        return jsonify({
            "product_name": [x for x in (row[0] or "").split("||") if x],
            "sender_name": [x for x in (row[1] or "").split("||") if x],
            "standard_entity_name": [x for x in (row[2] or "").split("||") if x],
            "classification": [x for x in (row[3] or "").split("||") if x],
        })
    finally:
        conn.close()
```

- [ ] **Step 2: Update the main weigh-details API to accept `col_*` params**

Change the WHERE clause building in `api_wholesale_weigh_details` (around line 1657-1676):

```python
# After existing single-value classification handling, add column filter params:
col_product = request.args.get("col_product", "").strip()
col_sender = request.args.get("col_sender", "").strip()
col_receiver = request.args.get("col_receiver", "").strip()
col_classification = request.args.get("col_classification", "").strip()

if col_product:
    vals = [v.strip() for v in col_product.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"p.display_name IN ({placeholders})")
        params.extend(vals)
if col_sender:
    vals = [v.strip() for v in col_sender.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"d.sender_name IN ({placeholders})")
        params.extend(vals)
if col_receiver:
    vals = [v.strip() for v in col_receiver.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"d.standard_entity_name IN ({placeholders})")
        params.extend(vals)
if col_classification:
    vals = [v.strip() for v in col_classification.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"d.classification IN ({placeholders})")
        params.extend(vals)
```

- [ ] **Step 3: Verify with curl / browser**

---

### Task 2: Backend — admin weigh-records filter-options API

**Files:**
- Modify: `D:\SalesVisualization\Sales\routes_admin.py` (after the weigh/records endpoint)

**Interfaces:**
- Consumes: same date/vehicle/entity/product filters as the main endpoint
- Produces: JSON `{ "sender": [...], "receiver": [...], "product": [...], "source": [...] }`

- [ ] **Step 1: Add endpoint after weigh/records handler**

```python
@app.route("/api/admin/weigh/records/filter-options")
@admin_required
def api_admin_weigh_records_filter_options():
    conn = get_connection()
    try:
        cur = conn.cursor()
        weigh_table = "kj_weighing"
        cur.execute(f"""
            SELECT
                COALESCE(GROUP_CONCAT(DISTINCT 发货单位 ORDER BY 发货单位 SEPARATOR '||'), ''),
                COALESCE(GROUP_CONCAT(DISTINCT 收货单位 ORDER BY 收货单位 SEPARATOR '||'), ''),
                COALESCE(GROUP_CONCAT(DISTINCT 货名 ORDER BY 货名 SEPARATOR '||'), '')
            FROM {weigh_table}
            WHERE (作废 IS NULL OR 作废 = 0)
        """)
        row = cur.fetchone()
        return jsonify({
            "sender": [x for x in (row[0] or "").split("||") if x],
            "receiver": [x for x in (row[1] or "").split("||") if x],
            "product": [x for x in (row[2] or "").split("||") if x],
            "source": ["储运区"],
        })
    finally:
        conn.close()
```

- [ ] **Step 2: Update the main weigh/records API to accept `col_*` params**

In `api_admin_weigh_records`, add after existing parameter parsing:

```python
col_sender = request.args.get("col_sender", "").strip()
col_receiver = request.args.get("col_receiver", "").strip()
col_product = request.args.get("col_product", "").strip()
col_source = request.args.get("col_source", "").strip()

if col_sender:
    vals = [v.strip() for v in col_sender.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"发货单位 IN ({placeholders})")
        params.extend(vals)
if col_receiver:
    vals = [v.strip() for v in col_receiver.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"收货单位 IN ({placeholders})")
        params.extend(vals)
if col_product:
    vals = [v.strip() for v in col_product.split(",") if v.strip()]
    if vals:
        placeholders = ",".join(["%s"] * len(vals))
        where.append(f"货名 IN ({placeholders})")
        params.extend(vals)
if col_source:
    # Source is not a DB column for weigh records (it's hardcoded)
    # For now, col_source filtering is handled client-side if needed
    pass
```

- [ ] **Step 3: Verify with curl / browser**

---

### Task 3: Frontend — ColumnFilter reusable component

**Files:**
- Create: `D:\SalesVisualization\frontend\src\components\common\ColumnFilter.jsx`

**Interfaces:**
- Props: `{ label, column, options, selected, onChange, onClose }`
- Emits: `onChange(column, values[])` — called when dropdown closes

- [ ] **Step 1: Create ColumnFilter.jsx**

```jsx
import { useState, useRef, useEffect } from 'react';

export default function ColumnFilter({ label, column, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        if (open) {
          onChange(column, selected);
          setOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, column, selected, onChange]);

  const filtered = options.filter(v =>
    !search || v.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (val) => {
    const next = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val];
    onChange(column, next);
  };

  const selectAll = () => onChange(column, [...options]);
  const clearAll = () => onChange(column, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {label} <span style={{ fontSize: 10, marginLeft: 2 }}>{open ? '▲' : '▼'}</span>
        {selected.length > 0 && selected.length < options.length && (
          <span style={{ color: '#1a3a5c', fontWeight: 'bold', marginLeft: 4 }}>({selected.length})</span>
        )}
      </span>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #ccc', borderRadius: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)', minWidth: 200,
          maxHeight: 300, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <input
            type="text" placeholder="搜索..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ margin: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 3 }}
          />
          <div style={{ padding: '2px 4px', borderBottom: '1px solid #eee', display: 'flex', gap: 8, fontSize: 12 }}>
            <span onClick={selectAll} style={{ cursor: 'pointer', color: '#1a3a5c' }}>全选</span>
            <span onClick={clearAll} style={{ cursor: 'pointer', color: '#999' }}>取消</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.map(v => (
              <label key={v} style={{ display: 'block', padding: '3px 8px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox" checked={selected.includes(v)}
                  onChange={() => toggle(v)}
                  style={{ marginRight: 6 }}
                />
                {v}
              </label>
            ))}
            {filtered.length === 0 && <div style={{ padding: 8, color: '#999', fontSize: 12 }}>无匹配</div>}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

### Task 4: Frontend — WeighDetailTab updates

**Files:**
- Modify: `D:\SalesVisualization\frontend\src\pages\sales\wholesale\WeighDetailTab.jsx`
- Modify: `D:\SalesVisualization\frontend\src\api\wholesale.js`

- [ ] **Step 1: Add API functions to wholesale.js**

```js
export function fetchWeighFilterOptions({ year, month }) {
  const q = { year };
  if (month) q.month = month;
  return get(`/api/wholesale/weigh-details/filter-options?${buildQuery(q)}`);
}

export function fetchWeighDetails({ year, month, vehicle, entity, product, classification, matchStatus, auditStatus, colProduct, colSender, colReceiver, colClassification }) {
  const q = { year };
  if (month) q.month = month;
  if (vehicle) q.vehicle = vehicle;
  if (entity) q.entity = entity;
  if (product) q.product = product;
  if (classification) q.classification = classification;
  if (matchStatus) q.matchStatus = matchStatus;
  if (auditStatus) q.auditStatus = auditStatus;
  if (colProduct?.length) q.col_product = colProduct.join(',');
  if (colSender?.length) q.col_sender = colSender.join(',');
  if (colReceiver?.length) q.col_receiver = colReceiver.join(',');
  if (colClassification?.length) q.col_classification = colClassification.join(',');
  return get(`/api/wholesale/weigh-details?${buildQuery(q)}`);
}
```

- [ ] **Step 2: Rewrite WeighDetailTab.jsx**

Changes:
- Import ColumnFilter, add new API functions
- Rename column headers: 油品名称→货名, 油品所属公司→发货单位, 供应商/客户→收货单位
- Add "分类" column between 过磅重量 and 备注
- Add colFilters state for column filter selections
- Add filterOptions state (fetched from filter-options API)
- Add ColumnFilter components in the table header row (货名, 发货单位, 收货单位, 分类)
- Pass col_* params to fetchWeighDetails
- Fix the filter button issue by adding `filter` to useEffect dependency and auto-refetching on colFilters change

Full new component:

```jsx
// src/pages/sales/wholesale/WeighDetailTab.jsx — 称重明细
import { useState, useEffect } from 'react';
import { num } from '../../../utils/format';
import { fetchWeighDetails, fetchWeighFilterOptions, exportWeighDetails } from '../../../api/wholesale';
import ColumnFilter from '../../../components/common/ColumnFilter';

const CLASSIFICATION_LABELS = {
  local_wholesale: '本地批发', export_wholesale: '出口批发',
  transfer: '外运', procurement: '采购', processing: '代加工',
};
const CLASSIFICATION_OPTIONS = [
  { value: '', label: '全部分类' },
  ...Object.entries(CLASSIFICATION_LABELS).map(([k, v]) => ({ value: k, label: v })),
];
const MATCH_OPTIONS = [
  { value: '', label: '全部' }, { value: 'matched', label: '已匹配' },
  { value: 'unmatched', label: '未匹配' }, { value: 'needs_review', label: '待审核' },
];
const AUDIT_OPTIONS = [
  { value: '', label: '全部' }, { value: 'approved', label: '已通过' },
  { value: 'pending', label: '待审核' }, { value: 'rejected', label: '已拒绝' },
];

export default function WeighDetailTab({ year, month }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    vehicle: '', entity: '', product: '',
    classification: '', matchStatus: '', auditStatus: '',
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
      vehicle: f.vehicle, entity: f.entity, product: f.product,
      classification: f.classification, matchStatus: f.matchStatus, auditStatus: f.auditStatus,
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
    const f = { vehicle: '', entity: '', product: '', classification: '', matchStatus: '', auditStatus: '' };
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
        <input placeholder="客户" value={filter.entity} onChange={e => setFilter(f => ({ ...f, entity: e.target.value }))} style={{ width: 110, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }} />
        <input placeholder="货名" value={filter.product} onChange={e => setFilter(f => ({ ...f, product: e.target.value }))} style={{ width: 100, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }} />
        <select value={filter.classification} onChange={e => setFilter(f => ({ ...f, classification: e.target.value }))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
          {CLASSIFICATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
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
                    selected={colFilters.classification} onChange={handleColFilter} />
                </th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item, idx) => (
                <tr key={item.id}>
                  <td>{idx + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.businessDate}</td>
                  <td>{item.productName || item.rawProductName || '--'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.weighSerialNo || '--'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.vehicleNo || '--'}</td>
                  <td>{item.senderName || '--'}</td>
                  <td>{item.standardEntityName || item.rawEntityName || '--'}</td>
                  <td style={{ textAlign: 'right' }}>{num.format(item.weightKg)}</td>
                  <td>{clsLabel(item.classification)}</td>
                  <td>{item.remark || '--'}</td>
                </tr>
              )) : <tr><td colSpan="10">暂无称重数据生成的批发明细</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

---

### Task 5: Frontend — WeighPanel updates

**Files:**
- Modify: `D:\SalesVisualization\frontend\src\components\admin\WeighPanel.jsx`
- Modify: `D:\SalesVisualization\frontend\src\api\admin.js`

- [ ] **Step 1: Add API function to admin.js**

```js
export const getWeighRecordFilterOptions = () => get('/api/admin/weigh/records/filter-options');
```

Update `getWeighRecords` to accept `col_*` params:

```js
export const getWeighRecords = (params) => {
  const q = { page: params?.page || 1, size: params?.size || 50 };
  if (params?.vehicle) q.vehicle = params.vehicle;
  if (params?.entity) q.entity = params.entity;
  if (params?.product) q.product = params.product;
  if (params?.dateFrom) q.dateFrom = params.dateFrom;
  if (params?.dateTo) q.dateTo = params.dateTo;
  if (params?.colSender?.length) q.col_sender = params.colSender.join(',');
  if (params?.colReceiver?.length) q.col_receiver = params.colReceiver.join(',');
  if (params?.colProduct?.length) q.col_product = params.colProduct.join(',');
  if (params?.colSource?.length) q.col_source = params.colSource.join(',');
  return get(`/api/admin/weigh/records?${buildQuery(q)}`);
};
```

- [ ] **Step 2: Rewrite WeighPanel.jsx**

Changes:
- Import ColumnFilter, add filter-options API
- Add colFilters state
- Replace 序号 header with 磅单编号 (display r['编号'])
- Shorten date: show only date portion of 毛重日期
- Replace text input filters (车号/客户/货名/日期筛选) with ColumnFilter dropdowns for 发货单位/收货单位/货名
- Keep 日期 range inputs and 车号 text input (they're still useful)
- Keep 筛选/重置 buttons, update to also pass col_* params

Key changes in the records section:

```jsx
// Column header changes:
<th>磅单编号</th>  {/* was 序号, now shows r['编号'] */}
<th>
  <ColumnFilter label="发货单位" column="sender"
    options={filterOptions.sender || []}
    selected={colFilters.sender}
    onChange={handleColFilter} />
</th>
<th>
  <ColumnFilter label="收货单位" column="receiver"
    options={filterOptions.receiver || []}
    selected={colFilters.receiver}
    onChange={handleColFilter} />
</th>
<th>
  <ColumnFilter label="货名" column="product"
    options={filterOptions.product || []}
    selected={colFilters.product}
    onChange={handleColFilter} />
</th>
<th>净重</th>
<th>
  <ColumnFilter label="来源" column="source"
    options={filterOptions.source || []}
    selected={colFilters.source}
    onChange={handleColFilter} />
</th>

// Data cells:
<td>{r['编号'] || '--'}</td>  {/* was r['序号'] */}
<td>{(r['毛重日期'] || r['皮重日期'] || '--').slice(0, 10)}</td>
```

The date shortening: `(r['毛重日期'] || '').slice(0, 10)` — taking first 10 chars of '2026-06-15 14:30:00' → '2026-06-15'

- [ ] **Step 3: Keep existing text-input filters + add ColumnFilter**

The inline filter bar keeps: 车号 text input, 日期范围 date inputs, 筛选/重置 buttons.
The ColumnFilter dropdowns appear in the table header, replacing the 发货单位/收货单位/货名 text inputs (but adding new filtering capability).

Wait, looking at the current WeighPanel, the filter inputs are in a panel heading. The user said "参考excel表格列筛选这种模式" - they want column header dropdowns. So:
- Keep the existing date range and 车号 filter inputs in the heading (they aren't columns)
- Remove the 发货单位/收货单位/货名 text inputs (they're now column filters)
- Add ColumnFilter components in the table header

---

### Task 6: Frontend build verification

- [ ] **Step 1: Run npm build**

```powershell
cd D:\SalesVisualization\frontend
npm run build
```

Expected: Build succeeds (80 modules, ~200ms)

- [ ] **Step 2: Fix any build errors**

If there are import errors or syntax errors, fix them.

---
