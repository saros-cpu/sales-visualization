// src/pages/retail/ReportPage.jsx — 数据报表
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMonths, getStations, exportMonthlyExcel } from '../../api/retail';
import { REGION_COLORS, REGION_ORDER, numberFormat, volumeFormat } from '../../utils/retail-helpers';

function fixed2(n) { return Number(n || 0).toFixed(2); }

export default function ReportPage() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState('');
  const [allStations, setAllStations] = useState([]);
  const [view, setView] = useState('station');
  const [sortKey, setSortKey] = useState('amount');
  const [sortAsc, setSortAsc] = useState(false);
  const [filters, setFilters] = useState({ region: '', station: '', search: '', status: '' });
  const [exporting, setExporting] = useState(false);

  // ── 初始化 ──
  useEffect(() => {
    (async () => {
      try {
        const months = await getMonths();
        const cm = months[0]?.month || '2026-04';
        setCurrentMonth(cm);
        const res = await getStations(cm);
        setAllStations(res.stations || []);
      } catch (e) { console.error('报表加载失败', e); }
    })();
  }, []);

  // ── 过滤 ──
  const filtered = useMemo(() => {
    return allStations.filter(s => {
      if (filters.region && s.region !== filters.region) return false;
      if (filters.station && s.name !== filters.station) return false;
      if (filters.search && !s.name.toLowerCase().includes(filters.search.toLowerCase()) && !s.short.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.status === 'active' && s.status === 'closed') return false;
      if (filters.status === 'closed' && s.status !== 'closed') return false;
      return true;
    });
  }, [allStations, filters]);

  // ── 排序 ──
  const toggleSort = (key) => { if (sortKey === key) setSortAsc(!sortAsc); else { setSortKey(key); setSortAsc(false); } };
  const sortIcon = (key) => sortKey !== key ? '⇅' : sortAsc ? '↑' : '↓';

  // ── 导出 Excel ──
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await exportMonthlyExcel(currentMonth);
      if (res.status !== 'ok') throw new Error(res.error || '生成失败');
      const a = document.createElement('a');
      a.href = `/api/export/monthly/${currentMonth}/download`;
      a.click();
    } catch (e) { console.error('Excel导出失败', e); alert('Excel导出失败: ' + e.message); }
    setExporting(false);
  };

  // ── 导出 CSV ──
  const handleExportCSV = () => {
    const parts = currentMonth.split('-');
    let csv = '\uFEFF站点,俄语名,区域,销售金额,销售总量,现金,刷卡,积分\n';
    filtered.forEach(s => { csv += `"${s.name}","${s.short}","${s.region}",${Number(s.amount || 0).toFixed(2)},${Number(s.volume || 0).toFixed(2)},${Number(s.cash || 0).toFixed(2)},${Number(s.card || 0).toFixed(2)},${Number(s.bonus || 0).toFixed(2)}\n`; });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `СНК-АЗС_${parts[0]}年${parseInt(parts[1])}月_数据报表.csv`; a.click();
  };

  // ── 站点视图 ──
  const renderStationView = () => {
    const data = [...filtered].map(s => ({ ...s, cardPct: s.amount > 0 ? s.card / s.amount : 0 }));
    data.sort((a, b) => { const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0; if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av); return sortAsc ? av - bv : bv - av; });
    const fAmt = data.reduce((s, x) => s + x.amount, 0);
    const fVol = data.reduce((s, x) => s + x.volume, 0);
    const fCard = data.reduce((s, x) => s + x.card, 0);
    return (
      <>
        <thead><tr>
          <th onClick={() => toggleSort('name')}>站点名称 {sortIcon('name')}</th>
          <th onClick={() => toggleSort('short')}>俄语名 {sortIcon('short')}</th>
          <th onClick={() => toggleSort('region')}>区域 {sortIcon('region')}</th>
          <th onClick={() => toggleSort('amount')} className="num">销售金额(索姆) {sortIcon('amount')}</th>
          <th onClick={() => toggleSort('volume')} className="num">销售总量(升) {sortIcon('volume')}</th>
          <th onClick={() => toggleSort('cash')} className="num">现金(索姆) {sortIcon('cash')}</th>
          <th onClick={() => toggleSort('card')} className="num">刷卡(索姆) {sortIcon('card')}</th>
          <th onClick={() => toggleSort('bonus')} className="num">积分(索姆) {sortIcon('bonus')}</th>
          <th onClick={() => toggleSort('cardPct')} className="num">刷卡率 {sortIcon('cardPct')}</th>
          <th>状态</th>
        </tr></thead>
        <tbody>
          {data.map(s => {
            const color = REGION_COLORS[s.region] || '#7db8f0';
            return (
              <tr key={s.shopKey} onClick={() => navigate(`/retail/station?name=${encodeURIComponent(s.name)}`)} style={{ cursor: 'pointer' }}>
                <td><b>{s.name}</b></td>
                <td style={{ color: 'rgba(160,180,210,0.5)' }}>{s.short}</td>
                <td><span className="retail-tag" style={{ background: color + '18', color, border: `1px solid ${color}30` }}>{s.region}</span></td>
                <td className="num">{s.amount > 0 ? fixed2(s.amount) : '--'}</td>
                <td className="num">{s.volume > 0 ? fixed2(s.volume) : '--'}</td>
                <td className="num">{s.cash > 0 ? fixed2(s.cash) : '--'}</td>
                <td className="num">{s.card > 0 ? fixed2(s.card) : '--'}</td>
                <td className="num">{s.bonus > 0 ? fixed2(s.bonus) : '--'}</td>
                <td className="num">{s.amount > 0 ? (s.card / s.amount * 100).toFixed(2) + '%' : '--'}</td>
                <td>{s.status === 'closed' ? (s.closedReason?.includes('装修') ? <span className="retail-tag" style={{ background: 'rgba(255,167,38,0.15)', color: '#ffa726', border: '1px solid rgba(255,167,38,0.3)' }}>装修</span> : <span className="retail-tag tag-red">停业</span>) : <span className="retail-tag tag-green">正常</span>}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={10} style={{ padding: '8px 14px', fontSize: 11, color: 'rgba(160,180,210,0.5)' }}>
          共 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{data.length}</span> 个站点 |
          合计金额 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{numberFormat(fAmt)}</span> 索姆 |
          合计销量 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{volumeFormat(fVol)}</span> 升 |
          平均刷卡率 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{fAmt > 0 ? (fCard / fAmt * 100).toFixed(2) : 0}%</span>
        </td></tr></tfoot>
      </>
    );
  };

  // ── 区域视图 ──
  const renderRegionView = () => {
    const regionAgg = {};
    filtered.forEach(s => {
      if (!regionAgg[s.region]) regionAgg[s.region] = { region: s.region, stations: 0, amount: 0, volume: 0, cash: 0, card: 0 };
      regionAgg[s.region].stations++;
      regionAgg[s.region].amount += s.amount;
      regionAgg[s.region].volume += s.volume;
      regionAgg[s.region].cash += s.cash;
      regionAgg[s.region].card += s.card;
    });
    const fTotal = Object.values(regionAgg).reduce((s, x) => s + x.amount, 0);
    let rows = Object.values(regionAgg).map(r => ({ ...r, cardPct: r.amount > 0 ? r.card / r.amount : 0, share: fTotal > 0 ? r.amount / fTotal : 0 }));
    rows.sort((a, b) => sortAsc ? (a[sortKey] || 0) - (b[sortKey] || 0) : (b[sortKey] || 0) - (a[sortKey] || 0));
    const fAmt = rows.reduce((s, x) => s + x.amount, 0);
    return (
      <>
        <thead><tr>
          <th onClick={() => toggleSort('region')}>区域 {sortIcon('region')}</th>
          <th onClick={() => toggleSort('stations')}>站点数 {sortIcon('stations')}</th>
          <th onClick={() => toggleSort('amount')} className="num">销售金额(索姆) {sortIcon('amount')}</th>
          <th onClick={() => toggleSort('volume')} className="num">销售总量(升) {sortIcon('volume')}</th>
          <th onClick={() => toggleSort('cash')} className="num">现金(索姆) {sortIcon('cash')}</th>
          <th onClick={() => toggleSort('card')} className="num">刷卡(索姆) {sortIcon('card')}</th>
          <th onClick={() => toggleSort('cardPct')} className="num">刷卡率 {sortIcon('cardPct')}</th>
          <th onClick={() => toggleSort('share')} className="num">金额占比 {sortIcon('share')}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const color = REGION_COLORS[r.region] || '#7db8f0';
            return (
              <tr key={r.region} onClick={() => navigate(`/retail/region?region=${encodeURIComponent(r.region)}`)} style={{ cursor: 'pointer' }}>
                <td><span className="retail-tag" style={{ background: color + '18', color, border: `1px solid ${color}30` }}>{r.region}</span></td>
                <td>{r.stations}</td>
                <td className="num">{r.amount > 0 ? fixed2(r.amount) : '--'}</td>
                <td className="num">{r.volume > 0 ? fixed2(r.volume) : '--'}</td>
                <td className="num">{r.cash > 0 ? fixed2(r.cash) : '--'}</td>
                <td className="num">{r.card > 0 ? fixed2(r.card) : '--'}</td>
                <td className="num">{r.amount > 0 ? (r.card / r.amount * 100).toFixed(2) + '%' : '--'}</td>
                <td className="num"><b style={{ color: '#00d4ff' }}>{(r.share * 100).toFixed(2)}%</b></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={8} style={{ padding: '8px 14px', fontSize: 11, color: 'rgba(160,180,210,0.5)' }}>
          共 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{rows.length}</span> 个区域 |
          合计金额 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{numberFormat(fAmt)}</span> 索姆
        </td></tr></tfoot>
      </>
    );
  };

  // ── 支付方式视图 ──
  const renderPaymentView = () => {
    const data = filtered.filter(s => s.amount > 0).map(s => ({ ...s, cashPct: s.cash / s.amount, cardPct: s.card / s.amount }));
    data.sort((a, b) => sortAsc ? (a[sortKey] || 0) - (b[sortKey] || 0) : (b[sortKey] || 0) - (a[sortKey] || 0));
    const fAmt = data.reduce((s, x) => s + x.amount, 0);
    const fCash = data.reduce((s, x) => s + x.cash, 0);
    const fCard = data.reduce((s, x) => s + x.card, 0);
    return (
      <>
        <thead><tr>
          <th>站点</th><th>区域</th>
          <th onClick={() => toggleSort('cash')} className="num">现金 {sortIcon('cash')}</th>
          <th onClick={() => toggleSort('card')} className="num">刷卡 {sortIcon('card')}</th>
          <th onClick={() => toggleSort('bonus')} className="num">积分 {sortIcon('bonus')}</th>
          <th onClick={() => toggleSort('amount')} className="num">合计 {sortIcon('amount')}</th>
          <th onClick={() => toggleSort('cashPct')} className="num">现金占比 {sortIcon('cashPct')}</th>
          <th onClick={() => toggleSort('cardPct')} className="num">刷卡占比 {sortIcon('cardPct')}</th>
        </tr></thead>
        <tbody>
          {data.map(s => {
            const color = REGION_COLORS[s.region] || '#7db8f0';
            return (
              <tr key={s.shopKey} onClick={() => navigate(`/retail/station?name=${encodeURIComponent(s.name)}`)} style={{ cursor: 'pointer' }}>
                <td><b>{s.name}</b></td>
                <td><span className="retail-tag" style={{ background: color + '18', color, border: `1px solid ${color}30` }}>{s.region}</span></td>
                <td className="num">{fixed2(s.cash)}</td>
                <td className="num">{fixed2(s.card)}</td>
                <td className="num">{s.bonus > 0 ? fixed2(s.bonus) : '--'}</td>
                <td className="num"><b>{fixed2(s.amount)}</b></td>
                <td className="num" style={{ color: '#00d4ff' }}>{(s.cashPct * 100).toFixed(2)}%</td>
                <td className="num" style={{ color: '#00e5a0' }}>{(s.cardPct * 100).toFixed(2)}%</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={8} style={{ padding: '8px 14px', fontSize: 11, color: 'rgba(160,180,210,0.5)' }}>
          合计金额 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{numberFormat(fAmt)}</span> |
          现金 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{numberFormat(fCash)}</span> ({fAmt > 0 ? (fCash / fAmt * 100).toFixed(2) : 0}%) |
          刷卡 <span style={{ color: '#00d4ff', fontWeight: 700 }}>{numberFormat(fCard)}</span> ({fAmt > 0 ? (fCard / fAmt * 100).toFixed(2) : 0}%)
        </td></tr></tfoot>
      </>
    );
  };

  return (
    <div className="retail-page-wrap" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 筛选栏 */}
      <div className="retail-filter-bar">
        <label>区域</label>
        <select className="retail-month-select" value={filters.region} onChange={e => setFilters({ ...filters, region: e.target.value })}>
          <option value="">全部区域</option>
          {REGION_ORDER.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label>站点</label>
        <select className="retail-month-select" value={filters.station} onChange={e => setFilters({ ...filters, station: e.target.value })}>
          <option value="">全部站点</option>
          {allStations.map(s => <option key={s.shopKey} value={s.name}>{s.name} ({s.short})</option>)}
        </select>
        <label>🔍</label>
        <input className="retail-search-input" placeholder="搜索站名..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
        <label>状态</label>
        <select className="retail-month-select" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">全部</option>
          <option value="active">正常营业</option>
          <option value="closed">停业</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(160,180,210,0.4)' }}>共 {filtered.length} 条</span>
      </div>

      {/* 视图切换 + 导出 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {['station', 'region', 'payment'].map((v, i) => (
          <div key={v} className={`retail-view-tab${view === v ? ' active' : ''}`} onClick={() => { setView(v); setSortKey('amount'); setSortAsc(false); }}>
            {['按站点汇总', '按区域汇总', '按支付方式'][i]}
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="retail-report-btn" onClick={handleExportExcel} disabled={exporting} style={{ background: 'rgba(0,212,255,0.15)', border: '1px solid #00d4ff', color: '#00d4ff' }}>
            {exporting ? '⏳ 生成中...' : '📊 导出 Excel 日销表'}
          </button>
          <button className="retail-report-btn" onClick={handleExportCSV}>⬇ 导出 CSV</button>
          <button className="retail-report-btn" onClick={() => window.print()}>🖨 打印</button>
        </div>
      </div>

      {/* 表格 */}
      <div className="retail-table-wrap">
        <table className="retail-data-table">
          {view === 'station' && renderStationView()}
          {view === 'region' && renderRegionView()}
          {view === 'payment' && renderPaymentView()}
        </table>
      </div>
    </div>
  );
}
