# Electron Desktop Client Implementation Plan

> **For agentic workers:** Tasks use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold and build the Electron desktop client connecting to Flask v2 API

**Architecture:** Vite + React 18 + TypeScript SPA wrapped in Electron, using Ant Design 5 for UI, HashRouter for routing, react-i18next for bilingual support, and Axios with JWT interceptor for API calls

**Tech Stack:** Node 22, Vite 6, React 18, TypeScript 5, Ant Design 5, React Router 6 (HashRouter), react-i18next, Axios, electron 33, electron-builder

## Global Constraints

- All UI strings must support zh/ru via react-i18next JSON dictionaries
- Use HashRouter only (no BrowserRouter)
- Ant Design 5 as the sole UI component library
- Axios with request/response interceptors for JWT auth
- No Redux or external state management — useContext + useState only
- Electron main process: no nodeIntegration, contextIsolation: true
- ESLint config minimal (no custom rules beyond Vite defaults)

---

### Task 1: Project Scaffold + Dependencies

**Files:**
- Create: `SalesDesktop/package.json`
- Create: `SalesDesktop/vite.config.ts`
- Create: `SalesDesktop/tsconfig.json`
- Create: `SalesDesktop/tsconfig.node.json`
- Create: `SalesDesktop/index.html`
- Create: `SalesDesktop/electron-builder.yml`

- [ ] **Step 1: Initialize and install deps**

```bash
cd D:\SalesVisualization\SalesDesktop
npm init -y

# Vite + React + TS
npm install --save-dev vite @vitejs/plugin-react typescript @types/react @types/react-dom

# React + Router + i18n
npm install react react-dom react-router-dom@6 i18next react-i18next

# Ant Design
npm install antd @ant-design/icons

# HTTP
npm install axios

# Electron
npm install --save-dev electron electron-builder concurrently wait-on

# Types
npm install --save-dev @types/node
```

- [ ] **Step 2: Write vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true
  },
  "include": ["vite.config.ts", "electron"]
}
```

- [ ] **Step 5: Write index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>销售管理系统</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write electron-builder.yml**

```yaml
appId: com.sales.desktop
productName: 销售管理系统
directories:
  output: release
files:
  - dist/**/*
  - electron/**/*
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 7: Add scripts to package.json**

Edit `package.json` scripts section:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "electron:dev": "concurrently \"vite\" \"wait-on http://localhost:5173 && electron .\"",
  "electron:build": "npm run build && electron-builder"
}
```

Also update `main` to `"main": "electron/main.ts"` and add `"type": "module"`.

---

### Task 2: Electron Main Process

**Files:**
- Create: `SalesDesktop/electron/main.ts`
- Create: `SalesDesktop/electron/preload.ts`

- [ ] **Step 1: Write electron/main.ts**

```typescript
import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
```

- [ ] **Step 2: Write electron/preload.ts**

```typescript
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
```

- [ ] **Step 3: Add type declaration**

Create `src/types/global.d.ts`:
```typescript
export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
    };
  }
}
```

---

### Task 3: Entry Point + i18n + API Client

**Files:**
- Create: `SalesDesktop/src/main.tsx`
- Create: `SalesDesktop/src/App.tsx`
- Create: `SalesDesktop/src/vite-env.d.ts`
- Create: `SalesDesktop/src/i18n/index.ts`
- Create: `SalesDesktop/src/i18n/zh.json`
- Create: `SalesDesktop/src/i18n/ru.json`
- Create: `SalesDesktop/src/api/client.ts`

- [ ] **Step 1: Write vite-env.d.ts, i18n dictionaries, and API client**

**src/vite-env.d.ts:**
```typescript
/// <reference types="vite/client" />
```

**src/i18n/zh.json:**
```json
{
  "app": { "title": "销售管理系统" },
  "nav": {
    "dashboard": "仪表板",
    "weighing": "称重审核",
    "trainEntry": "火车录入",
    "wholesale": "批发查询",
    "procurement": "采购查询",
    "contracts": "合同管理",
    "materials": "物资调拨",
    "transferLoss": "外运损耗",
    "users": "用户管理",
    "logout": "退出登录"
  },
  "login": {
    "title": "登录",
    "username": "用户名",
    "password": "密码",
    "submit": "登录",
    "error": "用户名或密码错误"
  },
  "common": {
    "loading": "加载中...",
    "error": "出错了",
    "retry": "重试",
    "save": "保存",
    "cancel": "取消",
    "confirm": "确认",
    "delete": "删除",
    "edit": "编辑",
    "search": "搜索",
    "reset": "重置",
    "export": "导出"
  }
}
```

**src/i18n/ru.json:**
```json
{
  "app": { "title": "Система управления продажами" },
  "nav": {
    "dashboard": "Панель",
    "weighing": "Взвешивание",
    "trainEntry": "Ж/д въезд",
    "wholesale": "Опт",
    "procurement": "Закупки",
    "contracts": "Договоры",
    "materials": "Материалы",
    "transferLoss": "Потери",
    "users": "Пользователи",
    "logout": "Выход"
  },
  "login": {
    "title": "Вход",
    "username": "Имя пользователя",
    "password": "Пароль",
    "submit": "Войти",
    "error": "Неверное имя или пароль"
  },
  "common": {
    "loading": "Загрузка...",
    "error": "CTY-05ибка",
    "retry": "Повторить",
    "save": "Сохранить",
    "cancel": "Отмена",
    "confirm": "Подтвердить",
    "delete": "Удалить",
    "edit": "Изменить",
    "search": "Поиск",
    "reset": "Сброс",
    "export": "Экспорт"
  }
}
```

**src/i18n/index.ts:**
```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh.json';
import ru from './ru.json';

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, ru: { translation: ru } },
  lng: localStorage.getItem('lang') || 'zh',
  fallbackLng: 'zh',
  interpolation: { escapeValue: false },
});

export default i18n;
```

**src/api/client.ts:**
```typescript
import axios from 'axios';

const client = axios.create({
  baseURL: 'http://127.0.0.1:8900/api/v2',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('accessToken');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  }
);

export default client;
```

---

### Task 4: Auth Context + Login Page

**Files:**
- Create: `SalesDesktop/src/contexts/AuthContext.tsx`
- Create: `SalesDesktop/src/pages/Login.tsx`
- Create: `SalesDesktop/src/components/AuthRoute.tsx`
- Modify: `SalesDesktop/src/App.tsx`

- [ ] **Step 1: Write AuthContext**

```typescript
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import client from '@/api/client';

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setLoading(false); return; }
    client.get('/auth/me').then((res) => {
      setUser(res.data.data);
    }).catch(() => {
      localStorage.removeItem('accessToken');
    }).finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await client.post('/auth/login', { username, password });
    const { accessToken, user: userData } = res.data.data;
    localStorage.setItem('accessToken', accessToken);
    setUser(userData);
  };

  const logout = () => {
    client.post('/auth/logout').catch(() => {});
    localStorage.removeItem('accessToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

- [ ] **Step 2: Write Login page**

```typescript
import { useState } from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';

const { Title } = Typography;

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      window.location.hash = '#/';
    } catch {
      message.error(t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
      <Card style={{ width: 400 }}>
        <Title level={3} style={{ textAlign: 'center' }}>{t('login.title')}</Title>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item name="username" rules={[{ required: true }]}>
            <Input prefix={<UserOutlined />} placeholder={t('login.username')} />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder={t('login.password')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Write AuthRoute**

```typescript
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'block', margin: '200px auto' }} />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Update App.tsx**

```typescript
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, theme } from 'antd';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AuthRoute from '@/components/AuthRoute';
import AppLayout from '@/layouts/AppLayout';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import WeighingList from '@/pages/WeighingList';
import TrainEntry from '@/pages/TrainEntry';
import Wholesale from '@/pages/Wholesale';
import Procurement from '@/pages/Procurement';
import Contracts from '@/pages/Contracts';
import Materials from '@/pages/Materials';
import TransferLoss from '@/pages/TransferLoss';
import Users from '@/pages/Users';
import './i18n';

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<AuthRoute><AppLayout /></AuthRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="weighing" element={<WeighingList />} />
        <Route path="train-entry" element={<TrainEntry />} />
        <Route path="wholesale" element={<Wholesale />} />
        <Route path="procurement" element={<Procurement />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="materials" element={<Materials />} />
        <Route path="transfer-loss" element={<TransferLoss />} />
        <Route path="users" element={<Users />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <HashRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HashRouter>
    </ConfigProvider>
  );
}
```

---

### Task 5: App Layout (Sidebar + Header)

**Files:**
- Create: `SalesDesktop/src/layouts/AppLayout.tsx`
- Modify: `SalesDesktop/src/i18n/zh.json` (add lang switch keys)
- Modify: `SalesDesktop/src/i18n/ru.json`

- [ ] **Step 1: Write AppLayout**

```typescript
import { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Typography } from 'antd';
import {
  DashboardOutlined, AuditOutlined, TrainOutlined, ShoppingOutlined,
  ImportOutlined, FileTextOutlined, ToolOutlined, DashOutlined, TeamOutlined,
  LogoutOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, labelKey: 'dashboard' },
  { key: '/weighing', icon: <AuditOutlined />, labelKey: 'weighing' },
  { key: '/train-entry', icon: <TrainOutlined />, labelKey: 'trainEntry' },
  { key: '/wholesale', icon: <ShoppingOutlined />, labelKey: 'wholesale' },
  { key: '/procurement', icon: <ImportOutlined />, labelKey: 'procurement' },
  { key: '/contracts', icon: <FileTextOutlined />, labelKey: 'contracts' },
  { key: '/materials', icon: <ToolOutlined />, labelKey: 'materials' },
  { key: '/transfer-loss', icon: <DashOutlined />, labelKey: 'transferLoss' },
  { key: '/users', icon: <TeamOutlined />, labelKey: 'users' },
];

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [langLabel, setLangLabel] = useState(i18n.language === 'ru' ? 'Русский' : '中文');

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
    setLangLabel(lang === 'ru' ? 'Русский' : '中文');
  };

  const onMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            {collapsed ? '⛽' : t('app.title')}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems.map(item => ({ ...item, label: t(`nav.${item.labelKey}`) }))}
          onClick={onMenuClick}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16 }}>
          <Dropdown menu={{ items: [
            { key: 'zh', label: '中文', onClick: () => switchLang('zh') },
            { key: 'ru', label: 'Русский', onClick: () => switchLang('ru') },
          ]}}>
            <Button icon={<GlobalOutlined />}>{langLabel}</Button>
          </Dropdown>
          <Text>{user?.username}</Text>
          <Button icon={<LogoutOutlined />} onClick={logout}>{t('nav.logout')}</Button>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
```

- [ ] **Step 2: Add lang keys to i18n dictionaries**

Add to both zh.json and ru.json nav section:
- `langSwitch`: Not needed (handled by inline button text)

---

### Task 6: Dashboard Page

**Files:**
- Create: `SalesDesktop/src/pages/Dashboard.tsx`
- Create: `SalesDesktop/src/api/dashboard.ts`

- [ ] **Step 1: Write dashboard API**

```typescript
import client from './client';

export interface DashboardData {
  totalWeighingCount: number;
  todayWeighingCount: number;
  pendingVerifyCount: number;
  monthlyTotalNetWeight: number;
}

export async function getDashboardOverview(): Promise<DashboardData> {
  const res = await client.get('/dashboard/overview');
  return res.data.data;
}
```

- [ ] **Step 2: Write Dashboard page**

```typescript
import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Spin, Alert } from 'antd';
import { AuditOutlined, CarOutlined, CheckCircleOutlined, WeightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getDashboardOverview, DashboardData } from '@/api/dashboard';

export default function Dashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getDashboardOverview().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;
  if (!data) return null;

  return (
    <Row gutter={16}>
      <Col span={6}>
        <Card><Statistic title="称重总数" value={data.totalWeighingCount} prefix={<CarOutlined />} /></Card>
      </Col>
      <Col span={6}>
        <Card><Statistic title="今日称重" value={data.todayWeighingCount} prefix={<AuditOutlined />} /></Card>
      </Col>
      <Col span={6}>
        <Card><Statistic title="待审核" value={data.pendingVerifyCount} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#faad14' }} /></Card>
      </Col>
      <Col span={6}>
        <Card><Statistic title="月累计净重(吨)" value={data.monthlyTotalNetWeight} precision={1} prefix={<WeightOutlined />} /></Card>
      </Col>
    </Row>
  );
}
```

---

### Task 7: Weighing List Page

**Files:**
- Create: `SalesDesktop/src/pages/WeighingList.tsx`
- Create: `SalesDesktop/src/api/weighing.ts`

- [ ] **Step 1: Write weighing API**

```typescript
import client from './client';

export interface WeighingItem {
  source: string;
  id: string;
  weighSerialNo: string;
  businessDate: string;
  vehicleNo: string;
  senderName: string;
  receiverName: string;
  rawProductName: string;
  grossWeight: number | null;
  tareWeight: number | null;
  netWeight: number;
  classification: string;
  status: string;
  remark: string;
}

export interface WeighingListParams {
  date_from: string;
  date_to: string;
  vehicle_no?: string;
  status?: string;
  classification?: string;
  source?: string;
  page?: number;
  page_size?: number;
}

export async function getWeighingList(params: WeighingListParams) {
  const res = await client.get('/weighing/list', { params });
  return res.data;
}

export async function verifyWeighing(data: {
  weighing_source: string;
  weighing_id: number;
  field_name: string;
  old_value: string;
  new_value: string;
  operator_id: number;
  remark?: string;
}) {
  const res = await client.post('/weighing/verify', data);
  return res.data;
}
```

- [ ] **Step 2: Write WeighingList page**

```typescript
import { useEffect, useState } from 'react';
import { Table, Card, DatePicker, Input, Select, Button, Space, Tag } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getWeighingList, WeighingItem } from '@/api/weighing';

const { RangePicker } = DatePicker;

const classificationColors: Record<string, string> = {
  export_wholesale: 'blue',
  external_transport: 'green',
  procurement: 'orange',
  toll_processing: 'purple',
  unknown: 'default',
};

const classificationLabels: Record<string, string> = {
  export_wholesale: '批发外运',
  external_transport: '内部调运',
  procurement: '采购入库',
  toll_processing: '来料加工',
  unknown: '未分类',
};

export default function WeighingList() {
  const { t } = useTranslation();
  const [data, setData] = useState<WeighingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [vehicleNo, setVehicleNo] = useState('');
  const [dates, setDates] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getWeighingList({
        date_from: dates[0].format('YYYY-MM-DD'),
        date_to: dates[1].format('YYYY-MM-DD'),
        vehicle_no: vehicleNo || undefined,
        page,
        page_size: 50,
      });
      setData(res.data.items);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page]);

  const columns = [
    { title: '编号', dataIndex: 'weighSerialNo', key: 'weighSerialNo', width: 130 },
    { title: '日期', dataIndex: 'businessDate', key: 'businessDate', width: 100 },
    { title: '车号', dataIndex: 'vehicleNo', key: 'vehicleNo', width: 120 },
    { title: '发货单位', dataIndex: 'senderName', key: 'senderName', ellipsis: true },
    { title: '收货单位', dataIndex: 'receiverName', key: 'receiverName', ellipsis: true },
    { title: '货名', dataIndex: 'rawProductName', key: 'rawProductName', width: 150 },
    { title: '毛重', dataIndex: 'grossWeight', key: 'grossWeight', width: 90 },
    { title: '皮重', dataIndex: 'tareWeight', key: 'tareWeight', width: 90 },
    { title: '净重', dataIndex: 'netWeight', key: 'netWeight', width: 90 },
    {
      title: '分类', dataIndex: 'classification', key: 'classification', width: 100,
      render: (v: string) => <Tag color={classificationColors[v]}>{classificationLabels[v] || v}</Tag>,
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, width: 150 },
  ];

  return (
    <Card
      title="称重列表"
      extra={
        <Space>
          <RangePicker value={dates} onChange={(v) => v && setDates(v)} />
          <Input placeholder="车号" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} style={{ width: 120 }} />
          <Button icon={<SearchOutlined />} type="primary" onClick={fetchData}>{t('common.search')}</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>{t('common.reset')}</Button>
        </Space>
      }
    >
      <Table
        dataSource={data}
        columns={columns}
        rowKey={(r) => `${r.source}-${r.id}`}
        loading={loading}
        pagination={{ current: page, total, pageSize: 50, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 1400 }}
        size="small"
      />
    </Card>
  );
}
```

---

### Task 8: Skeleton Pages for Remaining Routes

**Files:**
- Create: `SalesDesktop/src/pages/TrainEntry.tsx`
- Create: `SalesDesktop/src/pages/Wholesale.tsx`
- Create: `SalesDesktop/src/pages/Procurement.tsx`
- Create: `SalesDesktop/src/pages/Contracts.tsx`
- Create: `SalesDesktop/src/pages/Materials.tsx`
- Create: `SalesDesktop/src/pages/TransferLoss.tsx`
- Create: `SalesDesktop/src/pages/Users.tsx`

- [ ] **Step 1: Write skeleton pages**

Each file follows the same pattern:
```typescript
import { Card, Typography } from 'antd';

export default function PageName() {
  return (
    <Card title="Page Title">
      <Typography.Text>开发中...</Typography.Text>
    </Card>
  );
}
```

With localized title using useTranslation.

- [ ] **Step 2: Verify build**

```bash
cd D:\SalesVisualization\SalesDesktop
npx tsc --noEmit
```

---

### Task 9: Verify End-to-End

- [ ] **Step 1: Build the project**

```bash
cd D:\SalesVisualization\SalesDesktop
npm run build
```

- [ ] **Step 2: Quick check**

Verify `dist/` directory contains `index.html` and bundled JS/CSS.

- [ ] **Step 3: Start Electron dev mode (optional)**

```bash
cd D:\SalesVisualization\SalesDesktop
npm run electron:dev
```
