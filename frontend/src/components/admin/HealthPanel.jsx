// src/components/admin/HealthPanel.jsx — 系统健康
import { useState, useEffect, useCallback } from 'react';
import { fmtDate, taskLabel, taskStatusLabel, summarizeTask, healthSize } from '../../utils/admin-helpers';
import { getSystemHealth, refreshCache, restartService } from '../../api/admin';

const healthMark = (ok) => ok ? <span className="status-pill ok">正常</span> : <span className="status-pill warn">关注</span>;

export default function HealthPanel() {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try { setData(await getSystemHealth()); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleRefreshCache = async () => { try { await refreshCache(); await load(); } catch {} };
  const handleRestart = async () => { if (!confirm('确认重启生产服务？')) return; try { const d = await restartService(); alert(d.message || '已提交重启请求'); } catch (err) { alert(err.message); } };

  if (!data) return <section className="admin-tab active"><p className="muted">加载中...</p></section>;

  const latestTask = (data.automation || [])[0] || {};
  const taskWarnings = (data.tasks || []).filter(i => i.warning).length;
  const snapshotState = (data.snapshots?.dailyActualCount || 0) >= (data.snapshots?.dailyExpectedCount || 0);
  const profitSnapshots = data.snapshots?.profitSnapshots || {};
  const profitSnapshotItems = profitSnapshots.items || [];
  const profitSnapshotState = profitSnapshots.ok ? 'ok' : 'warn';
  const exchangeState = data.latestExchange?.date ? 'ok' : 'warn';
  const marketState = data.latestMarket?.observedAt ? 'ok' : 'warn';

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>系统健康</h2><span>集中查看服务、安全、快照、自动任务与日志状态</span></div>
      <section className="content-grid health-section-grid">
        <section className="panel panel-wide">
          <div className="panel-head"><h2>运行状态</h2><div className="inline-actions"><button type="button" onClick={load}>刷新</button><button type="button" onClick={handleRefreshCache}>刷新缓存</button><button type="button" onClick={handleRestart}>重启服务</button></div></div>
          <div className="admin-summary">
            <div><span>整体状态</span><strong>{data.ok ? '正常' : '需关注'}</strong></div>
            <div><span>历史快照</span><strong>{data.snapshots?.actualCount}/{data.snapshots?.expectedCount}</strong></div>
            <div><span>安全密钥</span><strong>{data.security?.runtimeSecret ? '已生成' : '未生成'}</strong></div>
            <div><span>更新时间</span><strong>{data.generatedAt || '--'}</strong></div>
          </div>
        </section>
        <section className="panel panel-wide health-ops-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, padding: 12 }}>
          <div className={`ops-card ${exchangeState}`}>
            <span>今日汇率</span>
            <strong>{data.latestExchange?.date || '--'}</strong>
            <small>{data.latestExchange?.source || 'NBKR'} · {fmtDate(data.latestExchange?.fetchedAt)}</small>
          </div>
          <div className={`ops-card ${marketState}`}>
            <span>市场观察</span>
            <strong>{data.latestMarket?.observedAt || '--'}</strong>
            <small>{data.latestMarket?.title || '--'}</small>
          </div>
          <div className={`ops-card ${snapshotState ? 'ok' : 'warn'}`}>
            <span>零售快照</span>
            <strong>{data.snapshots?.dailyActualCount || 0}/{data.snapshots?.dailyExpectedCount || 0}</strong>
            <small>最后数据日 {data.snapshots?.reportWorkbook?.lastNonemptyDay || '--'}</small>
          </div>
          <div className={`ops-card ${profitSnapshotState}`}>
            <span>利润快照</span>
            <strong>{profitSnapshots.ok ? '已生成' : `${profitSnapshots.missing?.length || 0} 项缺失`}</strong>
            <small>{profitSnapshots.month || '--'} · {profitSnapshotItems.map(item => item.generatedAt).filter(Boolean)[0] || '--'}</small>
          </div>
          <div className={`ops-card ${taskWarnings ? 'warn' : 'ok'}`}>
            <span>任务状态</span>
            <strong>{taskWarnings ? `${taskWarnings} 项受限` : '计划任务可读'}</strong>
            <small>最近执行：{taskLabel(latestTask.taskName)} · {fmtDate(latestTask.finishedAt)}</small>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>核心检查</h2><span>服务与数据库</span></div>
          <div className="stack-list">{(data.checks || []).map((item, i) => <div key={i} className="stack-row"><span>{item.name}</span><strong>{healthMark(item.ok)}</strong><small>{item.elapsedMs == null ? '--' : `${item.elapsedMs} ms`}</small></div>)}</div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>快照状态</h2><span>报表与当月缓存</span></div>
          <div className="stack-list">
            <div className="stack-row"><span>报表辅助快照</span><strong>{healthMark(!data.snapshots?.missing?.length)}</strong><small>缺失：{data.snapshots?.missing?.join('、') || '无'}</small></div>
            <div className="stack-row"><span>缓存刷新</span><strong>{healthMark(data.cacheRefresh?.status !== 'failed')}</strong><small>{data.cacheRefresh?.message || '--'}</small></div>
            <div className="stack-row"><span>最近月度日销表</span><strong>{healthMark(data.snapshots?.reportWorkbook?.exists)}</strong><small>{data.snapshots?.reportWorkbook?.exists ? `${data.snapshots.reportWorkbook.month} · ${data.snapshots.reportWorkbook.lastNonemptyDay || '--'} · ${(data.snapshots.reportWorkbook.size / 1024).toFixed(0)}KB` : '无'}</small></div>
            <div className="stack-row"><span>利润核算快照</span><strong>{healthMark(!!profitSnapshots.ok)}</strong><small>{profitSnapshots.missing?.length ? `缺失：${profitSnapshots.missing.join('、')}` : `${profitSnapshots.month || '--'} · 已生成`}</small></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>自动任务</h2></div>
          <div className="stack-list">{(data.tasks || []).map((item, i) => <div key={i} className="stack-row"><span>{item.taskName}</span><strong>{healthMark(item.ok && !item.warning)}</strong><small>{item.status || '--'}</small></div>)}</div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>安全配置</h2></div>
          <div className="stack-list">
            <div className="stack-row"><span>运行密钥</span><strong>{healthMark(data.security?.runtimeSecret)}</strong></div>
            <div className="stack-row"><span>Cookie HttpOnly</span><strong>{healthMark(data.security?.cookieHttpOnly)}</strong></div>
            <div className="stack-row"><span>SameSite</span><strong>{healthMark(data.security?.sameSite)}</strong></div>
            <div className="stack-row"><span>HTTPS Cookie Secure</span><strong>{healthMark(data.security?.cookieSecure)}</strong></div>
            <div className="stack-row"><span>最新汇率</span><strong>{healthMark(!!data.latestExchange?.date)}</strong><small>{data.latestExchange?.date || '--'}</small></div>
            <div className="stack-row"><span>市场观察</span><strong>{healthMark(!!data.latestMarket?.observedAt)}</strong><small>{data.latestMarket?.observedAt || '--'}</small></div>
          </div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>最近自动任务</h2></div>
          <div className="stack-list review-scroll">{(data.automation || []).map((item, i) => <div key={i} className="stack-row"><span>{taskLabel(item.taskName)}</span><strong>{taskStatusLabel(item.status)}</strong><small>{fmtDate(item.finishedAt)} · {summarizeTask(item)}</small></div>)}</div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>日志状态</h2></div>
          <div className="stack-list">{(data.logs || []).map((item, i) => <div key={i} className="stack-row"><span>{item.name}</span><strong>{healthMark(item.exists && !item.hasTraceback)}</strong><small>{item.exists ? `${healthSize(item.size)} · ${item.updatedAt || '--'}` : '日志不存在'}</small></div>)}</div>
        </section>
      </section>
    </section>
  );
}
