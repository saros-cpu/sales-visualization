import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import AuthGuard from './components/common/AuthGuard';
import AdminGuard from './components/common/AdminGuard';
import AppLayout from './components/layout/AppLayout';
import RetailLayout from './components/layout/RetailLayout';
import LoginPage from './pages/sales/LoginPage';
import ForceChangePasswordPage from './pages/sales/ForceChangePasswordPage';
import DashboardPage from './pages/sales/DashboardPage';
import WholesalePage from './pages/sales/WholesalePage';
import AdminPage from './pages/sales/AdminPage';
import KnowledgePage from './pages/sales/KnowledgePage';
import RetailDashboard from './pages/retail/RetailDashboard';
import MonthlyPage from './pages/retail/MonthlyPage';
import StationPage from './pages/retail/StationPage';
import RegionPage from './pages/retail/RegionPage';
import ResourcePage from './pages/retail/ResourcePage';
import ReportPage from './pages/retail/ReportPage';
import AlertPage from './pages/retail/AlertPage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* 公开页面 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 需要登录的页面 */}
        <Route element={<AuthGuard />}>
          <Route path="/change-password" element={<ForceChangePasswordPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/wholesale" element={<WholesalePage />} />
            <Route path="/wholesale/:tab" element={<WholesalePage />} />

            {/* 管理员页面 */}
            <Route element={<AdminGuard />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>

          {/* 零售页面 - 暗色主题独立布局 */}
          <Route element={<RetailLayout />}>
            <Route path="/retail" element={<RetailDashboard />} />
            <Route path="/retail/monthly" element={<MonthlyPage />} />
            <Route path="/retail/station" element={<StationPage />} />
            <Route path="/retail/region" element={<RegionPage />} />
            <Route path="/retail/resource" element={<ResourcePage />} />
            <Route path="/retail/report" element={<ReportPage />} />
            <Route path="/retail/alert" element={<AlertPage />} />
          </Route>
        </Route>

        {/* 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
