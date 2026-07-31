// src/pages/sales/wholesale/WeighDetailTab.jsx — 统一明细查询
import { useState, useEffect } from 'react';
import { num } from '../../../utils/format';
import { splitBilingual } from '../../../utils/bilingual';
import { exportWholesaleDetails, fetchWholesaleDetailFilterOptions, fetchWholesaleDetails } from '../../../api/wholesale';

const PAGE_SIZE = 100;

const CLASSIFICATION_OPTIONS = [
  { value: '', label: '全部分类' },
  { value: 'local_wholesale', label: '本地批发' },
  { value: 'export_wholesale', label: '出口批发' },
  { value: 'transfer', label: '外运' },
  { value: 'processing', label: '代加工' },
  { value: 'procurement', label: '采购' },
  { value: 'unknown', label: '待识别批发' },
  { value: 'other', label: '其他' },
];

const DATA_SOURCE_OPTIONS = [
  { value: 'business', label: '业务口径' },
  { value: 'weighing', label: '仅称重数据' },
  { value: 'uploaded', label: '仅上传/录入' },
];

const TRANSPORT_OPTIONS = [
  { value: '', label: '全部运输' },
  { value: 'truck', label: '汽车' },
  { value: 'train', label: '火车' },
];

const CLASSIFICATION_LABELS = Object.fromEntries(
  CLASSIFICATION_OPTIONS.filter(item => item.value).map(item => [item.value, item.label]),
);

const DATA_SOURCE_LABELS = Object.fromEntries(DATA_SOURCE_OPTIONS.map(item => [item.value, item.label]));
const TRANSPORT_LABELS = { truck: '汽车', train: '火车' };
const SOURCE_LABELS = {
  business: '业务口径',
  weighing: '称重生成',
  uploaded: '上传/录入',
  manual: '手工录入',
  manual_entry: '手工录入',
  contract_excel: '明细表上传',
  wholesale_detail_single: '明细表上传',
  train_entry: '火车录入',
  lpg: '液化气罐区',
  lpg_storage: '液化气罐区',
  lpg_weighing: '液化气罐区',
  液化气罐区: '液化气罐区',
  储运区: '储运区',
};

function periodRange(year, month) {
  const y = Number(year);
  if (month) {
    const m = Number(month);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      dateFrom: `${y}-${String(m).padStart(2, '0')}-01`,
      dateTo: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` };
}

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

function classificationLabel(value) {
  return CLASSIFICATION_LABELS[value] || value || '--';
}

function sourceLabel(item) {
  const key = item?.sourceType || item?.weighSource || item?.dataSource;
  return SOURCE_LABELS[key] || key || '--';
}

function initialFilter() {
  return {
    vehicle: '',
    entity: '',
    product: '',
    classification: '',
    dataSource: 'business',
    transportMode: '',
  };
}

export default function WeighDetailTab({ year, month }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(initialFilter);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [totalWeight, setTotalWeight] = useState(0);
  const [sourcePolicy, setSourcePolicy] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ companies: [], products: [] });
  const [exporting, setExporting] = useState(false);

  const detailParams = (nextFilter = filter, nextPage = null) => {
    const { dateFrom, dateTo } = periodRange(year, month);
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      vehicle_no: nextFilter.vehicle,
      entity_name: nextFilter.entity,
      product_name: nextFilter.product,
      classification: nextFilter.classification,
      data_source: nextFilter.dataSource,
      transport_mode: nextFilter.transportMode,
    };
    if (nextPage) {
      params.page = nextPage;
      params.page_size = PAGE_SIZE;
    }
    return params;
  };

  const loadData = (nextFilter = filter, nextPage = 1) => {
    if (!year) return;
    setLoading(true);
    fetchWholesaleDetails(detailParams(nextFilter, nextPage))
      .then((data) => {
        setItems(data?.items || []);
        setTotal(data?.total || 0);
        setTotalWeight(data?.totalWeight || 0);
        setPage(data?.page || nextPage);
        setPageSize(data?.page_size || PAGE_SIZE);
        setSourcePolicy(data?.sourcePolicy || null);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
        setTotalWeight(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData(filter, 1);
  }, [year, month]);

  useEffect(() => {
    fetchWholesaleDetailFilterOptions()
      .then((data) => {
        setFilterOptions({
          companies: Array.isArray(data?.companies) ? data.companies : [],
          products: Array.isArray(data?.products) ? data.products : [],
        });
      })
      .catch(() => setFilterOptions({ companies: [], products: [] }));
  }, []);

  const handleFilter = () => loadData(filter, 1);
  const handleReset = () => {
    const next = initialFilter();
    setFilter(next);
    loadData(next, 1);
  };
  const goPage = (nextPage) => loadData(filter, nextPage);
  const handleExport = () => {
    if (!year || exporting) return;
    setExporting(true);
    exportWholesaleDetails(detailParams(filter))
      .catch(() => window.alert('导出失败，请稍后重试'))
      .finally(() => setExporting(false));
  };

  const totalTons = totalWeight / 1000;
  const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || PAGE_SIZE)));
  const dataSourceLabel = DATA_SOURCE_LABELS[filter.dataSource] || filter.dataSource;
  const policyText = filter.dataSource === 'business' && sourcePolicy
    ? `业务口径：${sourcePolicy.cutoffDate} 前取称重数据，之后取上传/录入明细表`
    : `${dataSourceLabel}：按当前数据来源筛选显示`;

  return (
    <div className="overview-tab">
      <section className="cards-row detail-metric-cards">
        <div className="card"><span>明细表</span><strong>{num.format(total)} 条</strong></div>
        <div className="card"><span>总吨数</span><strong>{num.format(totalTons)} 吨</strong></div>
        <div className="card"><span>数据口径</span><strong>{dataSourceLabel}</strong></div>
      </section>

      <div className="inline-filter wholesale-detail-filter">
        <input
          placeholder="车号"
          value={filter.vehicle}
          onChange={e => setFilter(f => ({ ...f, vehicle: e.target.value }))}
        />
        <select
          value={filter.entity}
          onChange={e => setFilter(f => ({ ...f, entity: e.target.value }))}
        >
          <option value="">全部公司</option>
          {filterOptions.companies.map(option => (
            <option key={option.value || option.label} value={option.value || option.label}>{option.label || option.value}</option>
          ))}
        </select>
        <select
          value={filter.product}
          onChange={e => setFilter(f => ({ ...f, product: e.target.value }))}
        >
          <option value="">全部油品</option>
          {filterOptions.products.map(option => (
            <option key={option.value || option.label} value={option.value || option.label}>{option.label || option.value}</option>
          ))}
        </select>
        <select
          value={filter.classification}
          onChange={e => setFilter(f => ({ ...f, classification: e.target.value }))}
        >
          {CLASSIFICATION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={filter.transportMode}
          onChange={e => setFilter(f => ({ ...f, transportMode: e.target.value }))}
        >
          {TRANSPORT_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={filter.dataSource}
          onChange={e => setFilter(f => ({ ...f, dataSource: e.target.value }))}
        >
          {DATA_SOURCE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button type="button" onClick={handleFilter} disabled={loading}>筛选</button>
        <button type="button" onClick={handleReset} disabled={loading}>重置</button>
        <button type="button" onClick={handleExport} disabled={!year || exporting}>下载 Excel</button>
      </div>
      <p className="muted wholesale-detail-policy">{policyText}</p>

      {loading ? <p className="muted">加载中...</p> : (
        <>
          <div className="table-wrap wholesale-detail-table" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>序号</th>
                  <th>日期</th>
                  <th>油品</th>
                  <th>磅单号</th>
                  <th>车号</th>
                  <th>发货单位</th>
                  <th>收货单位</th>
                  <th>重量(吨)</th>
                  <th>分类</th>
                  <th>运输</th>
                  <th>来源</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((item, idx) => (
                  <tr key={`${item.dataSource || 'detail'}-${item.id}`}>
                    <td>{(page - 1) * pageSize + idx + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.businessDate || '--'}</td>
                    <td>{withStandard(item.rawProductName, item.standardProductName || item.productName)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.weighSerialNo || '--'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{item.vehicleNo || '--'}</td>
                    <td>{withStandard(item.senderName, item.standardSenderName)}</td>
                    <td>{withStandard(item.rawEntityName, item.standardEntityName || item.entityName)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{num.format(item.weightTons || 0)}</td>
                    <td>{classificationLabel(item.classification)}</td>
                    <td>{TRANSPORT_LABELS[item.transportMode] || item.transportMode || '--'}</td>
                    <td>{sourceLabel(item)}</td>
                    <td>{item.remark || '--'}</td>
                  </tr>
                )) : <tr><td colSpan="12">暂无明细表</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="wholesale-detail-pagination">
            <span>第 {num.format(page)} / {num.format(totalPages)} 页</span>
            <button type="button" onClick={() => goPage(page - 1)} disabled={loading || page <= 1}>上一页</button>
            <button type="button" onClick={() => goPage(page + 1)} disabled={loading || page >= totalPages}>下一页</button>
          </div>
        </>
      )}
    </div>
  );
}
