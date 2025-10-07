// src/pages/sales/WholesalePage.jsx — 批发模块主页
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useOutletContext, Link } from 'react-router-dom';
import { usePeriod } from '../../hooks/usePeriod';
import { fetchWholesale, generateWholesaleReport, exportExchangeRates } from '../../api/wholesale';
import { triggerDownload } from '../../api/client';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import OverviewTab from './wholesale/OverviewTab';
import ProductsTab from './wholesale/ProductsTab';
import CustomersTab from './wholesale/CustomersTab';
import TransferTab from './wholesale/TransferTab';
import TrendTab from './wholesale/TrendTab';
import ReviewTab from './wholesale/ReviewTab';
import ExchangeTab from './wholesale/ExchangeTab';
import WeighDetailTab from './wholesale/WeighDetailTab';

const TABS = [
  { key: 'overview', label: '总览' },
  { key: 'products', label: '油品统计' },
  { key: 'customers', label: '客户排行' },
  { key: 'transfer', label: '外运' },
  { key: 'trend', label: '每日趋势' },
  { key: 'review', label: '审核' },
  { key: 'exchange', label: '汇率' },
  { key: 'weigh', label: '称重明细' },
];

const sectionTitles = {
  overview: '批发统计',
  products: '批发油品统计',
  customers: '批发客户排行',
  transfer: '外运',
  trend: '每日批发趋势',
  review: '审核',
  exchange: '汇率',
  weigh: '称重明细',
};

export default function WholesalePage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { user, handleLogout } = useOutletContext() || {};
  const { year, month, setYear, setMonth, years, label } = usePeriod();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusText, setStatusText] = useState('正在读取数据...');

  const activeTab = tab && sectionTitles[tab] ? tab : 'overview';

  const loadData = useCallback(async () => {
    if (!year) return;
    setLoading(true);
    setError(null);
    setStatusText('正在更新批发统计...');
    try {
      const result = await fetchWholesale({ year, month });
      setData(result);
      setStatusText(label);
    } catch (err) {
      setError(err.message);
      setStatusText(`加载失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [year, month, label]);

  useEffect(() => { loadData(); }, [loadData]);

  const switchTab = (key) => {
    navigate(`/wholesale/${key === 'overview' ? '' : key}`);
  };

  const handleGenerateReport = async () => {
    setStatusText('正在生成批发分析报告...');
    try {
      const result = await generateWholesaleReport({ year, month });
      await triggerDownload(result.docxDownloadUrl || result.htmlDownloadUrl, result.docxFile || result.htmlFile || '');
      setStatusText(`${result.title || '批发分析报告'}已生成`);
    } catch (err) {
      setStatusText(`报告生成失败：${err.message}`);
    }
  };

  const handleExportExchange = async () => {
    try {
      await exportExchangeRates({ year, month });
    } catch (err) {
      setStatusText(`汇率导出失败：${err.message}`);
    }
  };

  return (
    <div className="wholesale-page">
      {/* 完整 topbar（与原版 wholesale.html 一致） */}
      <header className="topbar">
        <div>
          <h1 id="pageTitle">{sectionTitles[activeTab] || '批发统计'}</h1>
          <p id="statusText">{statusText}</p>
          <nav className="module-nav">
            <Link to="/">主页</Link>
            {user?.role === 'admin' ? (
              <Link to="/admin" className="module-auth-link admin-ready">后台</Link>
            ) : (
              <Link to="/login?next=/admin" className="module-auth-link">登录</Link>
            )}
          </nav>
          <nav className="sub-nav">
            {TABS.map(t => (
              <button
                key={t.key}
                className={activeTab === t.key ? 'active' : ''}
                onClick={() => switchTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="filters">
          <label>
            年度
            <select value={year} onChange={e => setYear(Number(e.target.value))}>
              {years.slice().reverse().map(y => (
                <option key={y} value={y}>{y} 年</option>
              ))}
            </select>
          </label>
          <label>
            月份
            <select value={month || ''} onChange={e => setMonth(e.target.value ? Number(e.target.value) : null)}>
              <option value="">全年</option>
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{m} 月</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={loadData} disabled={loading}>刷新</button>
          <button type="button" onClick={handleGenerateReport} disabled={loading}>生成批发分析报告</button>
        </div>
      </header>

      <main>
      {/* 内容区域 */}
      {loading && <LoadingSpinner />}
      {error && <div className="panel" style={{padding:20,marginTop:16}}><p style={{color:'#ff6b6b'}}>错误：{error}</p></div>}
      {!loading && data && (
        <>
          {activeTab === 'overview' && <OverviewTab data={data} />}
          {activeTab === 'products' && <ProductsTab data={data} />}
          {activeTab === 'customers' && <CustomersTab data={data} />}
          {activeTab === 'transfer' && <TransferTab data={data} />}
          {activeTab === 'trend' && <TrendTab data={data} />}
          {activeTab === 'review' && <ReviewTab data={data} />}
          {activeTab === 'exchange' && <ExchangeTab data={data} onExport={handleExportExchange} />}
          {activeTab === 'weigh' && <WeighDetailTab year={year} month={month} />}
        </>
      )}
      </main>
    </div>
  );
}
