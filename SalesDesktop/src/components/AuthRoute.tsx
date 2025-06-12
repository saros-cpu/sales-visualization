import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'block', margin: '200px auto' }} />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
