import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function AdminGuard() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen">正在验证权限...</div>;
  }

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
