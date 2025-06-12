import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AuthRoute from '@/components/AuthRoute';
import AppLayout from '@/layouts/AppLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import RetailOverview from '@/pages/retail/Overview';
import StationAnalysis from '@/pages/retail/StationAnalysis';
import ProductAnalysis from '@/pages/retail/ProductAnalysis';
import WeighingList from '@/pages/WeighingList';
import TrainEntry from '@/pages/TrainEntry';
import Wholesale from '@/pages/Wholesale';
import Procurement from '@/pages/Procurement';
import Contracts from '@/pages/Contracts';
import Materials from '@/pages/Materials';
import TransferLoss from '@/pages/TransferLoss';
import Users from '@/pages/Users';
import UserRoles from '@/pages/UserRoles';
import Settings from '@/pages/Settings';
import MapPage from '@/pages/MapPage';
import ExchangeRates from '@/pages/ExchangeRates';
import Aliases from '@/pages/Aliases';
import './i18n';

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<AuthRoute><AppLayout /></AuthRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="retail" element={<RetailOverview />} />
        <Route path="retail/stations" element={<StationAnalysis />} />
        <Route path="retail/products" element={<ProductAnalysis />} />
        <Route path="weighing" element={<WeighingList />} />
        <Route path="train-entry" element={<TrainEntry />} />
        <Route path="wholesale" element={<Wholesale />} />
        <Route path="procurement" element={<Procurement />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="materials" element={<Materials />} />
        <Route path="transfer-loss" element={<TransferLoss />} />
        <Route path="users" element={<Users />} />
        <Route path="users/roles" element={<UserRoles />} />
        <Route path="settings" element={<Settings />} />
        <Route path="exchange" element={<ExchangeRates />} />
        <Route path="aliases" element={<Aliases />} />
        <Route path="map" element={<MapPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ConfigProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HashRouter>
    </ConfigProvider>
  );
}
