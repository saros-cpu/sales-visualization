// src/components/admin/AutomationPanel.jsx — 自动任务
import { useState, useEffect, useCallback } from 'react';
import { fmtDate, taskLabel, taskStatusLabel, summarizeTask, shortText } from '../../utils/admin-helpers';
import { getAutomationTasks, runAutomationTask } from '../../api/admin';
import { num } from '../../utils/format';

export default function AutomationPanel({ refresh, setStatusText }) {
  const [latest, setLatest] = useState([]);
  const [recent, setRecent] = useState([]);
  const [runStatus, setRunStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await getAutomationTasks();
      setLatest(data.latest || []);
      setRecent(data.recent || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRun = async (task) => {
    setRunStatus('正在执行自动任务...');
    try {
      const result = await runAutomationTask(task);
      const retail = result.results?.retailSnapshots;
      setRunStatus(retail?.status === 'queued' ? `${retail.message}，可在系统健康页面查看进度` : '自动任务执行完成');
      await load();
      refresh();
    } catch (err) {
      setRunStatus(err.message);
    }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>自动任务</h2><span>每日自动补齐汇率、市场观察和业务快照</span></div>
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head"><h2>任务计划</h2><span>当前启用</span></div>
          <div className="stack-list">
            <div className="stack-row"><span>07:30</span><strong>自动补汇率</strong><small>NBKR 历史页面</small></div>
            <div className="stack-row"><span>07:30</span><strong>获取市场观察</strong><small>俄罗斯 / 乌兹别克 / 国际</small></div>
            <div className="stack-row"><span>08:30</span><strong>生成零售/自用油/利润快照</strong><small>日快照、当前月汇总和利润总表快照</small></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>立即执行</h2><span>手动运维</span></div>
          <div className="stack-list">
            {['exchange_rates', 'market_watch', 'retail_snapshots', 'all'].map(task => (
              <button key={task} type="button" onClick={() => handleRun(task)}>{taskLabel(task) === '全部任务' ? '执行全部自动任务' : taskLabel(task)}</button>
            ))}
          </div>
          <p className="form-status muted">{runStatus}</p>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>最近状态</h2><span>最新任务结果</span></div>
          <div className="stack-list">
            {latest.length ? latest.map((item, i) => (
              <div key={i} className="stack-row"><span>{taskLabel(item.taskName)}</span><strong>{taskStatusLabel(item.status)}</strong><small>{fmtDate(item.finishedAt)} · {summarizeTask(item)}</small></div>
            )) : <div className="stack-row"><span>暂无自动任务记录</span><strong>待运行</strong><small>任务将在设定时间自动生成记录</small></div>}
          </div>
        </section>
        <section className="panel panel-wide">
          <div className="panel-head"><h2>执行记录</h2><span>最近 40 条</span></div>
          <div className="table-wrap review-scroll">
            <table>
              <thead><tr><th>任务</th><th>状态</th><th>开始</th><th>结束</th><th>结果</th><th>错误</th></tr></thead>
              <tbody>
                {recent.length ? recent.map((item, i) => (
                  <tr key={i}><td>{taskLabel(item.taskName)}</td><td>{taskStatusLabel(item.status)}</td><td>{fmtDate(item.startedAt)}</td><td>{fmtDate(item.finishedAt)}</td><td>{summarizeTask(item)}</td><td title={item.error || ''}>{shortText(item.error, 40) || '--'}</td></tr>
                )) : <tr><td colSpan="6">暂无执行记录</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  );
}
