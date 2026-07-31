import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import AuthGuard from './components/common/AuthGuard';
import AdminGuard from './components/common/AdminGuard';

const AppLayout = lazy(() => import('./components/layout/AppLayout'));
const RetailLayout = lazy(() => import('./components/layout/RetailLayout'));
const LoginPage = lazy(() => import('./pages/sales/LoginPage'));
const ForceChangePasswordPage = lazy(() => import('./pages/sales/ForceChangePasswordPage'));
const DashboardPage = lazy(() => import('./pages/sales/DashboardPage'));
const WholesalePage = lazy(() => import('./pages/sales/WholesalePage'));
const AdminPage = lazy(() => import('./pages/sales/AdminPage'));
const KnowledgePage = lazy(() => import('./pages/sales/KnowledgePage'));
const RetailDashboard = lazy(() => import('./pages/retail/RetailDashboard'));
const MonthlyPage = lazy(() => import('./pages/retail/MonthlyPage'));
const StationPage = lazy(() => import('./pages/retail/StationPage'));
const RegionPage = lazy(() => import('./pages/retail/RegionPage'));
const ResourcePage = lazy(() => import('./pages/retail/ResourcePage'));
const ReportPage = lazy(() => import('./pages/retail/ReportPage'));
const AlertPage = lazy(() => import('./pages/retail/AlertPage'));
const ProfitPage = lazy(() => import('./pages/retail/ProfitPage'));
const SelfUsePage = lazy(() => import('./pages/retail/SelfUsePage'));

function RouteFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#e5e7eb', background: '#0f172a' }}>
      加载中...
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteFallback />}>
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
            <Route element={<AdminGuard />}>
              <Route path="/retail/profit" element={<ProfitPage />} />
            </Route>
            <Route path="/retail/report" element={<ReportPage />} />
            <Route path="/retail/alert" element={<AlertPage />} />
            <Route path="/retail/self-use" element={<SelfUsePage />} />
          </Route>
        </Route>

        {/* 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
