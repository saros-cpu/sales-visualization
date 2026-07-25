import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClockCircleOutlined, LogoutOutlined, MinusCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { App as AntApp, Button, ConfigProvider, Modal, Space, Spin, Typography } from 'antd';
import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import AuthRoute from '@/components/AuthRoute';
import AppLayout from '@/layouts/AppLayout';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import Login from '@/pages/Login';
import ForceChangePassword from '@/pages/ForceChangePassword';
import './i18n';

function isDynamicImportError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || error || '');
  return [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
    'ERR_NETWORK_CHANGED',
    'ChunkLoadError',
  ].some((item) => message.includes(item));
}

function lazyWithRetry<T extends { default: ComponentType<any> }>(loader: () => Promise<T>) {
  return lazy(() => {
    const load = (attemptsLeft: number): Promise<T> =>
      loader().catch((error) => {
        if (!isDynamicImportError(error) || attemptsLeft <= 0) {
          throw error;
        }
        return new Promise<T>((resolve, reject) => {
          window.setTimeout(() => {
            load(attemptsLeft - 1).then(resolve, reject);
          }, 600);
        });
      });
    return load(2);
  });
}

const VisualCockpit = lazyWithRetry(() => import('@/pages/VisualCockpit'));
const RetailLayout = lazyWithRetry(() => import('@/layouts/RetailLayout'));
const RetailOverview = lazyWithRetry(() => import('@/pages/retail/Overview'));
const RetailRegion = lazyWithRetry(() => import('@/pages/retail/Region'));
const RetailStation = lazyWithRetry(() => import('@/pages/retail/Station'));
const RetailMonthly = lazyWithRetry(() => import('@/pages/retail/Monthly'));
const RetailResource = lazyWithRetry(() => import('@/pages/retail/Resource'));
const RetailReport = lazyWithRetry(() => import('@/pages/retail/Report'));
const RetailAlert = lazyWithRetry(() => import('@/pages/retail/Alert'));
const RetailSelfUse = lazyWithRetry(() => import('@/pages/retail/SelfUse'));
const RetailProfit = lazyWithRetry(() => import('@/pages/retail/ProfitView'));
const WholesaleLayout = lazyWithRetry(() => import('@/layouts/WholesaleLayout'));
const WholesaleOverview = lazyWithRetry(() => import('@/pages/wholesale/Overview'));
const WholesaleProducts = lazyWithRetry(() => import('@/pages/wholesale/Products'));
const WholesaleCustomers = lazyWithRetry(() => import('@/pages/wholesale/Customers'));
const WholesaleTransfer = lazyWithRetry(() => import('@/pages/wholesale/Transfer'));
const WholesaleTrend = lazyWithRetry(() => import('@/pages/wholesale/Trend'));
const WholesaleQuery = lazyWithRetry(() => import('@/pages/wholesale/Query'));
const WeighingList = lazyWithRetry(() => import('@/pages/WeighingList'));
const TrainEntry = lazyWithRetry(() => import('@/pages/TrainEntry'));
const Procurement = lazyWithRetry(() => import('@/pages/Procurement'));
const Contracts = lazyWithRetry(() => import('@/pages/Contracts/ContractView'));
const ContractAdd = lazyWithRetry(() => import('@/pages/Contracts/ContractAdd'));
const Materials = lazyWithRetry(() => import('@/pages/Materials'));
const Users = lazyWithRetry(() => import('@/pages/Users'));
const OrganizationPermissions = lazyWithRetry(() => import('@/pages/OrganizationPermissions'));
const Settings = lazyWithRetry(() => import('@/pages/Settings'));
const MapPage = lazyWithRetry(() => import('@/pages/MapPage'));
const ExchangeRates = lazyWithRetry(() => import('@/pages/ExchangeRates'));
const ReportsCenter = lazyWithRetry(() => import('@/pages/ReportsCenter'));
const KnowledgeBase = lazyWithRetry(() => import('@/pages/KnowledgeBase'));
const Aliases = lazyWithRetry(() => import('@/pages/Aliases'));
const AuditLogs = lazyWithRetry(() => import('@/pages/AuditLogs'));
const SystemHealth = lazyWithRetry(() => import('@/pages/SystemHealth'));
const ManagementCenter = lazyWithRetry(() => import('@/pages/ManagementCenter'));
const ProfitCostItems = lazyWithRetry(() => import('@/pages/ProfitCostItems'));

const loading = (
  <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
);

function AppCloseGuard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<AppCloseAction | null>(null);

  useEffect(() => {
    const showCloseConfirm = () => {
      setPendingAction(null);
      setOpen(true);
    };
    const cleanup = window.electronAPI?.onAppCloseRequested?.(showCloseConfirm);
    window.addEventListener('sales-app-close-requested', showCloseConfirm);
    return () => {
      cleanup?.();
      window.removeEventListener('sales-app-close-requested', showCloseConfirm);
    };
  }, []);

  const resolveClose = async (action: AppCloseAction) => {
    if (pendingAction) return;
    if (action === 'cancel') {
      setOpen(false);
      await window.electronAPI?.resolveAppClose?.('cancel');
      return;
    }

    setPendingAction(action);
    try {
      await window.electronAPI?.resolveAppClose?.(action);
      if (action !== 'quit') setOpen(false);
    } finally {
      if (action !== 'quit') setPendingAction(null);
    }
  };

  return (
    <Modal
      title={t('appClose.title')}
      open={open}
      centered
      width={460}
      destroyOnHidden
      maskClosable={!pendingAction}
      keyboard={!pendingAction}
      onCancel={() => resolveClose('cancel')}
      footer={(
        <Space wrap>
          <Button
            icon={<MinusCircleOutlined />}
            loading={pendingAction === 'minimize'}
            disabled={pendingAction === 'quit'}
            onClick={() => resolveClose('minimize')}
          >
            {t('appClose.minimize')}
          </Button>
          <Button
            danger
            type="primary"
            icon={<LogoutOutlined />}
            loading={pendingAction === 'quit'}
            disabled={pendingAction === 'minimize'}
            onClick={() => resolveClose('quit')}
          >
            {t('appClose.quit')}
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {t('appClose.prompt')}
      </Typography.Paragraph>
      <Typography.Text type="secondary">
        {t('appClose.hint')}
      </Typography.Text>
    </Modal>
  );
}

function AppUpdateInstallGuard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<UpdateInstallInfo>({});
  const [pendingAction, setPendingAction] = useState<UpdateInstallAction | null>(null);

  useEffect(() => {
    const cleanup = window.updater?.onInstallPrompt?.((nextInfo) => {
      setInfo(nextInfo || {});
      setPendingAction(null);
      setOpen(true);
    });
    return () => cleanup?.();
  }, []);

  const resolveInstall = async (action: UpdateInstallAction) => {
    if (pendingAction) return;
    if (action === 'later') {
      setOpen(false);
      await window.updater?.resolveInstallPrompt?.('later');
      return;
    }

    setPendingAction(action);
    try {
      await window.updater?.resolveInstallPrompt?.(action);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Modal
      title={t('updateInstall.title')}
      open={open}
      centered
      width={460}
      destroyOnHidden
      maskClosable={!pendingAction}
      keyboard={!pendingAction}
      onCancel={() => resolveInstall('later')}
      footer={(
        <Space wrap>
          <Button
            icon={<ClockCircleOutlined />}
            disabled={pendingAction === 'restart'}
            onClick={() => resolveInstall('later')}
          >
            {t('updateInstall.later')}
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={pendingAction === 'restart'}
            onClick={() => resolveInstall('restart')}
          >
            {t('updateInstall.restart')}
          </Button>
        </Space>
      )}
    >
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        {t('updateInstall.message', { version: info.version || '' })}
      </Typography.Paragraph>
      <Typography.Text type="secondary">
        {t('updateInstall.hint')}
      </Typography.Text>
    </Modal>
  );
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace /> : <Login />} />
      <Route path="/change-password" element={<AuthRoute><ForceChangePassword /></AuthRoute>} />
      <Route path="/" element={<AuthRoute><AppLayout /></AuthRoute>}>
        <Route index element={<ErrorBoundary><Suspense fallback={loading}><VisualCockpit /></Suspense></ErrorBoundary>} />
        <Route path="cockpit" element={<Navigate to="/" replace />} />
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
          <Route path="profit" element={<ErrorBoundary><Suspense fallback={loading}><RetailProfit /></Suspense></ErrorBoundary>} />
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
        <Route path="reports" element={<ErrorBoundary><Suspense fallback={loading}><ReportsCenter /></Suspense></ErrorBoundary>} />
        <Route path="knowledge" element={<ErrorBoundary><Suspense fallback={loading}><KnowledgeBase /></Suspense></ErrorBoundary>} />
        <Route path="train-entry" element={<ErrorBoundary><Suspense fallback={loading}><TrainEntry /></Suspense></ErrorBoundary>} />
        <Route path="procurement" element={<ErrorBoundary><Suspense fallback={loading}><Procurement /></Suspense></ErrorBoundary>} />
        <Route path="contracts">
          <Route index element={<Navigate to="/contracts/view" replace />} />
          <Route path="view" element={<ErrorBoundary><Suspense fallback={loading}><Contracts /></Suspense></ErrorBoundary>} />
          <Route path="add" element={<ErrorBoundary><Suspense fallback={loading}><ContractAdd /></Suspense></ErrorBoundary>} />
        </Route>
        <Route path="materials" element={<ErrorBoundary><Suspense fallback={loading}><Materials /></Suspense></ErrorBoundary>} />
        <Route path="transfer-loss" element={<Navigate to="/wholesale/overview" replace />} />
        <Route path="map" element={<ErrorBoundary><Suspense fallback={loading}><MapPage /></Suspense></ErrorBoundary>} />
        <Route path="users" element={<ErrorBoundary><Suspense fallback={loading}><Users /></Suspense></ErrorBoundary>} />
        <Route path="users/roles" element={<Navigate to="/users/organization" replace />} />
        <Route path="users/organization" element={<ErrorBoundary><Suspense fallback={loading}><OrganizationPermissions /></Suspense></ErrorBoundary>} />
        <Route path="aliases" element={<ErrorBoundary><Suspense fallback={loading}><Aliases /></Suspense></ErrorBoundary>} />
        <Route path="weighing" element={<ErrorBoundary><Suspense fallback={loading}><WeighingList /></Suspense></ErrorBoundary>} />
        <Route path="audit-logs" element={<ErrorBoundary><Suspense fallback={loading}><AuditLogs /></Suspense></ErrorBoundary>} />
        <Route path="system-health" element={<ErrorBoundary><Suspense fallback={loading}><SystemHealth /></Suspense></ErrorBoundary>} />
        <Route path="management-center" element={<ErrorBoundary><Suspense fallback={loading}><ManagementCenter /></Suspense></ErrorBoundary>} />
        <Route path="profit-cost-items" element={<ErrorBoundary><Suspense fallback={loading}><ProfitCostItems /></Suspense></ErrorBoundary>} />
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
      <AntApp>
        <HashRouter>
          <AuthProvider>
            <AppCloseGuard />
            <AppUpdateInstallGuard />
            <AppRoutes />
          </AuthProvider>
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  );
}
