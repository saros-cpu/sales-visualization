// src/components/admin/OverviewPanel.jsx — 后台概览
import { useState, useEffect } from 'react';
import { fmtDate } from '../../utils/admin-helpers';
import { getOperationLogs } from '../../api/admin';

export default function OverviewPanel() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    getOperationLogs().then(d => setLogs((d.items || []).slice(0, 8))).catch(() => {});
  }, []);

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>后台概览</h2><span>显示当前维护重点和最近操作</span></div>
      <section className="content-grid">
        <section className="panel">
          <div className="panel-head"><h2>维护边界</h2><span>当前规则</span></div>
          <div className="stack-list">
            <div className="stack-row"><span>主页 / 批发 / 零售</span><strong>登录查看</strong><small>普通用户可访问</small></div>
            <div className="stack-row"><span>后台 / 上传 / 修正</span><strong>登录维护</strong><small>管理员</small></div>
            <div className="stack-row"><span>汇率 / 密度 / 字典</span><strong>按日期生效</strong><small>后台维护</small></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>最近操作</h2><span>后台记录</span></div>
          <div className="stack-list review-scroll">
            {logs.length ? logs.map((item, i) => (
              <div key={i} className="stack-row"><span>{item.action}</span><strong>{item.username}</strong><small>{fmtDate(item.createdAt)}</small></div>
            )) : <p className="muted">暂无操作日志</p>}
          </div>
        </section>
      </section>
    </section>
  );
}
