import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('正在检查系统状态...');
  const [disabled, setDisabled] = useState(true);
  const { login, user, hasUsers, loading, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';

  // 已登录用户直接跳转
  useEffect(() => {
    if (!loading && user) {
      refreshAuth()
        .then((latestUser) => {
          const currentUser = latestUser || user;
          if (currentUser.mustChangePassword) {
            navigate('/change-password', { replace: true });
            return;
          }
          const dest = currentUser.role === 'admin' ? (nextUrl || '/admin') : (nextUrl === '/admin' ? '/' : nextUrl);
          navigate(dest, { replace: true });
        })
        .catch(() => navigate('/login', { replace: true }));
    }
  }, [loading, user, navigate, nextUrl, refreshAuth]);

  // 检查是否有可用账号
  useEffect(() => {
    if (!loading) {
      if (!hasUsers) {
        setStatus('系统尚未创建管理员，请联系维护人员在后台数据库中初始化账号。');
        setDisabled(true);
      } else {
        setStatus('请输入账号和密码。');
        setDisabled(false);
      }
    }
  }, [loading, hasUsers]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('正在登录...');
    try {
      const loggedIn = await login(username.trim(), password);
      if (loggedIn.mustChangePassword) {
        navigate('/change-password', { replace: true });
        return;
      }
      const dest = loggedIn.role === 'admin' ? (nextUrl || '/admin') : (nextUrl === '/admin' ? '/' : nextUrl);
      navigate(dest, { replace: true });
    } catch (err) {
      setStatus(err.message);
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
              <h2>系统登录</h2>
              <span>账号登录</span>
            </div>
            <form className="form-grid single-form" onSubmit={handleSubmit}>
              <label>
                用户账号
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" disabled={disabled}>登录</button>
            </form>
            <p className="form-status muted">{status}</p>
          </section>
        </section>
      </main>
    </div>
  );
}
