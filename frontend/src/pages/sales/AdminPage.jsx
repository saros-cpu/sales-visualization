// src/pages/sales/AdminPage.jsx — 管理后台主页
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ADMIN_TABS } from '../../utils/admin-helpers';
import { getReferenceOptions, getProducts as getProductsApi, getUsers, getStationCatalog, getStationStatuses, getAdminExchangeRates } from '../../api/admin';
import OverviewPanel from '../../components/admin/OverviewPanel';
import AutomationPanel from '../../components/admin/AutomationPanel';
import MarketPanel from '../../components/admin/MarketPanel';
import RetailPanel from '../../components/admin/RetailPanel';
import FinancePanel from '../../components/admin/FinancePanel';
import ReferencePanel from '../../components/admin/ReferencePanel';
import HealthPanel from '../../components/admin/HealthPanel';
import SystemPanel from '../../components/admin/SystemPanel';
import WholesaleContractPanel from '../../components/admin/WholesaleContractPanel';

export default function AdminPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('salesAdminTab') || 'overview');
  const [statusText, setStatusText] = useState('正在读取数据...');

  // Set body class for admin-page CSS (color-scheme: light, etc.)
  useEffect(() => {
    document.body.classList.add('admin-page');
    return () => document.body.classList.remove('admin-page');
  }, []);
  // 共享参考数据
  const [products, setProducts] = useState([]);
  const [customerOptions, setCustomerOptions] = useState([]);
  // hero 摘要卡片
  const [stationCount, setStationCount] = useState('--');
  const [statusCount, setStatusCount] = useState('--');
  const [userCount, setUserCount] = useState('--');
  const [exchangeGapCount, setExchangeGapCount] = useState('--');
  // 跨面板刷新信号
  const [refreshKey, setRefreshKey] = useState(0);

  const switchTab = useCallback((tab) => {
    setActiveTab(tab);
    localStorage.setItem('salesAdminTab', tab);
  }, []);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // 加载共享参考数据 + hero 摘要
  useEffect(() => {
    getReferenceOptions()
      .then(data => setCustomerOptions(data.customers || []))
      .catch(() => {});
    getProductsApi()
      .then(data => setProducts(data.items || []))
      .catch(() => {});
    getUsers().then(d => setUserCount(d?.items?.length ?? '--')).catch(() => {});
    getStationCatalog().then(d => setStationCount(d?.items?.length ?? '--')).catch(() => {});
    getStationStatuses().then(d => setStatusCount(d?.items?.length ?? '--')).catch(() => {});
    getAdminExchangeRates({ year: new Date().getFullYear() }).then(d => {
      setExchangeGapCount(d.openGaps ?? 0);
    }).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    setStatusText('后台数据已更新');
  }, [refreshKey]);

  const panelProps = { products, customerOptions, refresh, refreshKey, setStatusText, switchTab };

  return (
    <div className="admin-page">
      <div className="admin-layout">
        <aside className="admin-layout-sidebar">
          <div className="admin-logo">
            <span className="admin-logo-mark">销</span>
            <div>
              <strong>销售数据可视化</strong>
              <small>管理后台</small>
            </div>
          </div>
          <nav className="admin-sidebar">
            {ADMIN_TABS.map(t => (
              <button
                key={t.key}
                type="button"
                className={activeTab === t.key ? 'active' : ''}
                onClick={() => switchTab(t.key)}
              >
                <span>{t.label}</span>
                <small>{t.sub}</small>
              </button>
            ))}
          </nav>
        </aside>

        <section className="admin-layout-main">
          <header className="admin-navbar">
            <div className="admin-breadcrumb">
              <strong>后台管理</strong>
              <span>{statusText}</span>
            </div>
            <div className="admin-navbar-actions">
              <a className="ghost-button" href="/">返回主页</a>
              <button type="button" onClick={handleLogout}>退出登录</button>
            </div>
          </header>
          <div className="admin-tags">
            <span>工作台</span><span>数据维护</span><span>系统管理</span>
          </div>

          <main className="admin-main">
            <section className="admin-hero">
              <div>
                <span className="admin-kicker">运营后台</span>
                <h2>前台只展示，维护工作集中在后台处理</h2>
              </div>
              <div className="admin-summary">
                <div><span>加油站</span><strong>{stationCount}</strong></div>
                <div><span>站点状态</span><strong>{statusCount}</strong></div>
                <div><span>后台用户</span><strong>{userCount}</strong></div>
                <div><span>汇率缺口</span><strong>{exchangeGapCount}</strong></div>
              </div>
            </section>

            <section className="admin-content">
              {activeTab === 'overview' && <OverviewPanel {...panelProps} />}
              {activeTab === 'automation' && <AutomationPanel {...panelProps} />}
              {activeTab === 'market' && <MarketPanel {...panelProps} />}
              {activeTab === 'retail' && <RetailPanel {...panelProps} />}
              {activeTab === 'wholesale-contract' && <WholesaleContractPanel {...panelProps} />}
              {activeTab === 'finance' && <FinancePanel {...panelProps} />}
              {activeTab === 'reference' && <ReferencePanel {...panelProps} />}
              {activeTab === 'health' && <HealthPanel {...panelProps} />}
              {activeTab === 'system' && <SystemPanel {...panelProps} />}
            </section>
          </main>
        </section>
      </div>
    </div>
  );
}
