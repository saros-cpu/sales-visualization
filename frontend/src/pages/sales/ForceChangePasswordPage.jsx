import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword } from '../../api/auth';
import { useAuth } from '../../hooks/useAuth';

export default function ForceChangePasswordPage() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('账号首次使用前，需要先修改初始密码。');
  const [submitting, setSubmitting] = useState(false);
  const { refreshAuth } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    refreshAuth()
      .then((latestUser) => {
        if (cancelled) return;
        if (!latestUser) {
          navigate('/login', { replace: true });
          return;
        }
        if (!latestUser.mustChangePassword) {
          navigate('/', { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => { cancelled = true; };
  }, [navigate, refreshAuth]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setStatus('新密码至少需要 8 位。');
      return;
    }
    if (oldPassword === newPassword) {
      setStatus('新密码不能与旧密码相同。');
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus('两次输入的新密码不一致。');
      return;
    }
    setSubmitting(true);
    setStatus('正在修改密码...');
    try {
      await changePassword(oldPassword, newPassword);
      const latestUser = await refreshAuth();
      navigate(latestUser?.mustChangePassword ? '/change-password' : '/', { replace: true });
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <main className="auth-main">
        <section className="auth-shell">
          <div className="auth-brand">
            <h1>销售板块可视化平台</h1>
          </div>
          <section className="panel auth-panel">
            <div className="panel-head">
              <h2>修改初始密码</h2>
              <span>首次登录</span>
            </div>
            <form className="form-grid single-form" onSubmit={handleSubmit}>
              <label>
                当前密码
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                新密码
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label>
                确认新密码
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button type="submit" disabled={submitting}>{submitting ? '正在修改...' : '修改密码'}</button>
            </form>
            <p className="form-status muted">{status}</p>
          </section>
        </section>
      </main>
    </div>
  );
}
