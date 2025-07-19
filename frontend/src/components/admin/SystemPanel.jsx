// src/components/admin/SystemPanel.jsx — 系统管理（用户 + 操作日志）
import { useState, useEffect } from 'react';
import { getUsers, createUser, getOperationLogs } from '../../api/admin';
import { fmtDate } from '../../utils/admin-helpers';

export default function SystemPanel({ refreshKey, setStatusText }) {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [formStatus, setFormStatus] = useState('');

  // 加载用户和日志
  useEffect(() => {
    getUsers()
      .then(d => setUsers(d.items || []))
      .catch(() => {});
    getOperationLogs()
      .then(d => setLogs(d.items || []))
      .catch(() => {});
  }, [refreshKey]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      username: fd.get('username'),
      displayName: fd.get('displayName'),
      password: fd.get('password'),
      role: fd.get('role'),
    };
    setFormStatus('正在添加...');
    try {
      await createUser(payload);
      form.reset();
      setFormStatus('用户已添加');
      setStatusText('用户已添加');
      // 刷新列表
      const [u, l] = await Promise.all([getUsers(), getOperationLogs()]);
      setUsers(u.items || []);
      setLogs(l.items || []);
    } catch (err) {
      setFormStatus(err.message);
    }
  };

  return (
    <section className="admin-tab active">
      <div className="section-title"><h2>系统管理</h2><span>用户与操作日志管理</span></div>
      <div className="admin-users-grid">
      {/* 新增用户表单 */}
      <section className="panel admin-form-panel">
        <div className="panel-head"><h2>新增用户</h2><span>管理员维护</span></div>
        <form onSubmit={handleSubmit} className="form-grid single-form">
          <label>用户名<input name="username" required /></label>
          <label>显示名称<input name="displayName" /></label>
          <label>密码<input name="password" type="password" required /></label>
          <label>
            角色
            <select name="role" defaultValue="user">
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </label>
          <button type="submit">添加用户</button>
        </form>
        {formStatus && <p className="form-status muted">{formStatus}</p>}
      </section>

      {/* 用户列表 */}
      <section className="panel admin-table-panel user-list-panel">
        <div className="panel-head"><h2>用户列表</h2><span>当前系统账号（{users.length}）</span></div>
        <div className="table-wrap user-list-scroll">
          <table>
            <thead>
              <tr><th>ID</th><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>创建时间</th><th>最近登录</th></tr>
            </thead>
            <tbody>
              {users.map(item => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.username}</td>
                  <td>{item.displayName}</td>
                  <td>{item.role === 'admin' ? '管理员' : '普通用户'}</td>
                  <td>{item.isActive ? '启用' : '停用'}</td>
                  <td>{fmtDate(item.createdAt)}</td>
                  <td>{fmtDate(item.lastLoginAt)}</td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7}>暂无用户</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* 操作日志 */}
      <section className="panel panel-wide">
        <div className="panel-head"><h2>操作日志</h2><span>最近 {logs.length} 条</span></div>
        <div className="table-wrap review-scroll">
          <table>
            <thead><tr><th>时间</th><th>用户</th><th>动作</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              {logs.map((item, i) => (
                <tr key={i}>
                  <td>{fmtDate(item.createdAt)}</td>
                  <td>{item.username}</td>
                  <td>{item.action}</td>
                  <td>{item.targetType || '--'} {item.targetId || ''}</td>
                  <td>{item.detail || '--'}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={5}>暂无操作日志</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </section>
  );
}
