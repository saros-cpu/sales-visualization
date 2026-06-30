// src/pages/retail/AlertPage.jsx — 预警中心
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStationStatuses, getKpi, getMonthlyData, getDashboardYearly, getYears, getDaily, getStationMapDetails } from '../../api/retail';
import { REGION_ORDER } from '../../utils/retail-helpers';

const ym = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; })();

function statusTagClass(item) {
  if (item.statusType === 'normal') return 'tag-green';
  if (item.status === 'closed' || item.affectsSales) return 'tag-red';
  return 'tag-yellow';
}
function statusItemClass(item) {
  if (item.statusType === 'normal') return 'yellow handled';
  if (item.status === 'closed' || item.affectsSales) return 'red handled';
  return 'yellow';
}
function statusIcon(item) {
  const map = { normal: '✅', power_outage: '⚡', road_blocked: '🛣️', renovation: '🚧', data_anomaly: '📊' };
  return map[item.statusType] || '⚠️';
}

function StatusList({ items, navigate, emptyText }) {
  if (!items.length) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'rgba(0,229,160,0.05)', border: '1px solid rgba(0,229,160,0.15)', borderRadius: 6, color: 'rgba(160,180,210,0.6)', fontSize: 12 }}>
      <span style={{ fontSize: 20 }}>✅</span><span>{emptyText}</span>
    </div>
  );
  return items.map((item, i) => (
    <div key={i} className={`alert-item ${statusItemClass(item)}`}>
      <div className="alert-item-icon">{statusIcon(item)}</div>
      <div className="alert-item-body">
        <div className="alert-title">{item.name}（{item.short || '--'}）· {item.region || '--'}</div>
        <div className="alert-desc">
          状态：<b>{item.statusLabel || item.statusType}</b>{item.note ? `。${item.note}` : ''}<br />
          {item.expectedResumeAt ? <>预计恢复：<b style={{ color: '#ffa726' }}>{item.expectedResumeAt.replace('T', ' ').slice(0, 16)}</b></> : '预计恢复时间：未填写'}
        </div>
      </div>
      <div className="alert-item-right">
        <span className={`retail-tag ${statusTagClass(item)}`}>{item.statusLabel || item.statusType}</span>
        <span className="alert-time">{item.startedAt ? item.startedAt.replace('T', ' ').slice(0, 10) : ym}</span>
        <a className="alert-station-link" onClick={(e) => { e.preventDefault(); navigate(`/retail/station?name=${encodeURIComponent(item.name)}`); }}>查看详情 →</a>
      </div>
    </div>
  ));
}

function formatLiters(value, digits = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '--';
  return numeric.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function inventoryItemClass(item) {
  return item.fillStatus === 'critical' ? 'red' : item.fillStatus === 'warning' ? 'yellow' : 'blue';
}

function InventoryLevelList({ items }) {
  if (!items.length) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'rgba(0,229,160,0.05)', border: '1px solid rgba(0,229,160,0.15)', borderRadius: 6, color: 'rgba(160,180,210,0.6)', fontSize: 12 }}>
      <span style={{ fontSize: 20 }}>✅</span>
      <span>当前地图油品库存水位正常。颜色规则：绿色 ≥ 50%，黄色 30%-50%，红色 ＜ 30%。</span>
    </div>
  );
  return items.map((item, i) => (
    <div key={`${item.shopKey}-${item.resourceKey}-${i}`} className={`alert-item ${inventoryItemClass(item)} handled`}>
      <div className="alert-item-icon">{item.fillStatus === 'critical' ? '🔴' : '🟡'}</div>
      <div className="alert-item-body">
        <div className="alert-title">{item.stationName} · {item.resourceName}</div>
        <div className="alert-desc">
          当前库存：<b>{formatLiters(item.inventory, 2)} L</b>
          {item.capacity ? <> / 容量 <b>{formatLiters(item.capacity, 0)} L</b>，水位 <b>{Number(item.fillPercent || 0).toFixed(1)}%</b></> : '，容量未配置'}
        </div>
      </div>
      <div className="alert-item-right">
        <span className={`retail-tag ${item.fillStatus === 'critical' ? 'tag-red' : 'tag-yellow'}`}>
          {item.fillStatus === 'critical' ? '低于30%' : '低于50%'}
        </span>
      </div>
    </div>
  ));
}

export default function AlertPage() {
  const navigate = useNavigate();
  const [statuses, setStatuses] = useState({ closed: [], attention: [] });
  const [inventoryWan, setInventoryWan] = useState('--');
  const [cardPct, setCardPct] = useState(null);
  const [regionAdvice, setRegionAdvice] = useState('');
  const [stationAdvice, setStationAdvice] = useState('');
  const [trendAnomalyCount, setTrendAnomalyCount] = useState(0);
  const [trendAnomalyDays, setTrendAnomalyDays] = useState([]);
  const [inventoryLevels, setInventoryLevels] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getStationStatuses();
        const items = data.items || [];
        setStatuses({
          closed: items.filter(i => i.status !== 'normal' && i.affectsSales),
          attention: items.filter(i => i.status !== 'normal' && !i.affectsSales),
        });
      } catch (e) { console.warn('站点状态加载失败', e); }

      try {
        const data = await getKpi();
        const summary = data.summary || {};
        setInventoryWan(((summary.inventory || 0) / 1e4).toFixed(2));
        // Calculate card payment percentage
        if (summary.totalSales > 0) {
          setCardPct(((summary.cardSales / summary.totalSales) * 100).toFixed(1));
        }
      } catch (e) { console.warn('库存数据加载失败', e); }

      try {
        const details = await getStationMapDetails();
        const rows = [];
        (details.items || []).forEach((station) => {
          (station.inventoryByResource || []).forEach((resource) => {
            if (resource.fillStatus === 'critical' || resource.fillStatus === 'warning') {
              rows.push({
                shopKey: station.shopKey,
                stationName: station.name || station.short || `站点${station.shopKey}`,
                resourceKey: resource.resourceKey,
                resourceName: resource.name,
                inventory: resource.inventory,
                capacity: resource.capacity,
                fillPercent: resource.fillPercent,
                fillStatus: resource.fillStatus,
              });
            }
          });
        });
        rows.sort((a, b) => Number(a.fillPercent || 999) - Number(b.fillPercent || 999));
        setInventoryLevels(rows);
      } catch (e) { console.warn('库存水位加载失败', e); }

      // Build region advice from dashboard data
      try {
        const yearList = await getYears();
        if (yearList.length > 0) {
          const dashData = await getDashboardYearly(yearList[0]);
          const stations = dashData.stations || [];
          const regionVol = {};
          REGION_ORDER.forEach(r => { regionVol[r] = 0; });
          stations.forEach(s => { if (regionVol[s.region] !== undefined) regionVol[s.region] += (s.amount || 0); });
          const totalAmt = Object.values(regionVol).reduce((a, b) => a + b, 0);
          if (totalAmt > 0) {
            const sorted = REGION_ORDER.map(r => ({ name: r, amt: regionVol[r], pct: ((regionVol[r] / totalAmt) * 100).toFixed(1) })).sort((a, b) => b.amt - a.amt);
            const top = sorted[0];
            const singleStationRegions = REGION_ORDER.filter(r => stations.filter(s => s.region === r).length <= 1);
            const singleNote = singleStationRegions.length > 0 ? `，${singleStationRegions.join('、')}各仅 1 站` : '';
            if (parseFloat(top.pct) >= 30) {
              setRegionAdvice(`${top.name}销售金额占比 ${top.pct}%${singleNote}，集中度较高。建议评估扩站可行性以分散风险，同时加强对${top.name}核心站点的运营保障。`);
            }
          }
        }
      } catch (e) { console.warn('区域建议加载失败', e); }

      // Build station advice from closed stations
      try {
        const statusData = await getStationStatuses();
        const closedItems = (statusData.items || []).filter(i => i.status !== 'normal' && i.affectsSales);
        if (closedItems.length > 0) {
          const details = closedItems.map(i => {
            const resume = i.expectedResumeAt ? `（预计${i.expectedResumeAt.slice(0, 10)}恢复）` : '';
            return `${i.name}${resume}`;
          }).join('、');
          setStationAdvice(`${details}共 ${closedItems.length} 站停业；建议制定复工时间表，装修站点恢复后可预计带来额外销售增量。`);
        }
      } catch (e) { console.warn('站点建议加载失败', e); }

      // Trend anomaly detection using daily data
      try {
        const dailyData = await getDaily(ym);
        const days = dailyData.daily || [];
        const anomalies = [];
        for (let i = 2; i < days.length; i++) {
          const d1 = days[i - 2].volume;
          const d2 = days[i - 1].volume;
          const d3 = days[i].volume;
          if (d1 > 0 && d2 > 0 && d3 > 0) {
            const drop1 = (d1 - d2) / d1;
            const drop2 = (d2 - d3) / d2;
            if (drop1 > 0.3 && drop2 > 0.3) {
              anomalies.push({ date: days[i].date.slice(5, 10), drop1: (drop1 * 100).toFixed(0), drop2: (drop2 * 100).toFixed(0), vol3: d3 });
            }
          }
        }
        setTrendAnomalyCount(anomalies.length);
        setTrendAnomalyDays(anomalies);
      } catch (e) { console.warn('趋势异常检测失败', e); }
    })();
  }, []);

  return (
    <div className="retail-page-wrap" style={{ overflow: 'auto' }}>
      <div className="retail-alert-grid">
        {/* 统计卡 */}
        <div className="alert-stat-card red" onClick={() => document.getElementById('sec-closed')?.scrollIntoView({ behavior: 'smooth' })}>
          <div className="alert-icon">🔴</div>
          <div className="alert-stat-info">
            <div className="alert-stat-num red">{statuses.closed.length}</div>
            <div className="alert-stat-label">停业站点（不含油库）</div>
          </div>
        </div>
        <div className="alert-stat-card yellow" onClick={() => document.getElementById('sec-repair')?.scrollIntoView({ behavior: 'smooth' })}>
          <div className="alert-icon">🟡</div>
          <div className="alert-stat-info">
            <div className="alert-stat-num yellow">{statuses.attention.length}</div>
            <div className="alert-stat-label">即将装修 / 预计开业</div>
          </div>
        </div>
        <div className="alert-stat-card blue">
          <div className="alert-icon">{trendAnomalyCount > 0 ? '🔴' : '🔵'}</div>
          <div className="alert-stat-info">
            <div className={`alert-stat-num ${trendAnomalyCount > 0 ? 'red' : 'blue'}`}>{trendAnomalyCount}</div>
            <div className="alert-stat-label">趋势异常</div>
          </div>
        </div>

        {/* 停业预警 */}
        <div className="alert-section" id="sec-closed">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" style={{ background: '#ef5350', boxShadow: '0 0 6px rgba(239,83,80,0.5)' }} /><span>🔴 停业站点 <span style={{ marginLeft: 6, fontSize: 11, color: 'rgba(160,180,210,0.4)' }}>（当前 {statuses.closed.length} 站影响营业，{statuses.attention.length} 站需关注）</span></span></div>
            <div style={{ padding: 12 }}>
              <StatusList items={statuses.closed} navigate={navigate} emptyText="当前无后台标记的停业或影响营业站点。" />
            </div>
          </div>
        </div>

        {/* 即将装修 */}
        <div className="alert-section" id="sec-repair">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" style={{ background: '#ffa726', boxShadow: '0 0 6px rgba(255,167,38,0.5)' }} /><span>🟡 即将装修 / 预计开业</span></div>
            <div style={{ padding: 12 }}>
              <StatusList items={statuses.attention} navigate={navigate} emptyText="当前无后台标记的待关注站点。" />
            </div>
          </div>
        </div>

        {/* 库存预警 */}
        <div className="alert-section">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" style={{ background: '#ffa726', boxShadow: '0 0 6px rgba(255,167,38,0.5)' }} /><span>🟡 库存预警</span></div>
            <div style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'rgba(0,229,160,0.05)', border: '1px solid rgba(0,229,160,0.15)', borderRadius: 6, color: 'rgba(160,180,210,0.6)', fontSize: 12 }}>
                <span style={{ fontSize: 20 }}>✅</span>
                <span>各站点期末库存合计 <b style={{ color: '#00e5a0' }}>{inventoryWan}万升</b>。油品库存水位按容量百分比着色：绿色 ≥ 50%，黄色 30%-50%，红色 ＜ 30%。</span>
              </div>
              <div className="inventory-alert-scroll">
                <InventoryLevelList items={inventoryLevels} />
              </div>
            </div>
          </div>
        </div>

        {/* 趋势预警 */}
        <div className="alert-section">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" style={{ background: trendAnomalyCount > 0 ? '#ef5350' : '#00d4ff', boxShadow: trendAnomalyCount > 0 ? '0 0 6px rgba(239,83,80,0.5)' : '0 0 6px rgba(0,212,255,0.5)' }} /><span>{trendAnomalyCount > 0 ? '🔴' : '🔵'} 趋势异常</span></div>
            <div style={{ padding: 12 }}>
              {trendAnomalyCount > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'rgba(239,83,80,0.08)', border: '1px solid rgba(239,83,80,0.25)', borderRadius: 6, color: 'rgba(200,220,240,0.8)', fontSize: 12 }}>
                    <span style={{ fontSize: 20 }}>🔴</span>
                    <span>检测到 <b style={{ color: '#ef5350' }}>{trendAnomalyCount} 次</b>连续销量骤降异常（环比下降 &gt; 30% 且持续 ≥ 2天）：</span>
                  </div>
                  {trendAnomalyDays.map((a, i) => (
                    <div key={i} className="alert-item red handled">
                      <div className="alert-item-icon">📉</div>
                      <div className="alert-item-body">
                        <div className="alert-title">{a.date} 前后</div>
                        <div className="alert-desc">前日→昨日：下降 <b style={{ color: '#ef5350' }}>{a.drop1}%</b>，昨日→今日：下降 <b style={{ color: '#ef5350' }}>{a.drop2}%</b>，当日销量：<b>{a.vol3?.toFixed(2)} 升</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 6, color: 'rgba(160,180,210,0.6)', fontSize: 12 }}>
                  <span style={{ fontSize: 20 }}>📈</span>
                  <span>当前无明显销量骤降异常。所有活跃站点销量趋势在正常波动范围内。<br />趋势预警触发条件：单日销量环比下降超过 <b style={{ color: '#00d4ff' }}>30%</b> 且持续 2天 以上时自动提示。</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 运营建议 */}
        <div className="alert-section">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" /><span>💡 运营建议</span></div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="alert-item blue">
                <div className="alert-item-icon">💳</div>
                <div className="alert-item-body">
                  <div className="alert-title">电子支付推广</div>
                  <div className="alert-desc">
                    {cardPct != null
                      ? <>全网现金支付占比 <b style={{ color: '#ffa726' }}>{(100 - parseFloat(cardPct)).toFixed(1)}%</b>，刷卡仅 {cardPct}%。建议重点在高流量站推广 POS 机使用，提升刷卡率，降低现金管理风险。</>
                      : '建议重点在高流量站推广 POS 机使用，提升刷卡率，降低现金管理风险。'}
                  </div>
                </div>
              </div>
              <div className="alert-item blue">
                <div className="alert-item-icon">🗺️</div>
                <div className="alert-item-body">
                  <div className="alert-title">区域布局集中度</div>
                  <div className="alert-desc">{regionAdvice || '建议评估扩站可行性以分散风险，同时加强对核心站点的运营保障。'}</div>
                </div>
              </div>
              <div className="alert-item blue">
                <div className="alert-item-icon">🏗️</div>
                <div className="alert-item-body">
                  <div className="alert-title">停业站点恢复跟进</div>
                  <div className="alert-desc">{stationAdvice || '建议制定复工时间表，装修站点恢复后可预计带来额外销售增量。'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 预警规则 */}
        <div className="alert-section">
          <div className="retail-panel" style={{ padding: 0 }}>
            <div className="retail-panel-header"><div className="dot" /><span>⚙️ 预警规则配置</span></div>
            <div style={{ padding: 12 }}>
              <div className="rule-item"><span className="rule-icon">🔴</span><span><b>停业预警</b>：月度销售额为 0 → 自动标记为停业站点</span></div>
              <div className="rule-item"><span className="rule-icon">🟡</span><span><b>库存预警</b>：油品库存水位 ＜ 50% 显示黄色，＜ 30% 显示红色</span></div>
              <div className="rule-item"><span className="rule-icon">🔵</span><span><b>趋势预警</b>：单日销量环比下降 ＞ 30% 且持续 ≥ 2天 → 触发趋势异常</span></div>
              <div className="rule-item"><span className="rule-icon">📊</span><span><b>集中度预警</b>：单区域销售占比 ＞ 50% → 触发区域集中度提醒</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
