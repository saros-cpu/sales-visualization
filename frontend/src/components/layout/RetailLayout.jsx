// src/components/layout/RetailLayout.jsx — 零售模块暗色主题布局
import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { RETAIL_NAV } from '../../utils/retail-helpers';
import { RetailHeaderProvider, useRetailHeader } from './RetailHeaderContext';

function RetailHeaderControls() {
  const { controls } = useRetailHeader();
  if (!controls) return null;

  if (controls.type === 'monthly') {
    return (
      <>
        <div className="retail-month-selector">
          <span>选择月份：</span>
          <select
            className="retail-month-select"
            value={controls.ym || ''}
            onChange={e => controls.onYmChange(e.target.value)}
          >
            {controls.months.map(m => {
              const parts = m.month.split('-');
              return (
                <option key={m.month} value={m.month}>
                  {parts[0]}年{parseInt(parts[1])}月
                </option>
              );
            })}
          </select>
        </div>
        <button
          className="retail-report-btn"
          onClick={controls.onReport}
          disabled={controls.reporting}
        >
          {controls.reporting ? '生成中...' : '生成分析报告'}
        </button>
      </>
    );
  }

  if (controls.type === 'resource') {
    return (
      <>
        <div className="retail-month-selector">
          <span>年份</span>
          <select
            className="retail-month-select"
            value={controls.year || ''}
            onChange={e => controls.onYearChange(Number(e.target.value))}
          >
            {controls.years.map(y => (
              <option key={y} value={y}>{y} 年</option>
            ))}
          </select>
        </div>
        <div className="retail-month-selector">
          <span>月份</span>
          <select
            className="retail-month-select"
            value={controls.month || ''}
            onChange={e => controls.onMonthChange(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">全年</option>
            {controls.months.map(m => (
              <option key={m} value={m}>{m} 月</option>
            ))}
          </select>
        </div>
      </>
    );
  }

  return null;
}

function RetailLayoutInner() {
  const navigate = useNavigate();
  const [clock, setClock] = useState({ time: '--:--:--', date: '' });

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const pad = (v) => String(v).padStart(2, '0');
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      setClock({
        time: `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`,
        date: `${n.getFullYear()}年${pad(n.getMonth() + 1)}月${pad(n.getDate())}日 星期${days[n.getDay()]}`,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="retail-shell">
      <header className="retail-header">
        <div className="retail-header-left">
          <a className="retail-nav-btn" href="/">返回总项目</a>
          <div className="retail-logo">⛽</div>
          <div>
            <div className="retail-title">СНК-АЗС 数据监控中心</div>
            <div className="retail-sub">SIBNEFTEKART · Example石油公司 · 吉尔吉斯斯坦</div>
          </div>
        </div>
        <div className="retail-header-center">
          <div className="retail-clock">{clock.time}</div>
          <div className="retail-date">{clock.date}</div>
        </div>
        <div className="retail-header-right">
          <RetailHeaderControls />
          <nav className="retail-nav">
            {RETAIL_NAV.map(item => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.key === 'dashboard'}
                className={({ isActive }) => `retail-nav-btn${isActive ? ' active' : ''}`}
              >
                {item.label}
                {item.badge && <span className="retail-badge">!</span>}
              </NavLink>
            ))}
          </nav>
          <div className="retail-status">
            <div className="retail-status-dot" />
            <span>在线</span>
          </div>
        </div>
      </header>

      <Outlet />
    </div>
  );
}

export default function RetailLayout() {
  return (
    <RetailHeaderProvider>
      <RetailLayoutInner />
    </RetailHeaderProvider>
  );
}
