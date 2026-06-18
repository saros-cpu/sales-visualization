import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { usePeriod } from '../../hooks/usePeriod';
import { useApi } from '../../hooks/useApi';
import { getSummary, getHomeExchange, getMarketWatch, generateSalesReport } from '../../api/sales';
import LoadingSpinner from '../../components/common/LoadingSpinner';

// 格式化函数
const yuan = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const retailYuan = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const retailNum = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });

function formatRate(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toFixed(digits);
}

function regionLabel(region) {
  return { Russia: '俄罗斯', Uzbekistan: '乌兹别克', Global: '国际' }[region] || region || '市场';
}

// ── KPI 卡片组件 ──
function KpiCard({ label, sublabel, amount, details, className, onClick }) {
  return (
    <div className={`metric-panel ${className || ''} home-login-card`} onClick={onClick} tabIndex={0}>
      <span>{label}</span>
      <strong>{amount || '--'}</strong>
      <small>{sublabel}</small>
      <dl>
        {details?.map((d, i) => (
          <div key={i}>
            <dt>{d.label}</dt>
            <dd>{d.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── 汇率面板 ──
function ExchangePanel() {
  const { data, loading } = useApi(() => getHomeExchange(), []);

  if (loading) return <div className="panel home-rate-panel"><LoadingSpinner text="读取汇率快照..." /></div>;
  if (!data?.available) {
    return (
      <article className="panel home-rate-panel">
        <div className="panel-head">
          <div><h2>今日汇率</h2><span>{data?.message || '暂无汇率快照'}</span></div>
        </div>
      </article>
    );
  }

  return (
    <article className="panel home-rate-panel">
      <div className="panel-head">
        <div>
          <h2>今日汇率</h2>
          <span>{data.date}{data.isToday ? '' : '（最新可用）'}</span>
        </div>
        <div className="rate-grid">
          <div><span>美元 / 索姆</span><strong>{formatRate(data.usdKgs, 4)}</strong></div>
          <div><span>人民币 / 索姆</span><strong>{formatRate(data.cnyKgs, 4)}</strong></div>
          <div><span>索姆 / 人民币</span><strong>{data.cnyKgs ? formatRate(1 / Number(data.cnyKgs), 6) : '--'}</strong></div>
        </div>
        <span>汇率来源：{data.isManual ? '人工补录' : (data.source || 'NBKR')}</span>
      </div>
    </article>
  );
}

// ── 市场观察面板 ──
function MarketWatchPanel() {
  const { data, loading } = useApi(() => getMarketWatch(), []);

  return (
    <article className="panel home-market-panel">
      <div className="panel-head">
        <div>
          <h2>市场观察</h2>
          <span>{data?.updatedAt ? `信息获取时间：${data.updatedAt}` : '信息获取时间：待维护'}</span>
        </div>
      </div>
      <div className="market-watch-list">
        {loading ? (
          <div className="market-watch-item">正在读取市场观察...</div>
        ) : !data?.items?.length ? (
          <div className="market-watch-item">暂无市场观察数据</div>
        ) : (
          data.items.map((item, i) => (
            <div key={i} className={`market-watch-item market-watch-${String(item.region || 'market').toLowerCase()}`}>
              <div className="market-watch-meta">
                <span>{regionLabel(item.region)}</span>
                <small>{item.observedAt || '待维护'}</small>
              </div>
              <div className="market-watch-card-head">
                <strong>{item.title || '--'}</strong>
                <em>{item.priceText ? '价格已同步' : '行情摘要'}</em>
              </div>
              {item.priceText && (
                <div className="market-watch-price"><span>价格参考</span><b>{item.priceText}</b></div>
              )}
              <p>{item.summary || ''}</p>
              {Array.isArray(item.details) && item.details.length > 1 && (
                <div className="market-watch-detail-list">
                  {item.details.slice(1, 5).map((detail, j) => (
                    <div key={j} className="market-watch-detail">
                      <b>{detail.typeLabel || '市场行情'}｜{detail.title || item.title || '--'}</b>
                      {detail.priceText && (
                        <span className="market-watch-price compact"><span>价格</span><b>{detail.priceText}</b></span>
                      )}
                      <small>{detail.summary || ''}</small>
                    </div>
                  ))}
                </div>
              )}
              <div className="market-watch-footer">
                <span>{item.sourceName || '市场公开来源'}</span>
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a>}
              </div>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

// ── 油库标点数据 ──
function percent(value, total) {
  const n = Number(value || 0);
  const d = Number(total || 0);
  if (!d || n <= 0) return 0;
  return Math.max(3, Math.min(100, (n / d) * 100));
}

function HomeVisualizationPanel({ retail, wholesale, combined }) {
  const retailAmount = Number(retail.amountCny || 0);
  const wholesaleAmount = Number(wholesale.salesAmountCny || 0);
  const totalAmount = Number(combined.salesAmountCny || 0) || retailAmount + wholesaleAmount;
  const retailTons = Number(retail.tons || 0);
  const wholesaleTons = Number(wholesale.salesTons || 0);
  const transferTons = Number(wholesale.transferTons || 0);
  const totalFlow = retailTons + wholesaleTons + transferTons;
  const rows = [
    { label: '零售收入', value: retailYuan.format(retailAmount), pct: percent(retailAmount, totalAmount), tone: 'retail' },
    { label: '批发收入', value: yuan.format(wholesaleAmount), pct: percent(wholesaleAmount, totalAmount), tone: 'wholesale' },
    { label: '零售销量', value: `${retailNum.format(retailTons)} 吨`, pct: percent(retailTons, totalFlow), tone: 'retail' },
    { label: '批发销量', value: `${num.format(wholesaleTons)} 吨`, pct: percent(wholesaleTons, totalFlow), tone: 'wholesale' },
    { label: '外运吨数', value: `${num.format(transferTons)} 吨`, pct: percent(transferTons, totalFlow), tone: 'transfer' },
  ];

  return (
    <section className="panel home-visual-panel">
      <div className="panel-head">
        <div>
          <h2>经营数据可视化</h2>
          <span>收入结构、销量结构与外运规模</span>
        </div>
      </div>
      <div className="home-visual-grid">
        <div className="home-visual-bars">
          {rows.map((item) => (
            <div className={`home-visual-row ${item.tone}`} key={item.label}>
              <div className="home-visual-row-head">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="home-visual-track">
                <i style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="home-visual-focus">
          <div>
            <span>综合收入</span>
            <strong>{yuan.format(totalAmount || 0)}</strong>
          </div>
          <div>
            <span>销售吨数</span>
            <strong>{num.format(combined.salesTons || 0)} 吨</strong>
          </div>
          <div>
            <span>外运占比</span>
            <strong>{totalFlow ? `${((transferTons / totalFlow) * 100).toFixed(1)}%` : '--'}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

const depotPoints = [
  { name: 'STN-61', short: 'Главная нефтебаза', region: 'REG-01', lng: 0, lat: 0, role: 'hq', status: 'normal' },
  { name: 'DemoDepotNorth', short: 'Север DemoDepot', region: 'REG-08', lng: 0, lat: 0, role: 'branch', status: 'closed', note: '维修中' },
  { name: 'DemoDepotSouth', short: 'Юж DemoDepot', region: 'REG-07', lng: 0, lat: 0, role: 'branch', status: 'normal' }
];

// Runtime dynamic import — bypass bundler resolution for external assets
const runtimeImport = (url) => new Function('url', 'return import(url)')(url);

// ── 主页组件 ──
export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, handleLogout } = useOutletContext() || {};
  const { year, month, years, setYear, setMonth, label } = usePeriod();
  const [statusText, setStatusText] = useState('正在读取数据...');
  const [generating, setGenerating] = useState(false);
  const homeKgzMapRef = useRef(null);
  const echartsMapRef = useRef(null);
  const mapShellRef = useRef(null);
  const [homeMapFullscreen, setHomeMapFullscreen] = useState(false);

  const { data: summary, loading: summaryLoading, reload: reloadSummary } = useApi(
    () => getSummary(year, month),
    [year, month]
  );

  useEffect(() => {
    if (summaryLoading) {
      setStatusText('正在更新统计...');
    } else if (summary) {
      setStatusText(label);
    }
  }, [summaryLoading, summary, label]);

  const handleRefresh = useCallback(() => {
    reloadSummary();
  }, [reloadSummary]);

  const handleGenerateReport = async () => {
    setGenerating(true);
    setStatusText('正在生成销售分析报告...');
    try {
      const data = await generateSalesReport(year, month);
      const url = data.docxDownloadUrl || data.htmlDownloadUrl;
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setStatusText(`${data.title || '销售分析报告'}已生成`);
    } catch (err) {
      setStatusText(`销售分析报告生成失败：${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const resizeHomeMap = useCallback(() => {
    homeKgzMapRef.current?.resize?.();
    echartsMapRef.current?.resize?.();
  }, []);

  const scheduleHomeMapResize = useCallback(() => {
    window.setTimeout(resizeHomeMap, 60);
    window.setTimeout(resizeHomeMap, 240);
  }, [resizeHomeMap]);

  const toggleHomeMapFullscreen = useCallback(async () => {
    const shell = mapShellRef.current;
    if (!shell || !document.fullscreenEnabled) return;
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen();
    } else {
      await shell.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setHomeMapFullscreen(document.fullscreenElement === mapShellRef.current);
      scheduleHomeMapResize();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && document.fullscreenElement === mapShellRef.current) {
        document.exitFullscreen().catch(() => {});
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [scheduleHomeMapResize]);

  // ── ECharts 回退地图 ──
  const initEChartsMap = useCallback(async () => {
    if (!window.echarts) return;
    try {
      const resp = await fetch('/assets/kgz_merged.json');
      const geojson = await resp.json();
      if (!window.echarts.getMap('kyrgyzstan')) {
        window.echarts.registerMap('kyrgyzstan', geojson);
      }
    } catch { return; }
    const el = document.getElementById('homeMapChart');
    if (!el) return;
    const mc = window.echarts.init(el);
    echartsMapRef.current = mc;
    const mapPoints = depotPoints.map(p => ({ ...p, type: 'depot' }));
    const data = mapPoints.map(p => ({
      name: p.name, value: [p.lng, p.lat],
      itemStyle: { color: p.role === 'hq' ? '#00d4ff' : (p.status === 'closed' ? '#616b78' : '#ffd54f') }
    }));
    mc.setOption({
      backgroundColor: 'transparent',
      geo: {
        map: 'kyrgyzstan', roam: true,
        scaleLimit: { min: 1, max: 5 },
        itemStyle: { areaColor: 'rgba(10,30,60,0.84)', borderColor: 'rgba(0,212,255,0.76)', borderWidth: 1.4 },
        emphasis: { itemStyle: { areaColor: 'rgba(0,212,255,0.28)', borderColor: 'rgba(0,255,255,0.95)', borderWidth: 2 }, label: { show: false } },
      },
      series: [{
        type: 'effectScatter', coordinateSystem: 'geo', name: '油库', data, symbol: 'diamond',
        symbolSize: (params) => { const p = mapPoints.find(i => i.name === params.name); return p?.role === 'hq' ? 14 : 12; },
        rippleEffect: { scale: 3, period: 3, brushType: 'stroke' }, showEffectOn: 'render',
        label: { show: false },
        itemStyle: { shadowColor: 'rgba(0,212,255,0.35)', shadowBlur: 10 }, zlevel: 10
      }],
      tooltip: {
        trigger: 'item', backgroundColor: 'rgba(5,10,25,0.98)', borderColor: 'rgba(0,212,255,0.35)', borderWidth: 1,
        textStyle: { color: '#e0e8f5', fontSize: 12 },
        formatter: p => {
          const point = mapPoints.find(i => i.name === p.name);
          if (!point) return p.name;
          const state = point.status === 'closed' ? '<span style="color:#ff6b6b">维修中</span>' : '<span style="color:#00e5a0">运营中</span>';
          return `<div style="font-weight:800;color:#00d4ff;margin-bottom:7px">${point.name}</div><div style="color:#c9d8e8">${point.short}</div><div style="margin-top:6px">${state}</div><div style="color:rgba(200,220,240,0.72);margin-top:4px">${point.region}</div>`;
        }
      }
    });
  }, []);

  // ── 3D 地图初始化 ──
  const initMap = useCallback(async () => {
    if (window.USE_3D_KGZ_MAP !== false) {
      try {
        const { mountHomeMap } = await runtimeImport('/assets/kgz-map/kgz-map-entry.js?v=20260729-depot-cluster');
        mapShellRef.current?.classList.add('is-3d-map');
        const map = await mountHomeMap('#homeMapChart', {
          depots: depotPoints.map(p => ({
            ...p, type: 'depot',
            depotType: p.role === 'hq' ? 'headquarters' : 'branch',
            size: p.role === 'hq' ? 0.2 : 0.18,
            y: p.role === 'hq' ? 3.12 : 2.9,
            renderOrder: 176,
            color: p.role === 'hq' ? '#38bdf8' : '#facc15',
            anchorColor: p.role === 'hq' ? '#7dd3fc' : '#fde68a',
            anchorOpacity: 0.78,
            pinLine: true,
            opacity: 0.98, showLabel: false, label: p.name,
            labelSubtitle: p.status === 'closed' ? '维修中' : '运营中',
            labelColor: p.status === 'closed' ? '#d8dee9' : '#f8fafc',
            hoverScale: 2.25,
            hoverLift: 0.24
          })),
          wholesaleCustomers: []
        }, {
          showRoads: true, showRoadPanel: true, showLakeLabels: true,
          showCities: true, showRegionLabels: false, showLegend: false,
          viewOffsetX: -4.0, viewOffsetZ: 0.25, mode: 'home',
          fallback(error) {
            homeKgzMapRef.current = null;
            mapShellRef.current?.classList.remove('is-3d-map');
            console.warn('[Kgz3DMap] home fallback to ECharts:', error);
            initEChartsMap();
          }
        });
        if (map) {
          homeKgzMapRef.current = map;
          return;
        }
      } catch (err) {
        console.warn('[Kgz3DMap] home import failed, fallback to ECharts:', err);
      }
    }
    mapShellRef.current?.classList.remove('is-3d-map');
    await initEChartsMap();
  }, [initEChartsMap]);

  // ── 地图初始化 & resize ──
  useEffect(() => {
    initMap();
    const onResize = () => {
      resizeHomeMap();
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      homeKgzMapRef.current?.destroy?.();
      echartsMapRef.current?.dispose?.();
    };
  }, [initMap, resizeHomeMap]);

  const r = summary?.retail || {};
  const w = summary?.wholesale || {};
  const c = summary?.combined || {};

  return (
    <>
      {/* 完整 topbar（与原版 index.html 一致） */}
      <header className="topbar">
        <div>
          <h1>销售数据可视化</h1>
          <p id="statusText">{statusText}</p>
          <nav className="module-nav">
            <Link to="/" className="active">主页</Link>
            <Link to="/knowledge">知识库</Link>
            {user?.role === 'admin' ? (
              <Link to="/admin" className="module-auth-link admin-ready">后台</Link>
            ) : (
              <Link to="/login?next=/admin" className="module-auth-link">登录</Link>
            )}
          </nav>
        </div>
        <div className="filters">
          <label>
            年度
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.slice().reverse().map((y) => (
                <option key={y} value={String(y)}>{y} 年</option>
              ))}
            </select>
          </label>
          <label>
            月份
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">全年</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>{m} 月</option>
              ))}
            </select>
          </label>
          <button onClick={handleRefresh}>刷新</button>
          <button onClick={handleGenerateReport} disabled={generating}>
            生成销售分析报告
          </button>
        </div>
      </header>

      <main>
      {/* KPI 卡片 */}
      <section className="summary-grid kpi-only">
        <KpiCard
          label="零售"
          sublabel="人民币销售额"
          className="retail"
          amount={retailYuan.format(r.amountCny || 0)}
          details={[
            { label: '销量', value: `${retailNum.format(r.tons || 0)} 吨` },
            { label: '升数', value: `${retailNum.format(r.liters || 0)} 升` },
          ]}
          onClick={() => navigate('/retail')}
        />
        <KpiCard
          label="批发"
          sublabel="本地批发 + 出口批发"
          className="wholesale"
          amount={yuan.format(w.salesAmountCny || 0)}
          details={[
            { label: '销售吨数', value: `${num.format(w.salesTons || 0)} 吨` },
            { label: '外运吨数', value: `${num.format(w.transferTons || 0)} 吨` },
          ]}
          onClick={() => navigate('/wholesale')}
        />
        <KpiCard
          label="合并统计"
          sublabel="零售 + 批发销售"
          className="combined"
          amount={yuan.format(c.salesAmountCny || 0)}
          details={[
            { label: '销售吨数', value: `${num.format(c.salesTons || 0)} 吨` },
            { label: '外运另计', value: `${num.format(c.transferTons || 0)} 吨` },
          ]}
        />
      </section>

      {/* 汇率 + 市场观察 */}
      <HomeVisualizationPanel retail={r} wholesale={w} combined={c} />

      <section className="home-context-grid">
        <ExchangePanel />
        <MarketWatchPanel />
      </section>

      {/* 3D 地图：油库分布 */}
      <section className="panel map-panel home-map-panel">
        <div className="panel-head">
          <div>
            <h2>吉尔吉斯斯坦油库分布</h2>
            <span>STN-61 / DemoDepotNorth / DemoDepotSouth</span>
          </div>
          <span className="map-hint">滚轮缩放 · 拖动查看</span>
        </div>
        <div className="map-shell" ref={mapShellRef}>
          {document.fullscreenEnabled && !homeMapFullscreen && (
            <button
              type="button"
              className="map-fullscreen-btn"
              title={homeMapFullscreen ? '退出全屏' : '全屏'}
              aria-label={homeMapFullscreen ? '退出全屏' : '全屏'}
              onClick={toggleHomeMapFullscreen}
            >
              {homeMapFullscreen ? '×' : '⛶'}
            </button>
          )}
          <div id="homeMapChart"></div>
          <div className="map-legend">
            <span><i className="legend-dot hq"></i>STN-61</span>
            <span><i className="legend-dot depot"></i>分油库</span>
            <span><i className="legend-dot closed"></i>维修/停用</span>
          </div>
        </div>
      </section>
      </main>
    </>
  );
}
