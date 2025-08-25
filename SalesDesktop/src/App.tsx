import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AuthRoute from '@/components/AuthRoute';
import AppLayout from '@/layouts/AppLayout';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import Login from '@/pages/Login';
import './i18n';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const RetailLayout = lazy(() => import('@/layouts/RetailLayout'));
const RetailOverview = lazy(() => import('@/pages/retail/Overview'));
const RetailRegion = lazy(() => import('@/pages/retail/Region'));
const RetailStation = lazy(() => import('@/pages/retail/Station'));
const RetailMonthly = lazy(() => import('@/pages/retail/Monthly'));
const RetailResource = lazy(() => import('@/pages/retail/Resource'));
const RetailReport = lazy(() => import('@/pages/retail/Report'));
const RetailAlert = lazy(() => import('@/pages/retail/Alert'));
const RetailSelfUse = lazy(() => import('@/pages/retail/SelfUse'));
const WholesaleLayout = lazy(() => import('@/layouts/WholesaleLayout'));
const WholesaleOverview = lazy(() => import('@/pages/wholesale/Overview'));
const WholesaleProducts = lazy(() => import('@/pages/wholesale/Products'));
const WholesaleCustomers = lazy(() => import('@/pages/wholesale/Customers'));
const WholesaleTransfer = lazy(() => import('@/pages/wholesale/Transfer'));
const WholesaleTrend = lazy(() => import('@/pages/wholesale/Trend'));
const WholesaleQuery = lazy(() => import('@/pages/wholesale/Query'));
const WeighingList = lazy(() => import('@/pages/WeighingList'));
const TrainEntry = lazy(() => import('@/pages/TrainEntry'));
const Procurement = lazy(() => import('@/pages/Procurement'));
const Contracts = lazy(() => import('@/pages/Contracts/ContractView'));
const ContractAdd = lazy(() => import('@/pages/Contracts/ContractAdd'));
const Materials = lazy(() => import('@/pages/Materials'));
const TransferLoss = lazy(() => import('@/pages/TransferLoss'));
const Users = lazy(() => import('@/pages/Users'));
const OrganizationPermissions = lazy(() => import('@/pages/OrganizationPermissions'));
const Settings = lazy(() => import('@/pages/Settings'));
const MapPage = lazy(() => import('@/pages/MapPage'));
const ExchangeRates = lazy(() => import('@/pages/ExchangeRates'));
const Aliases = lazy(() => import('@/pages/Aliases'));
const AuditLogs = lazy(() => import('@/pages/AuditLogs'));
const SystemHealth = lazy(() => import('@/pages/SystemHealth'));

const loading = (
  <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
);

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<AuthRoute><AppLayout /></AuthRoute>}>
        <Route index element={<ErrorBoundary><Suspense fallback={loading}><Dashboard /></Suspense></ErrorBoundary>} />
        <Route path="retail" element={<ErrorBoundary><Suspense fallback={loading}><RetailLayout /></Suspense></ErrorBoundary>}>
          <Route index element={<Navigate to="/retail/overview" replace />} />
          <Route path="overview" element={<ErrorBoundary><Suspense fallback={loading}><RetailOverview /></Suspense></ErrorBoundary>} />
          <Route path="region" element={<ErrorBoundary><Suspense fallback={loading}><RetailRegion /></Suspense></ErrorBoundary>} />
          <Route path="station" element={<ErrorBoundary><Suspense fallback={loading}><RetailStation /></Suspense></ErrorBoundary>} />
          <Route path="monthly" element={<ErrorBoundary><Suspense fallback={loading}><RetailMonthly /></Suspense></ErrorBoundary>} />
          <Route path="resource" element={<ErrorBoundary><Suspense fallback={loading}><RetailResource /></Suspense></ErrorBoundary>} />
          <Route path="report" element={<ErrorBoundary><Suspense fallback={loading}><RetailReport /></Suspense></ErrorBoundary>} />
          <Route path="alert" element={<ErrorBoundary><Suspense fallback={loading}><RetailAlert /></Suspense></ErrorBoundary>} />
          <Route path="self-use" element={<ErrorBoundary><Suspense fallback={loading}><RetailSelfUse /></Suspense></ErrorBoundary>} />
        </Route>
        <Route path="wholesale" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleLayout /></Suspense></ErrorBoundary>}>
          <Route index element={<Navigate to="/wholesale/overview" replace />} />
          <Route path="overview" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleOverview /></Suspense></ErrorBoundary>} />
          <Route path="products" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleProducts /></Suspense></ErrorBoundary>} />
          <Route path="customers" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleCustomers /></Suspense></ErrorBoundary>} />
          <Route path="transfer" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleTransfer /></Suspense></ErrorBoundary>} />
          <Route path="trend" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleTrend /></Suspense></ErrorBoundary>} />
          <Route path="query" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleQuery /></Suspense></ErrorBoundary>} />
        </Route>
        <Route path="exchange" element={<ErrorBoundary><Suspense fallback={loading}><ExchangeRates /></Suspense></ErrorBoundary>} />
        <Route path="train-entry" element={<ErrorBoundary><Suspense fallback={loading}><TrainEntry /></Suspense></ErrorBoundary>} />
        <Route path="procurement" element={<ErrorBoundary><Suspense fallback={loading}><Procurement /></Suspense></ErrorBoundary>} />
        <Route path="contracts">
          <Route index element={<Navigate to="/contracts/view" replace />} />
          <Route path="view" element={<ErrorBoundary><Suspense fallback={loading}><Contracts /></Suspense></ErrorBoundary>} />
          <Route path="add" element={<ErrorBoundary><Suspense fallback={loading}><ContractAdd /></Suspense></ErrorBoundary>} />
        </Route>
        <Route path="materials" element={<ErrorBoundary><Suspense fallback={loading}><Materials /></Suspense></ErrorBoundary>} />
        <Route path="transfer-loss" element={<ErrorBoundary><Suspense fallback={loading}><TransferLoss /></Suspense></ErrorBoundary>} />
        <Route path="map" element={<ErrorBoundary><Suspense fallback={loading}><MapPage /></Suspense></ErrorBoundary>} />
        <Route path="users" element={<ErrorBoundary><Suspense fallback={loading}><Users /></Suspense></ErrorBoundary>} />
        <Route path="users/roles" element={<Navigate to="/users/organization" replace />} />
        <Route path="users/organization" element={<ErrorBoundary><Suspense fallback={loading}><OrganizationPermissions /></Suspense></ErrorBoundary>} />
        <Route path="aliases" element={<ErrorBoundary><Suspense fallback={loading}><Aliases /></Suspense></ErrorBoundary>} />
        <Route path="weighing" element={<ErrorBoundary><Suspense fallback={loading}><WeighingList /></Suspense></ErrorBoundary>} />
        <Route path="audit-logs" element={<ErrorBoundary><Suspense fallback={loading}><AuditLogs /></Suspense></ErrorBoundary>} />
        <Route path="system-health" element={<ErrorBoundary><Suspense fallback={loading}><SystemHealth /></Suspense></ErrorBoundary>} />
        <Route path="settings" element={<ErrorBoundary><Suspense fallback={loading}><Settings /></Suspense></ErrorBoundary>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#CC0000',
        colorBgLayout: '#f0f2f5',
        colorBgContainer: '#fff',
        colorBgElevated: '#fff',
        colorText: '#1a1a1a',
        colorTextSecondary: '#5a5a5a',
        colorTextTertiary: '#909090',
        colorBorder: '#d9d9d9',
        colorBorderSecondary: '#e8e8e8',
        borderRadius: 6,
      },
      components: {
        Layout: {
          siderBg: '#fff',
          headerBg: '#fff',
          bodyBg: '#f0f2f5',
          triggerBg: '#fff',
        },
        Menu: {
          itemBg: '#fff',
          itemColor: '#1a1a1a',
          itemSelectedBg: '#fff1f0',
          itemSelectedColor: '#CC0000',
          itemHoverBg: '#fafafa',
          itemBorderRadius: 6,
        },
        Card: { colorBgContainer: '#fff' },
        Table: {
          colorBgContainer: '#fff',
          headerBg: '#fafafa',
          headerColor: '#1a1a1a',
          rowHoverBg: '#f5f5f5',
          borderColor: '#f0f0f0',
        },
        Button: {
          defaultBg: '#fff',
          defaultColor: '#1a1a1a',
          defaultBorderColor: '#d9d9d9',
          defaultHoverBg: '#f5f5f5',
        },
        Input: {
          colorBgContainer: '#fff',
          colorText: '#1a1a1a',
          colorBorder: '#d9d9d9',
          activeBorderColor: '#CC0000',
          hoverBorderColor: '#CC0000',
        },
        Select: {
          colorBgContainer: '#fff',
          colorText: '#1a1a1a',
          colorBorder: '#d9d9d9',
          optionSelectedBg: '#fff1f0',
          optionActiveBg: '#fafafa',
        },
        Modal: { colorBgContainer: '#fff', colorBgElevated: '#fff', headerBg: '#fff' },
        Descriptions: { colorBgContainer: '#fff', labelBg: '#fafafa' },
        DatePicker: { colorBgContainer: '#fff', colorText: '#1a1a1a', colorBorder: '#d9d9d9' },
        Dropdown: { colorBgElevated: '#fff' },
        Progress: { defaultColor: '#CC0000' },
      },
    }}>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HashRouter>
    </ConfigProvider>
  );
}
