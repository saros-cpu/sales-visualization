// src/components/admin/ExecutionPanel.jsx — 合同执行看板
import { useState, useEffect, useCallback } from 'react';
import { getContractExecution } from '../../api/admin';
import { num } from '../../utils/format';

const STATUS_LABELS = {
  all: '全部', in_progress: '执行中', completed: '执行完毕',
  over_executed: '超量执行', expired_incomplete: '到期未完成',
};
const STATUS_COLORS = {
  in_progress: '#2196F3', completed: '#4CAF50',
  over_executed: '#F44336', expired_incomplete: '#FF9800',
};
const LIFECYCLE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'active', label: '生效中' },
  { value: 'expired', label: '已过期' },
  { value: 'future', label: '未来合同' },
];

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#999';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 12,
      color: '#fff', background: color, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function ProgressBar({ pct, executed, quantity }) {
  const isOver = pct > 100;
  const displayPct = Math.min(pct, 100);
  const color = isOver ? '#F44336' : (pct >= 100 ? '#4CAF50' : '#2196F3');
  const label = isOver ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 140 }}>
      <div style={{ flex: 1, height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${displayPct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: isOver ? '#F44336' : '#333', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: '', label: '默认排序' },
  { value: 'remainingTons', label: '余量 ↑' },
  { value: '-remainingTons', label: '余量 ↓' },
  { value: 'fulfillmentPct', label: '完成率 ↑' },
  { value: '-fulfillmentPct', label: '完成率 ↓' },
  { value: 'daysRemaining', label: '到期时间 ↑' },
  { value: '-daysRemaining', label: '到期时间 ↓' },
  { value: 'contractNo', label: '合同号 ↑' },
  { value: '-contractNo', label: '合同号 ↓' },
];

export default function ExecutionPanel({ customerOptions, onSelectContract }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ all: 0, in_progress: 0, completed: 0, over_executed: 0, expired_incomplete: 0 });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeStatus, setActiveStatus] = useState('');
  const [filters, setFilters] = useState({ lifecycle: '', customerId: '', year: '', sortBy: '' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sortParts = (filters.sortBy || '').startsWith('-')
        ? { sortBy: filters.sortBy.slice(1), sortOrder: 'desc' }
        : { sortBy: filters.sortBy || undefined, sortOrder: undefined };
      const data = await getContractExecution({
        ...filters, ...sortParts,
        status: activeStatus || undefined,
        page, perPage: 50,
      });
      setItems(data.items || []);
      setStats(data.stats || { all: 0, in_progress: 0, completed: 0, over_executed: 0, expired_incomplete: 0 });
      setTotal(data.total || 0);
    } catch { setItems([]); }
    setLoading(false);
  }, [filters, activeStatus, page]);

  useEffect(() => { load(); }, [load]);

  const handleStatusClick = (status) => {
    setActiveStatus(prev => prev === status ? '' : status);
    setPage(1);
  };

  const countdownText = (days) => {
    if (days === null || days === undefined) return '--';
    if (days > 7) return `剩余 ${days} 天`;
    if (days > 0) return <span style={{ color: '#FF9800', fontWeight: 600 }}>即将到期 ({days}天)</span>;
    return <span style={{ color: '#F44336', fontWeight: 600 }}>已过期 {Math.abs(days)} 天</span>;
  };

  const statKeys = ['all', 'in_progress', 'completed', 'over_executed', 'expired_incomplete'];

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <section className="panel panel-wide">
      {/* 统计卡片 */}
      <div className="admin-summary" style={{ marginBottom: 16, cursor: 'pointer' }}>
        {statKeys.map(key => {
          const isActive = activeStatus === key || (key === 'all' && !activeStatus);
          const color = key === 'all' ? '#1a3a5c' : (STATUS_COLORS[key] || '#999');
          return (
            <div key={key} onClick={() => handleStatusClick(key)}
              style={{ borderColor: isActive ? color : undefined, background: isActive ? `${color}10` : undefined, position: 'relative' }}>
              <span>{STATUS_LABELS[key]}</span>
              <strong>{stats[key] || 0}</strong>
              <small style={{ fontSize: 11, color: '#999', display: 'block', marginTop: 2 }}>{key === 'all' ? '总合同数' : ''}</small>
            </div>
          );
        })}
      </div>

      {/* 筛选栏 */}
      <div className="panel-head">
        <h2>执行看板</h2>
        <div className="inline-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filters.lifecycle} onChange={e => { setFilters(f => ({ ...f, lifecycle: e.target.value })); setPage(1); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
            {LIFECYCLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.customerId} onChange={e => { setFilters(f => ({ ...f, customerId: e.target.value })); setPage(1); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', maxWidth: 200 }}>
            <option value="">全部客户</option>
            {(customerOptions || []).map(c => <option key={c.id || c.value} value={c.id || c.value}>{c.label || c.standard_name || c.name}</option>)}
          </select>
          <select value={filters.year} onChange={e => { setFilters(f => ({ ...f, year: e.target.value })); setPage(1); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
            <option value="">全部年份</option>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filters.sortBy} onChange={e => { setFilters(f => ({ ...f, sortBy: e.target.value })); setPage(1); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' }}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => { setFilters({ lifecycle: '', customerId: '', year: '', sortBy: '' }); setActiveStatus(''); setPage(1); }}
            style={{ padding: '4px 12px' }}>重置</button>
        </div>
      </div>

      {/* 表格 */}
      <div className="table-wrap review-scroll" style={{ maxHeight: 'calc(100vh - 400px)' }}>
        <table>
          <thead>
            <tr>
              <th>合同号</th>
              <th>客户</th>
              <th>产品</th>
              <th>有效期</th>
              <th>倒计时</th>
              <th>合同量</th>
              <th>已拉运</th>
              <th>余量</th>
              <th>完成率</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="10" style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan="10" style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无数据</td></tr>
            ) : items.map(item => {
              const rowBg = item.executionStatus === 'over_executed' ? '#FFF5F5'
                : item.executionStatus === 'expired_incomplete' ? '#FFF8E1'
                : undefined;
              return (
              <tr key={item.id} style={{ background: rowBg }}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {onSelectContract ? (
                    <a href="#" onClick={e => { e.preventDefault(); onSelectContract(item.id); }} style={{ color: '#1a3a5c', textDecoration: 'underline', cursor: 'pointer' }}>{item.contractNo}</a>
                  ) : item.contractNo}
                </td>
                <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.customerName}>{item.customerName}</td>
                <td>{item.productName}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {item.effectiveStart || '--'} ~ {item.effectiveEnd || '--'}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{countdownText(item.daysRemaining)}</td>
                <td style={{ textAlign: 'right' }}>{item.quantityTons != null ? num.format(item.quantityTons) : '--'}</td>
                <td style={{ textAlign: 'right' }}>{item.executedTons > 0 ? num.format(item.executedTons) : '--'}</td>
                <td style={{
                  textAlign: 'right',
                  color: item.remainingTons != null && item.remainingTons < 0 ? '#F44336' : undefined,
                  fontWeight: item.remainingTons != null && item.remainingTons <= 0 ? 600 : undefined,
                }}>
                  {item.remainingTons != null ? num.format(item.remainingTons) : '--'}
                </td>
                <td style={{ minWidth: 160 }}>
                  {item.quantityTons != null && item.quantityTons > 0 ? (
                    <ProgressBar pct={item.fulfillmentPct} executed={item.executedTons} quantity={item.quantityTons} />
                  ) : <span style={{ color: '#999', fontSize: 12 }}>--</span>}
                </td>
                <td><StatusBadge status={item.executionStatus} /></td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {total > 50 && (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>上一页</button>
          <span style={{ margin: '0 8px', fontSize: 13, color: '#666' }}>
            第 {page} / {Math.ceil(total / 50)} 页（共 {total} 条）
          </span>
          <button type="button" disabled={page >= Math.ceil(total / 50)} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}
    </section>
  );
}
