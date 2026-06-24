# SalesDesktop 3.0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 web 项目的零售、批发功能完整移植到 Electron 桌面客户端，并对客户端架构做全量重构（统一 HTTP 层、React Query 缓存、TS 类型化、共享组件库、路由懒加载、错误边界），版本升 `3.0.0`。

**Architecture:** 单一 Axios 工厂实例取代三个重复实例；`@tanstack/react-query` 统一数据获取与缓存；共享 UI 组件库（ChartCard/KpiCard/PeriodPicker/TableCard/ErrorBoundary）被所有新页面复用；菜单配置外置并支持角色过滤；路由全量 `React.lazy` 懒加载 + 顶层/页面级错误边界。

**Tech Stack:** React 18 + TypeScript 5 + Vite 6 + Ant Design 5 + ECharts 6 + echarts-for-react 3 + @tanstack/react-query 5 + react-data-grid + react-router-dom 6 + i18next 24. Electron 33 壳，目标服务器 `https://sales.example.com`。

## Global Constraints

- 所有 API 基础地址用 `https://sales.example.com`；零售/汇率走 `/api`，其他资源走 `/api/v2`（源自规格 §1.1）
- i18n 仅 zh + ru，所有用户可见文案必须进 `zh.json` + `ru.json`，禁止硬编码中文（源自规格 §3.3/§4.3）
- 版本号规则：MAJOR 用于架构重构/不兼容变更 → 本次升 `3.0.0`（源自 AGENTS.md §15 + 规格 §7.3）
- 每次对客户端代码改动后发包前必须升版本号（同步 `src/version.ts` + `package.json`）（源自 AGENTS.md §15）
- 构建输出目录每次不同以避免 `app.asar` 锁（本次 `release_v18`）（源自 AGENTS.md + 规格 §7.3）
- 不改动后端 Flask 逻辑，仅后端 `train-entry` 表加 `weigh_no` 列为例外（源自规格 §7.5）
- 后端 `train-entry` 表加 `weigh_no` 列由后端负责人另行处理，前端按字段已存在假设编写（源自规格 §5.3）
- 客户/供应商地图坐标后期配，无坐标时不渲染对应标点（源自规格 §6.3/§6.4）

---

## 文件结构

### 新建文件
- `src/api/http.ts` — 统一 Axios 工厂 `createApi(basePath)`
- `src/api/retail.ts` — 零售所有端点（基于 `createApi('/api')`）
- `src/api/wholesale.ts` — 批发端点（基于 `createApi('/api')`）
- `src/api/exchange.ts` — 重写，基于 `createApi('/api')`
- `src/hooks/useApi.ts` — `useApiQuery` / `useApiMutation`
- `src/types/api.ts` — 全部响应/请求接口
- `src/components/ui/ChartCard.tsx`
- `src/components/ui/KpiCard.tsx`
- `src/components/ui/PeriodPicker.tsx`
- `src/components/ui/TableCard.tsx`
- `src/components/ui/ErrorBoundary.tsx`
- `src/config/menu.ts` — 菜单配置（含 `children` + `roles`）
- `src/config/mapRoles.ts` — 角色→可见地图标点类型映射
- `src/layouts/RetailLayout.tsx` — 零售子页面布局（Outlet）
- `src/layouts/WholesaleLayout.tsx` — 批发子页面布局（Outlet）
- `src/pages/retail/Overview.tsx`（重写，无地图）
- `src/pages/retail/Region.tsx`（新，源自 RegionPage）
- `src/pages/retail/Station.tsx`（新，源自 StationPage）
- `src/pages/retail/Monthly.tsx`（新，源自 MonthlyPage）
- `src/pages/retail/Resource.tsx`（新，源自 ResourcePage）
- `src/pages/retail/Report.tsx`（新，源自 ReportPage）
- `src/pages/retail/Alert.tsx`（新，源自 AlertPage）
- `src/pages/wholesale/Overview.tsx`（新）
- `src/pages/wholesale/Products.tsx`（新）
- `src/pages/wholesale/Customers.tsx`（新）
- `src/pages/wholesale/Transfer.tsx`（新）
- `src/pages/wholesale/Trend.tsx`（新）
- `src/pages/wholesale/Review.tsx`（新）
- `src/pages/wholesale/Query.tsx`（新，重导出现有 Wholesale.tsx 内容）
- `src/pages/TrainEntry/TrainEntryPage.tsx`（重写，react-data-grid）
- `src/components/wholesale/BarList.tsx`（源自 web BarList，转 TS+AntD）
- `src/components/wholesale/RankList.tsx`（源自 web RankList，转 TS+AntD）

### 修改文件
- `src/main.tsx` — 挂 `QueryClientProvider`
- `src/App.tsx` — 路由改为 `React.lazy` + 嵌套 `RetailLayout`/`WholesaleLayout`
- `src/layouts/AppLayout.tsx` — 用 `config/menu.ts` + 角色过滤 + 嵌套子菜单
- `src/contexts/AuthContext.tsx` — 暴露 `role`（已存在 `user.role`）
- `src/components/KgzMap.tsx` — 角色过滤标点
- `src/pages/Dashboard.tsx` — KPI 行改用 `Row/Col` + `KpiCard`
- `src/pages/TrainEntry/TrainEntry.tsx`（壳）— 改导 `TrainEntryPage`
- `src/version.ts` — `VERSION = '3.0.0'` + CHANGELOG
- `package.json` — version 3.0.0 + 新增依赖
- `src/i18n/zh.json` + `src/i18n/ru.json` — 新增 `retail` / `wholesale` 命名空间
- `electron-builder.yml` — `output: release_v18`

---

## Task 1: 统一 HTTP 层

**Files:**
- Create: `src/api/http.ts`
- Modify: `src/api/client.ts`（改为 re-export `createApi('/api/v2')` 以兼容现有 import）

**Interfaces:**
- Produces: `createApi(basePath: string): AxiosInstance`；`client`（兼容导出）
- Consumes: 无

- [ ] **Step 1: 创建统一 HTTP 工厂**

```typescript
// src/api/http.ts
import axios, { AxiosInstance, AxiosError } from 'axios';

const API_HOST = 'https://sales.example.com';

export function createApi(basePath: string): AxiosInstance {
  const instance = axios.create({
    baseURL: `${API_HOST}${basePath}`,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      if (err.response?.status === 401) {
        localStorage.removeItem('accessToken');
        if (window.location.hash !== '#/login') window.location.hash = '#/login';
      }
      return Promise.reject(err);
    }
  );

  return instance;
}

export default createApi;
```

- [ ] **Step 2: 让现有 client.ts 复用工厂（保持兼容）**

```typescript
// src/api/client.ts
import { createApi } from './http';

const client = createApi('/api/v2');

export async function changePassword(oldPassword: string, newPassword: string) {
  const res = await client.post('/auth/change-password', { oldPassword, newPassword });
  return res.data;
}

export async function getProductOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get('/aliases/products');
  return (res.data.data || []).map((p: any) => ({ value: p.displayName, label: p.displayName }));
}

export async function getEntityOptions(): Promise<{ value: string; label: string }[]> {
  const res = await client.get('/aliases/entities');
  const items = new Map<string, string>();
  for (const e of res.data.data) {
    items.set(e.standardName, e.standardName);
    for (const a of e.aliases) items.set(a, a);
  }
  return Array.from(items.values()).map((v) => ({ value: v, label: v }));
}

export async function getProductAliasesList() {
  const res = await client.get('/aliases/products/list');
  return res.data.data || [];
}

export async function getEntityAliasesList() {
  const res = await client.get('/aliases/entities/list');
  return res.data.data || [];
}

export async function createProductAlias(productId: number, aliasName: string) {
  const res = await client.post('/aliases/products', { productId, aliasName });
  return res.data;
}

export async function deleteProductAlias(id: number) {
  const res = await client.delete(`/aliases/products/${id}`);
  return res.data;
}

export async function createEntityAlias(entityType: string, entityCode: string, standardName: string, aliasName: string) {
  const res = await client.post('/aliases/entities', { entityType, entityCode, standardName, aliasName });
  return res.data;
}

export async function deleteEntityAlias(id: number) {
  const res = await client.delete(`/aliases/entities/${id}`);
  return res.data;
}

export default client;
```

- [ ] **Step 3: 类型检查确认编译通过**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 无新增报错（现有 import `client` 仍可用）

- [ ] **Step 4: 提交**

```bash
git add src/api/http.ts src/api/client.ts
git commit -m "refactor: 统一 HTTP 层为 createApi 工厂"
```

---

## Task 2: React Query 接入

**Files:**
- Create: 无
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: 全局 `QueryClientProvider` 包裹
- Consumes: `react-query` 包（Task 26 安装，开发期可先 `npm install @tanstack/react-query`）

- [ ] **Step 1: 改写 main.tsx 挂 QueryClientProvider**

```typescript
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/main.tsx
git commit -m "feat: 接入 React Query Provider"
```

---

## Task 3: useApi hooks

**Files:**
- Create: `src/hooks/useApi.ts`

**Interfaces:**
- Produces: `useApiQuery<T>(queryKey, fetcher, options?)`、`useApiMutation<TVars, TData>(mutationFn, options?)`
- Consumes: `@tanstack/react-query`

- [ ] **Step 1: 写 hooks**

```typescript
// src/hooks/useApi.ts
import { useQuery, useMutation, UseQueryOptions, UseMutationOptions } from '@tanstack/react-query';
import { QueryKey } from '@tanstack/react-query';

export function useApiQuery<T>(
  queryKey: QueryKey,
  fetcher: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T, Error>({
    queryKey,
    queryFn: fetcher,
    ...options,
  });
}

export function useApiMutation<TVars, TData = unknown>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>
) {
  return useMutation<TData, Error, TVars>({
    mutationFn,
    ...options,
  });
}
```

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/hooks/useApi.ts
git commit -m "feat: 新增 useApiQuery/useApiMutation hooks"
```

---

## Task 4: TypeScript 类型定义

**Files:**
- Create: `src/types/api.ts`

**Interfaces:**
- Produces: 零售/批发/通用响应接口，供后续所有页面与 api 模块引用
- Consumes: 无

- [ ] **Step 1: 写核心类型**

```typescript
// src/types/api.ts

// ---- 通用 ----
export interface ApiListResult<T> {
  data: T[];
  total?: number;
}
export interface ApiResult<T> {
  data: T;
}

// 注：零售相关类型（MonthlyData / RegionData / StationInfo / ResourceRow / StationStatus 等）
// 已定义在现有 src/api/retail.ts（Dashboard 等现页依赖），本文件不重定义，避免冲突。
// 新零售页面直接从 '@/api/retail' 引入这些接口。

// ---- 批发 ----
export type WholesaleClass =
  | 'export_wholesale'
  | 'local_wholesale'
  | 'unknown'
  | 'transfer'
  | 'processing'
  | 'procurement';

export interface CategoryCard {
  key: WholesaleClass;
  label: string;
  rows: number;
  entities: number;
  tons: number;
  amountCny: number; // 仅 export_wholesale / local_wholesale 有值，其余为 0
}
export interface ProductRanking {
  name: string;
  tons: number;
  amountCny: number; // 仅 export_wholesale / local_wholesale 有值
}
export interface CustomerRanking {
  name: string;
  tons: number;
  amountCny: number; // 仅 export_wholesale / local_wholesale 有值
  matchedRows?: number; // customer 模式
  rows?: number; // pending 模式：记录条数
}
export interface TransferSummary {
  byRegion: { region: string; tons: number }[];
  byProduct: { product: string; tons: number }[];
  byRegionProduct: { region: string; product: string; rows: number; tons: number }[];
}
export interface DailyTrendPoint {
  date: string;
  exportTons: number;
  localTons: number;
  pendingTons: number; // 待审核批发（折线为虚线）
  transferTons: number;
  amountCny: number;
}
export interface WholesaleReview {
  status: { matched: number; needsReview: number };
  topNeedsReview: { customer: string; product: string; rows: number; tons: number }[];
}
export interface WholesalePageData {
  period: { year: number; month?: number };
  cards: CategoryCard[]; // 顺序：export_wholesale → local_wholesale → unknown → transfer → procurement → processing
  productRankings: ProductRanking[];
  customerRankings: CustomerRanking[];
  transferSummary: TransferSummary;
  dailyTrend: DailyTrendPoint[];
  issues: { id: number; type: string; date: string; message: string; severity: string }[]; // type ∈ 合同未匹配/分类不符/缺少价格/缺少汇率
  review?: WholesaleReview; // 保留以便完整映射 /api/wholesale 返回；UI 按用户要求不渲染合同/待审区块（见 Task 19/22）
}

// ---- 数据录入 ----
export interface TrainEntryRecord {
  id?: number;
  entryDate: string;
  productName: string;
  weighNo?: string;
  vehicleNo: string;
  senderName?: string;
  receiverName?: string;
  weightKg?: number;
  remark?: string;
  createdAt?: string;
}

// ---- 地图 ----
export type MapPointType = 'depot' | 'station' | 'customer' | 'supplier';
export interface MapPoint {
  id: string;
  name: string;
  type: MapPointType;
  lat?: number;
  lng?: number;
  inventory?: number;
  price?: number;
}
```

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/types/api.ts
git commit -m "feat: 新增全量 API TypeScript 类型"
```

---

## Task 5: 共享 UI 组件库

**Files:**
- Create: `src/components/ui/ChartCard.tsx`, `KpiCard.tsx`, `PeriodPicker.tsx`, `TableCard.tsx`, `ErrorBoundary.tsx`

**Interfaces:**
- Produces: 上述 5 个组件，供所有页面复用
- Consumes: `antd`, `echarts-for-react`, `dayjs`

- [ ] **Step 1: ChartCard**

```tsx
// src/components/ui/ChartCard.tsx
import { Card, Spin } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface Props {
  title: string;
  option: EChartsOption;
  loading?: boolean;
  height?: number;
}

export default function ChartCard({ title, option, loading, height = 320 }: Props) {
  return (
    <Card title={title} size="small" style={{ marginBottom: 16 }}>
      <Spin spinning={!!loading}>
        <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
      </Spin>
    </Card>
  );
}
```

- [ ] **Step 2: KpiCard**

```tsx
// src/components/ui/KpiCard.tsx
import { Card, Statistic } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

interface Props {
  title: string;
  value: number | string;
  precision?: number;
  prefix?: React.ReactNode;
  suffix?: string;
  delta?: number;
}

export default function KpiCard({ title, value, precision, prefix, suffix, delta }: Props) {
  const color = delta === undefined ? undefined : delta >= 0 ? '#3f8600' : '#cf1322';
  return (
    <Card size="small" style={{ height: 120 }}>
      <Statistic
        title={title}
        value={value}
        precision={precision}
        prefix={prefix}
        suffix={suffix}
        valueStyle={{ color }}
      />
      {delta !== undefined && (
        <span style={{ color, fontSize: 12 }}>
          {delta >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(delta)}%
        </span>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: PeriodPicker**

```tsx
// src/components/ui/PeriodPicker.tsx
import { DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

interface Props {
  value: number | string;
  onChange: (year: number, month?: number) => void;
  picker?: 'year' | 'month';
}

export default function PeriodPicker({ value, onChange, picker = 'year' }: Props) {
  const parsed: Dayjs = picker === 'year'
    ? dayjs(`${value}`, 'YYYY')
    : dayjs(`${value}`, 'YYYY-MM');
  return (
    <DatePicker
      picker={picker}
      value={parsed}
      onChange={(d) => {
        if (!d) return;
        if (picker === 'year') onChange(d.year());
        else onChange(d.year(), d.month() + 1);
      }}
      format={picker === 'year' ? 'YYYY' : 'YYYY-MM'}
    />
  );
}
```

- [ ] **Step 4: TableCard**

```tsx
// src/components/ui/TableCard.tsx
import { Card, Table, Button, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';

interface Props<T> {
  title: string;
  columns: ColumnsType<T>;
  data: T[];
  rowKey: string;
  loading?: boolean;
  onExport?: () => void;
  exportText?: string;
}

export default function TableCard<T extends object>({ title, columns, data, rowKey, loading, onExport, exportText = '导出' }: Props<T>) {
  return (
    <Card
      title={title}
      size="small"
      style={{ marginBottom: 16 }}
      extra={onExport && <Button onClick={onExport}>{exportText}</Button>}
    >
      <Table<T> columns={columns} dataSource={data} rowKey={rowKey} loading={loading} size="small" pagination={{ pageSize: 20 }} scroll={{ x: 'max-content' }} />
    </Card>
  );
}
```

- [ ] **Step 5: ErrorBoundary**

```tsx
// src/components/ui/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';
import { Result, Button } from 'antd';

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面加载出错"
          extra={<Button type="primary" onClick={() => this.setState({ hasError: false })}>重试</Button>}
        />
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 6: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 7: 提交**

```bash
git add src/components/ui/
git commit -m "feat: 新增共享 UI 组件库 (ChartCard/KpiCard/PeriodPicker/TableCard/ErrorBoundary)"
```

---

## Task 6: 顶层错误边界 + 路由懒加载骨架

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: 顶层 `ErrorBoundary` 包裹 + 全部路由 `React.lazy`
- Consumes: `src/components/ui/ErrorBoundary`, 各 layout 组件（Task 9/10 创建）

- [ ] **Step 1: 改写 App.tsx 为懒加载 + 错误边界（路由表留待 Task 9 细化，此处先搭骨架）**

```tsx
// src/App.tsx（部分，完整版见 Task 9）
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Spin } from 'antd';
import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import AuthRoute from '@/components/AuthRoute';
import AppLayout from '@/layouts/AppLayout';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import Login from '@/pages/Login';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const RetailLayout = lazy(() => import('@/layouts/RetailLayout'));
// ... 其他 lazy 在 Task 9 补全

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<AuthRoute><AppLayout /></AuthRoute>}>
        <Route index element={<ErrorBoundary><Suspense fallback={<Spin /><p>}</p>}><Dashboard /></Suspense></ErrorBoundary>} />
      </Route>
    </Routes>
  );
}
// ConfigProvider 主题配置保留原样（见 Task 9）
```

> 注：本 Task 仅确认 `ErrorBoundary` + `Suspense` 包裹机制可用；完整路由表在 Task 9 落地。

- [ ] **Step 2: 编译确认（先注释未创建页面，确保骨架可编译）**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过（仅含已存在页面）

- [ ] **Step 3: 提交**

```bash
git add src/App.tsx
git commit -m "feat: 顶层 ErrorBoundary + 路由 Suspense 骨架"
```

---

## Task 7: 菜单配置外置

**Files:**
- Create: `src/config/menu.ts`
- Create: `src/config/mapRoles.ts`

**Interfaces:**
- Produces: `menuConfig: MenuItem[]`（含 `key`/`icon`/`labelKey`/`children`/`roles`）；`mapRoleVisibleTypes(role): MapPointType[]`
- Consumes: 无

- [ ] **Step 1: menu.ts**

```typescript
// src/config/menu.ts
import {
  DashboardOutlined, ShopOutlined, DollarOutlined, CarOutlined, ShoppingOutlined,
  ImportOutlined, FileTextOutlined, ToolOutlined, DashOutlined, EnvironmentOutlined,
  TeamOutlined, BookOutlined, SettingOutlined, AuditOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface MenuItem {
  key: string;
  icon?: ReactNode;
  labelKey: string;
  children?: MenuItem[];
  roles?: string[];
}

export const menuConfig: MenuItem[] = [
  { key: '/', icon: <DashboardOutlined />, labelKey: 'nav.dashboard' },
  {
    key: '/retail', icon: <ShopOutlined />, labelKey: 'nav.retail',
    children: [
      { key: '/retail/overview', labelKey: 'retail.overview' },
      { key: '/retail/region', labelKey: 'retail.region' },
      { key: '/retail/station', labelKey: 'retail.station' },
      { key: '/retail/monthly', labelKey: 'retail.monthly' },
      { key: '/retail/resource', labelKey: 'retail.resource' },
      { key: '/retail/report', labelKey: 'retail.report' },
      { key: '/retail/alert', labelKey: 'retail.alert' },
    ],
  },
  {
    key: '/wholesale', icon: <ShoppingOutlined />, labelKey: 'nav.wholesale',
    children: [
      { key: '/wholesale/overview', labelKey: 'wholesale.overview' },
      { key: '/wholesale/products', labelKey: 'wholesale.products' },
      { key: '/wholesale/customers', labelKey: 'wholesale.customers' },
      { key: '/wholesale/transfer', labelKey: 'wholesale.transfer' },
      { key: '/wholesale/trend', labelKey: 'wholesale.trend' },
      { key: '/wholesale/review', labelKey: 'wholesale.review' },
      { key: '/wholesale/query', labelKey: 'wholesale.query' },
    ],
  },
  { key: '/exchange', icon: <DollarOutlined />, labelKey: 'nav.exchange' },
  { key: '/train-entry', icon: <CarOutlined />, labelKey: 'nav.dataEntry' },
  { key: '/procurement', icon: <ImportOutlined />, labelKey: 'nav.procurement' },
  { key: '/contracts', icon: <FileTextOutlined />, labelKey: 'nav.contracts' },
  { key: '/materials', icon: <ToolOutlined />, labelKey: 'nav.materials' },
  { key: '/transfer-loss', icon: <DashOutlined />, labelKey: 'nav.transferLoss' },
  { key: '/map', icon: <EnvironmentOutlined />, labelKey: 'nav.map' },
  {
    key: 'management-sub', icon: <TeamOutlined />, labelKey: 'nav.management',
    children: [
      { key: '/users', labelKey: 'common.userList' },
      { key: '/users/roles', labelKey: 'common.rolePermissions' },
      { key: '/aliases', icon: <BookOutlined />, labelKey: 'nav.aliases' },
      { key: '/weighing', icon: <AuditOutlined />, labelKey: 'nav.weighing' },
    ],
  },
  { key: '/settings', icon: <SettingOutlined />, labelKey: 'nav.settings' },
];
```

- [ ] **Step 2: mapRoles.ts**

```typescript
// src/config/mapRoles.ts
import type { MapPointType } from '@/types/api';

const ROLE_MAP: Record<string, MapPointType[]> = {
  admin: ['depot', 'station', 'customer', 'supplier'],
  retail: ['depot', 'station'],
  wholesale: ['depot', 'customer'],
  procurement: ['supplier', 'depot'],
};

export function mapRoleVisibleTypes(role?: string): MapPointType[] {
  if (!role) return ['depot', 'station'];
  return ROLE_MAP[role] ?? ['depot', 'station'];
}
```

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/config/
git commit -m "feat: 菜单配置与地图角色映射外置"
```

---

## Task 8: AppLayout 使用 menuConfig + 角色过滤 + 嵌套子菜单

**Files:**
- Modify: `src/layouts/AppLayout.tsx`

**Interfaces:**
- Consumes: `src/config/menu.ts` 的 `menuConfig` + `MenuItem`
- Consumes: `useAuth().user.role`

- [ ] **Step 1: 重写 AppLayout 渲染逻辑**

将 `menuItems` 数组替换为从 `menuConfig` 递归生成，并做角色过滤。在 `AppLayout.tsx` 顶部 import 后，替换 `const menuItems = [...]` 块为：

```tsx
import { menuConfig, MenuItem } from '@/config/menu';
import { useTranslation } from 'react-i18next';
// ... 其余 import 不变

function filterByRole(items: MenuItem[], role?: string): MenuItem[] {
  return items
    .filter((it) => !it.roles || !role || it.roles.includes(role))
    .map((it) => ({ ...it, children: it.children ? filterByRole(it.children, role) : undefined }))
    .filter((it) => !it.children || it.children.length > 0);
}

function toAntItems(items: MenuItem[], t: (k: string) => string): any[] {
  return items.map((it) => ({
    key: it.key,
    icon: it.icon,
    label: t(it.labelKey),
    children: it.children ? toAntItems(it.children, t) : undefined,
  }));
}
```

并在组件内：

```tsx
const role = user?.role;
const visibleMenu = filterByRole(menuConfig, role);
const menuItems = toAntItems(visibleMenu, (k) => t(k));
```

> `Menu` 的 `onClick` 保持 `navigate(key)`；`selectedKeys` 用 `location.pathname`；子菜单 `type: 'group'` 不需要，Ant Design `children` 自动渲染为可展开子项。

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过；`npm run dev` 后侧边栏显示零售/批发大类且称重在管理下

- [ ] **Step 3: 提交**

```bash
git add src/layouts/AppLayout.tsx
git commit -m "refactor: AppLayout 使用 menuConfig + 角色过滤 + 嵌套子菜单"
```

---

## Task 9: App.tsx 完整路由重构（懒加载 + 嵌套 Layout）

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: 所有页面组件（已存在或 Task 10-22 创建）、`RetailLayout`、`WholesaleLayout`

- [ ] **Step 1: 写完整 App.tsx**

```tsx
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
const WholesaleLayout = lazy(() => import('@/layouts/WholesaleLayout'));
const WholesaleOverview = lazy(() => import('@/pages/wholesale/Overview'));
const WholesaleProducts = lazy(() => import('@/pages/wholesale/Products'));
const WholesaleCustomers = lazy(() => import('@/pages/wholesale/Customers'));
const WholesaleTransfer = lazy(() => import('@/pages/wholesale/Transfer'));
const WholesaleTrend = lazy(() => import('@/pages/wholesale/Trend'));
const WholesaleReview = lazy(() => import('@/pages/wholesale/Review'));
const WholesaleQuery = lazy(() => import('@/pages/wholesale/Query'));
const WeighingList = lazy(() => import('@/pages/WeighingList'));
const TrainEntry = lazy(() => import('@/pages/TrainEntry'));
const Procurement = lazy(() => import('@/pages/Procurement'));
const Contracts = lazy(() => import('@/pages/Contracts'));
const Materials = lazy(() => import('@/pages/Materials'));
const TransferLoss = lazy(() => import('@/pages/TransferLoss'));
const Users = lazy(() => import('@/pages/Users'));
const UserRoles = lazy(() => import('@/pages/UserRoles'));
const Settings = lazy(() => import('@/pages/Settings'));
const MapPage = lazy(() => import('@/pages/MapPage'));
const ExchangeRates = lazy(() => import('@/pages/ExchangeRates'));
const Aliases = lazy(() => import('@/pages/Aliases'));

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
        </Route>
        <Route path="wholesale" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleLayout /></Suspense></ErrorBoundary>}>
          <Route index element={<Navigate to="/wholesale/overview" replace />} />
          <Route path="overview" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleOverview /></Suspense></ErrorBoundary>} />
          <Route path="products" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleProducts /></Suspense></ErrorBoundary>} />
          <Route path="customers" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleCustomers /></Suspense></ErrorBoundary>} />
          <Route path="transfer" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleTransfer /></Suspense></ErrorBoundary>} />
          <Route path="trend" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleTrend /></Suspense></ErrorBoundary>} />
          <Route path="review" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleReview /></Suspense></ErrorBoundary>} />
          <Route path="query" element={<ErrorBoundary><Suspense fallback={loading}><WholesaleQuery /></Suspense></ErrorBoundary>} />
        </Route>
        <Route path="exchange" element={<ErrorBoundary><Suspense fallback={loading}><ExchangeRates /></Suspense></ErrorBoundary>} />
        <Route path="train-entry" element={<ErrorBoundary><Suspense fallback={loading}><TrainEntry /></Suspense></ErrorBoundary>} />
        <Route path="procurement" element={<ErrorBoundary><Suspense fallback={loading}><Procurement /></Suspense></ErrorBoundary>} />
        <Route path="contracts" element={<ErrorBoundary><Suspense fallback={loading}><Contracts /></Suspense></ErrorBoundary>} />
        <Route path="materials" element={<ErrorBoundary><Suspense fallback={loading}><Materials /></Suspense></ErrorBoundary>} />
        <Route path="transfer-loss" element={<ErrorBoundary><Suspense fallback={loading}><TransferLoss /></Suspense></ErrorBoundary>} />
        <Route path="map" element={<ErrorBoundary><Suspense fallback={loading}><MapPage /></Suspense></ErrorBoundary>} />
        <Route path="users" element={<ErrorBoundary><Suspense fallback={loading}><Users /></Suspense></ErrorBoundary>} />
        <Route path="users/roles" element={<ErrorBoundary><Suspense fallback={loading}><UserRoles /></Suspense></ErrorBoundary>} />
        <Route path="aliases" element={<ErrorBoundary><Suspense fallback={loading}><Aliases /></Suspense></ErrorBoundary>} />
        <Route path="weighing" element={<ErrorBoundary><Suspense fallback={loading}><WeighingList /></Suspense></ErrorBoundary>} />
        <Route path="settings" element={<ErrorBoundary><Suspense fallback={loading}><Settings /></Suspense></ErrorBoundary>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ConfigProvider theme={{ /* 保留 Task 6 前原有 theme 配置不变 */ }}>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </HashRouter>
    </ConfigProvider>
  );
}
```

> `ConfigProvider` 的 `theme` 对象保持原 `App.tsx` 中的完整配置不变（见规格上下文）。

- [ ] **Step 2: 创建 RetailLayout / WholesaleLayout（Outlet 占位，待 Task 10/17 补内容）**

```tsx
// src/layouts/RetailLayout.tsx
import { Outlet } from 'react-router-dom';
export default function RetailLayout() { return <Outlet />; }
```

```tsx
// src/layouts/WholesaleLayout.tsx
import { Outlet } from 'react-router-dom';
export default function WholesaleLayout() { return <Outlet />; }
```

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 现有所在路径页面通过；新页面（retail/*、wholesale/*）在 Task 10-22 创建后通过

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx src/layouts/RetailLayout.tsx src/layouts/WholesaleLayout.tsx
git commit -m "refactor: 路由全量懒加载 + 零售/批发嵌套 Layout"
```

---

## Task 10: 零售 API 模块

**Files:**
- Modify: `src/api/retail.ts`（**已存在**，Dashboard 等现页从它导入 `getMonthly`/`getKpiYearly`/`getDashboardYearly`，必须保留现有方法名与返回接口，否则现页编译失败）

**Interfaces:**
- 保留现有导出（方法名与签名不变）：`getYears`, `getMonths`, `getDashboardYearly`, `getMonthly`, `getStations`, `getStationMonthly`, `getRegions`, `getDaily`, `getResourcesYearly`, `getKpi`, `getKpiYearly`
- 新增：`getStationStatuses`（预警页用）、`exportMonthlyExcel`（报表页用）
- 报告下载请用 `src/api/export.ts` 的 `downloadMonthlyReport(ym)` / `downloadYearlyReport(year)`
- 新零售页面统一用现有方法名：月度=`getMonthly`、站点详情=`getStationMonthly`、当前月 KPI=`getKpi`、年度 KPI=`getKpiYearly`、年度概览=`getDashboardYearly`
- Consumes: `createApi('/api')` from `./http`（替换文件内现有 `retailClient`）

- [ ] **Step 1: 改写 retail.ts 顶部实例 + 追加新方法**

将文件顶部 `retailClient` 定义替换为：
```typescript
// src/api/retail.ts（顶部）
import { createApi } from './http';
const api = createApi('/api');
// 以下现有接口定义（StationData / ResourceData / DailyData / MonthlyData / StationMonthlyData / RegionsData / DashboardYearlyData 等）与全部现有方法保持不动，仅把内部 retailClient 调用改为 api
```

在文件末尾追加（沿用现有返回结构，不引入新类型以免冲突）：
```typescript
export async function getStationStatuses() {
  const res = await api.get('/retail/station-statuses');
  return res.data.data?.items ?? res.data;
}
export async function exportMonthlyExcel(ym: string) {
  const res = await api.get(`/export/monthly/${ym}`);
  return res.data.data ?? res.data;
}
```

> 验证：改完后 `grep -rn "from '@/api/retail'" src` 应仍能编译（Dashboard 的 `getMonthly`/`getKpiYearly`/`getDashboardYearly` 签名不变）。

- [ ] **Step 1b: 在 `src/api/export.ts` 末尾新增报告下载辅助（复用已有 `downloadBlob` / `getToken` / `BASE_URL`）**

```typescript
// src/api/export.ts（追加到文件末尾）
export async function downloadMonthlyReport(ym: string) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/monthly/${ym}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

export async function downloadYearlyReport(year: number) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/yearly/${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}
```

- [ ] **Step 2: i18n 新增 retail 命名空间键（zh/ru）**

在 `src/i18n/zh.json` 顶层新增 `"retail"` 对象，至少包含：
```json
"retail": {
  "overview": "总览", "region": "区域", "station": "站点", "monthly": "月度",
  "resource": "油品", "report": "报表", "alert": "预警",
  "year": "年份", "month": "月份", "totalSales": "累计销售额", "totalLiters": "累计销量",
  "activeShops": "活跃站点", "inventory": "期末库存", "generateReport": "生成分析报告",
  "regionSales": "区域年销售额", "topStations": "站点 TOP10", "productRank": "油品排行",
  "paymentDist": "支付分布", "cash": "现金", "card": "刷卡", "bonus": "积分",
  "regionSalesRank": "区域销量排名", "dailyTrend": "每日趋势", "monthlySales": "月销售额",
  "avgDaily": "日均销量", "cardRatio": "刷卡比例", "insights": "关键洞察",
  "productStruct": "油品结构", "top10Table": "销售额 TOP10", "stationSelector": "选择站点",
  "stationInfo": "站点信息", "ruName": "俄文名", "status": "状态", "regionRank": "区域排名",
  "overallRank": "全网排名", "trend30": "近30天日趋势", "payCompare": "支付对比",
  "sameRegion": "同区域对比", "radar": "雷达图", "regionTab": "区域", "byStation": "按站点汇总",
  "byRegion": "按区域汇总", "byPayment": "按支付方式", "closedStations": "停业站点",
  "pendingStations": "待关注站点", "inventoryAlert": "库存预警", "trendAnomaly": "趋势异常",
  "suggestions": "运营建议", "alertRules": "预警规则", "expectedResume": "预计恢复"
}
```
`ru.json` 对应俄文翻译（由译员/用户补充，键名一致）。

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/api/retail.ts src/i18n/zh.json src/i18n/ru.json
git commit -m "feat: 零售 API 模块 + retail i18n 命名空间"
```

---

## Task 11: 零售总览页（无地图）

**Files:**
- Create: `src/pages/retail/Overview.tsx`

**Interfaces:**
- Consumes: `src/api/retail` 的 `getYears/getDashboardYearly/getKpiYearly/getResourcesYearly/getStationStatuses`；`useApiQuery`；`ChartCard`/`KpiCard`/`PeriodPicker`；`t('retail.*')`
- 参考源：`frontend/src/pages/retail/RetailDashboard.jsx`（搬运，去掉地图部分）

- [ ] **Step 1: 写 Overview.tsx**

```tsx
import { useState } from 'react';
import { Row, Col, Space, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/hooks/useApi';
import { getYears, getDashboardYearly, getKpiYearly, getResourcesYearly, downloadYearlyReport } from '@/api/retail';
import KpiCard from '@/components/ui/KpiCard';
import ChartCard from '@/components/ui/ChartCard';
import PeriodPicker from '@/components/ui/PeriodPicker';
import { useAuth } from '@/contexts/AuthContext';
import { message } from 'antd';

export default function Overview() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const yearsQ = useApiQuery(['retail', 'years'], getYears);
  const dashQ = useApiQuery(['retail', 'dashboard', year], () => getDashboardYearly(year));
  const kpiQ = useApiQuery(['retail', 'kpi', year], () => getKpiYearly(year));
  const resQ = useApiQuery(['retail', 'resources', year], () => getResourcesYearly(year));

  const dash = dashQ.data;
  const kpi = kpiQ.data?.summary as any;
  const onGenerate = async () => {
    try {
      await downloadYearlyReport(year);
      message.success(t('common.downloadStarted'));
    } catch { message.error(t('common.downloadFailed')); }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <PeriodPicker value={year} onChange={(y) => setYear(y)} picker="year" />
        <Button type="primary" onClick={onGenerate}>{t('retail.generateReport')}</Button>
      </Space>
      <Row gutter={16}>
        <Col xs={24} sm={12} lg={6}><KpiCard title={t('retail.totalSales')} value={kpi?.totalSales ?? 0} precision={0} suffix="сом" /></Col>
        <Col xs={24} sm={12} lg={6}><KpiCard title={t('retail.totalLiters')} value={kpi?.totalLiters ?? 0} precision={0} suffix="L" /></Col>
        <Col xs={24} sm={12} lg={6}><KpiCard title={t('retail.activeShops')} value={kpi?.activeShops ?? 0} /></Col>
        <Col xs={24} sm={12} lg={6}><KpiCard title={t('retail.inventory')} value={kpi?.inventory ?? 0} precision={0} /></Col>
      </Row>
      <ChartCard
        title={t('retail.regionSales')}
        loading={dashQ.isLoading}
        option={{
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: dash ? Object.keys(dash.regions || {}) : [] },
          yAxis: { type: 'value' },
          series: [{ type: 'bar', data: dash ? Object.values(dash.regions || {}).map((r: any) => r.amount) : [] }],
        }}
      />
      <ChartCard
        title={t('retail.productRank')}
        loading={resQ.isLoading}
        option={{
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'value' },
          yAxis: { type: 'category', data: (resQ.data ?? []).map((r) => r.name).reverse() },
          series: [{ type: 'bar', data: (resQ.data ?? []).map((r) => r.amount).reverse() }],
        }}
      />
    </div>
  );
}
```

> **有意偏离 web**：客户端总览**不含 3D 地图**（用户明确要求，规格 §3.1），web 的地图热力/下钻不搬。
> 完整区块（其余图表参照 `RetailDashboard.jsx` 用 `ChartCard` 补齐）：
> - 左列：年份选择 + 年报按钮 + 4 KPI（累计销售额/累计销量 **带同比箭头**、活跃站点、期末库存）+ 区域年销售额柱图
> - 中部：站点年销售额 TOP10（点击 → 站点页）、区域年销售量排行横条
> - 右列：油品销售金额排行横条、支付分布饼图（现金/刷卡/积分）、现金vs刷卡按区域堆叠柱
> - 底部：实时动态滚动通知（6 类：最新日销量及环比 / 领先站点 / 领跑区域 / 油品销售额居首 / 现金刷卡占比 / 参与站数+累计量额）
> - 顶部标注数据截止时间（由 `summary.queryEndExclusive` 推算）
> - 区域柱图/区域销量排行/油品排行/TOP10 支持点击下钻（区域页 / 站点页 / 油品页）

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/pages/retail/Overview.tsx
git commit -m "feat: 零售总览页（无地图）"
```

---

## Task 12-16: 其余零售页面（Region / Station / Monthly / Resource / Report / Alert）

**通用说明（适用于每个页面）：**
- 每个页面文件位于 `src/pages/retail/<Name>.tsx`
- 使用 `useApiQuery` + `src/api/retail` 对应方法（签名见 Task 10）
- 图表统一用 `ChartCard`，KPI 用 `KpiCard`，日期选择用 `PeriodPicker`，表格用 `TableCard`
- i18n 键已定义在 `zh.json` 的 `retail` 命名空间（Task 10）
- 实现搬运自 `frontend/src/pages/retail/<对应>.jsx`，JSX → TSX，移除 `styled-components`/原生 CSS，改用 Ant Design 组件
- 数据映射：web 返回结构见 Task 10 各方法返回类型；如需 web 原始结构参考 `frontend/src/api/retail.js`

**Task 12: Region.tsx**
- API: `getRegions(ym)`；`useApiQuery(['retail','regions',ym])`
- 交互：区域 Tab（`Tabs`，按 REGION_ORDER），切换时取 `regions[region]`
- KPI 4 张：销售金额 / 销售总量 / 活跃站点(active/total) / 刷卡占比
- 图表（均用 `ChartCard`）：① 日趋势**双折线**（销量+金额）；② 区域内站点销售排名 horizontal bar（点击 → `navigate('/retail/station?shopKey=')`）；③ 支付分布饼（现金/刷卡）；④ 油品销售结构 horizontal bar；⑤ **现金 vs 刷卡按站点分组柱**（取销量前 8 站，非按区域堆叠）
- 区域站点列表（可跳站点页，停业站带徽标与金额 '--'）
- i18n: `retail.regionTab` 等

**Task 13: Station.tsx**
- API: `getStations(ym)` 填充选择器；`getStationMonthly(ym, shopKey)`（现有方法名，Task 10 保留）
- 交互：站点下拉（按区域 optgroup 分组，停业 `[停业]`/装修 `[装修]` 标签）；`useSearchParams` 读取 `?shopKey=`
- 站点信息面板：名称 / 俄文名 / 区域 / 状态 / 区域排名 / 全网排名（含返回按钮）
- KPI 4 张：销售金额 / 销售总量 / 现金占比 / 积分消费
- **6 图表**（均用 `ChartCard`）：① 近30天日销趋势（bar+line）；② 支付对比饼（现金升数/刷卡升数）；③ 油品结构 horizontal bar；④ **支付趋势堆叠柱（近30天，现金/刷卡按日）**；⑤ 同区域站点对比 horizontal bar；⑥ 同区域对比雷达图（销量/金额/刷卡率/积分/排名 5 维）

**Task 14: Monthly.tsx**
- API: `getMonthly(ym)`（现有方法名）、`getDaily(ym)`
- KPI 5 张（含 mom/yoy 箭头，用 `KpiCard delta`；月销售总量卡含吨位、日均销量卡含吨/天、活跃站点卡含"X站无销售"红色提示、刷卡占比卡含现金占比）
- 图表：全网日趋势（日销量 bar + 日销额 line）、油品结构（按量 horizontal bar）、支付饼（现金/刷卡，按金额）；TOP10 表用 `TableCard`（排名/站点/区域/金额/占比，点击跳站点页）
- **关键洞察文本（自动生成 7 条）**：① TOP1 单站销售额及全网第1；② 领跑区域金额及占全网%；③ 全网刷卡占比 vs 现金占比；④ 本月无销售站数及名单；⑤ 日均销量(升)+日均销售额(索姆)；⑥ 环比上月（额%/量%）；⑦ 同比去年（额%/量%）
- 生成月报按钮 → `downloadMonthlyReport(ym)`（来自 `src/api/export.ts`）

**Task 15: Resource.tsx**
- API: `getResourcesYearly(year, month?)`
- 年份+月份选择（month 可空=全年）
- KPI 4 张：销售金额 / 销售量 / 在售油品类数 / 统计口径(periodLabel)
- 油品销售统计表（`TableCard`：油品/销售量/金额/同比金额/最近月环比）
- 2 图：① 油品销售结构 horizontal bar；② **同比金额 vs 最近月环比(金额) 双柱**（均为金额维度）

**Task 16: Report.tsx + Alert.tsx**
- Report: `getMonthly(ym)`（现有方法名）取 `stations`/`regions`；三视图 Tab（按站点/区域/支付）均用 `TableCard`，**所有列支持表头点击排序**，行点击下钻（按站点→站点页、按区域→区域页）
  - 按站点(10列)：站点名称/俄语名/区域/销售金额/销售总量/现金/刷卡/积分/刷卡率/状态；tfoot 合计（站点数、合计金额、合计销量、平均刷卡率）
  - 按区域(8列)：区域/站点数/销售金额/销售总量/现金/刷卡/刷卡率/金额占比；tfoot（区域数、合计金额）
  - 按支付(8列)：站点/区域/现金/刷卡/积分/合计/现金占比/刷卡占比；tfoot（合计金额、现金占比、刷卡占比）
  - 筛选栏：区域 / 站点 / 搜索 / 状态（全部/正常营业/停业）+ "共 N 条"
  - 导出：Excel → `exportMonthlyExcel(ym)` → IPC 下载；CSV 前端生成（列：站点,俄语名,区域,销售金额,销售总量,现金,刷卡,积分）；打印 `window.print()`
- Alert: 数据源 — 停业/装修列表+运营建议(停业恢复) 用 `getStationStatuses`；库存预警数值(期末库存合计)+运营建议(电子支付) 用 `getKpi`（`summary.inventory`、`cardSales/totalSales`）；趋势异常 用 `getDaily`(当前月)；运营建议(区域集中度) 用 `getDashboardYearly`(取最新年)
  - 3 统计卡：停业站点数 / 即将装修·预计开业数 / 趋势异常数
  - 章节：停业站点（status≠normal 且 affectsSales）、即将装修/预计开业（status≠normal 且 !affectsSales）、库存预警（**静态展示**：显示"期末库存合计 X 万升，无低库存预警站点" + 阈值说明）、趋势异常（连续2日环比下降>30%）、运营建议（3 条独立：电子支付推广 / 区域布局集中度 / 停业站点恢复跟进）、预警规则配置（4 条）
  - 注：库存预警为阈值说明+全网库存合计的静态展示，非逐站低库存列表；集中度阈值规则与建议存在 50% vs 30% 不一致，实现时**统一为 30%**（以运营建议实际判定为准）

每个 Task 完成后：
- [ ] `npx tsc --noEmit` 通过
- [ ] `git add src/pages/retail/<Name>.tsx && git commit -m "feat: 零售 <Name> 页"`

---

## Task 17: 批发 API 模块

**Files:**
- Modify: `src/api/wholesale.ts`（**已存在**，现有 `src/pages/Wholesale.tsx`（将变 Query）从它导入 `getWholesaleDetails`/`WholesaleItem`——**必须保留这些旧方法**，否则 Query 页编译失败）

**Interfaces:**
- 保留现有导出：`getWholesaleDetails`、`getWholesaleExportDetail`、`WholesaleItem`
- 新增：`fetchWholesale({year,month})`（批发 6 页数据源）、`generateWholesaleReport({year,month})`
- 报告下载请用 `src/api/export.ts` 的 `downloadWholesaleReport(params)`（在 Task 17 Step 1b 追加）
- Consumes: `createApi('/api')` from `./http`（替换文件内现有 `client`）

- [ ] **Step 1: 改写 wholesale.ts 顶部实例 + 追加新方法**

将文件顶部 `import client from './client'` 及全部内容替换为（保留旧方法，新增 fetchWholesale）：
```typescript
// src/api/wholesale.ts
import { createApi } from './http';
import type { WholesalePageData } from '@/types/api';

const api = createApi('/api');

// —— 保留：现有 Query 页（原 Wholesale.tsx）依赖 ——
export interface WholesaleItem {
  id: number; businessDate: string; productName: string; vehicleNo: string;
  senderName: string; entityName: string; entityCode: string; entityType: string;
  classification: string; weightTons: number; weighSource: string;
  transportMode: string; auditStatus: string; remark: string; createdAt: string;
}
export async function getWholesaleDetails(params: {
  date_from?: string; date_to?: string; classification?: string;
  product_name?: string; entity_name?: string; page?: number; page_size?: number;
}) {
  const res = await api.get('/wholesale/details', { params });
  return res.data;
}
export async function getWholesaleExportDetail(params: {
  classification?: string; date_from?: string; date_to?: string;
}) {
  const res = await api.get('/wholesale/export-detail', { params });
  return res.data;
}

// —— 新增：批发 6 页统一数据源 ——
export async function fetchWholesale(params: { year: number; month?: number }): Promise<WholesalePageData> {
  const res = await api.get('/wholesale', { params });
  return res.data.data ?? res.data;
}
```

> 验证：改完后 `src/pages/wholesale/Query.tsx`（原 Wholesale.tsx 内容）仍能 import `getWholesaleDetails`/`WholesaleItem` 并编译。
  const ym = params.month ? `${params.year}-${String(params.month).padStart(2, '0')}` : `${params.year}`;
  const res = await api.get(`/export/analysis/wholesale/monthly/${ym}`);
  return res.data.data ?? res.data;
}
```

> 页面调用报告下载请用 `src/api/export.ts` 的 `downloadWholesaleReport(params)`（在 Task 17 Step 1b 追加到 export.ts，同 `downloadMonthlyReport`/`downloadYearlyReport` 模式，处理 electronAPI + BASE_URL 前缀）。`generateWholesaleReport` 仅供需要原始 JSON 的场景。

- [ ] **Step 1b: 在 `src/api/export.ts` 追加批发报告下载辅助**

```typescript
export async function downloadWholesaleReport(params: { year: number; month?: number }) {
  const ym = params.month ? `${params.year}-${String(params.month).padStart(2, '0')}` : `${params.year}`;
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api/export/analysis/wholesale/monthly/${ym}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json();
  if (json.docxDownloadUrl) await downloadBlob(`${BASE_URL}${json.docxDownloadUrl}`, json.docxFile || 'wholesale-report.docx', token);
  if (json.htmlDownloadUrl) await downloadBlob(`${BASE_URL}${json.htmlDownloadUrl}`, json.htmlFile || 'wholesale-report.html', token);
  if (json.htmlViewUrl) (window as any).electronAPI?.openExternal(`${BASE_URL}${json.htmlViewUrl}`);
}

- [ ] **Step 2: i18n 新增 wholesale 命名空间键（zh/ru）**

`src/i18n/zh.json` 新增 `"wholesale"` 对象：
```json
"wholesale": {
  "overview": "总览", "products": "油品统计", "customers": "客户排行", "transfer": "外运详情",
  "trend": "每日趋势", "review": "审核", "query": "批发查询",
  "exportWholesale": "出口批发", "localWholesale": "本地批发", "unknown": "待审核批发",
  "transferClass": "外运", "processing": "代加工", "procurement": "采购入库",
  "tons": "吨数", "amountCny": "金额(元)", "entities": "实体数", "matchRatio": "匹配率",
  "byRegion": "按区域", "byProduct": "按油品", "dailyTrend": "每日趋势", "dataIssues": "数据质量问题",
  "noIssues": "暂无数据问题", "needsReview": "待复核数据", "contractReview": "合同审核"
}
```
> 注：`unknown` 文案应为"待审核批发"（非"待识别"）；`matchRatio` 键保留但数据显示用 `matchedRows/rows`（已匹配条数比例）。
`ru.json` 对应俄文（键名一致）。

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/api/wholesale.ts src/i18n/zh.json src/i18n/ru.json
git commit -m "feat: 批发 API 模块 + wholesale i18n 命名空间"
```

---

## Task 18: 批发共享组件 BarList / RankList

**Files:**
- Create: `src/components/wholesale/BarList.tsx`, `RankList.tsx`

**Interfaces:**
- Produces: `BarList`（横向进度条列表）、`RankList`（编号排行列表）
- Consumes: `antd`

- [ ] **Step 1: BarList.tsx**

```tsx
// src/components/wholesale/BarList.tsx
import { List, Progress } from 'antd';
interface Row { name: string; tons: number; amountCny?: number; }
export default function BarList({ rows, showAmount }: { rows: Row[]; showAmount?: boolean }) {
  const max = Math.max(...rows.map((r) => r.tons), 1);
  return (
    <List
      size="small"
      dataSource={rows}
      renderItem={(r) => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{r.name}</span>
              <span>{r.tons.toLocaleString()} т{showAmount && r.amountCny ? ` / ¥${r.amountCny.toLocaleString()}` : ''}</span>
            </div>
            <Progress percent={Math.round((r.tons / max) * 100)} showInfo={false} strokeColor="#CC0000" />
          </div>
        </List.Item>
      )}
    />
  );
}
```

- [ ] **Step 2: RankList.tsx**

```tsx
// src/components/wholesale/RankList.tsx
import { List } from 'antd';
interface Row { name: string; tons: number; amountCny?: number; matchedRows?: number; rows?: number; }
export default function RankList({ rows, mode = 'customer' }: { rows: Row[]; mode?: 'customer' | 'pending' }) {
  return (
    <List
      size="small"
      dataSource={rows}
      renderItem={(r, i) => (
        <List.Item>
          <span style={{ width: 24 }}>{i + 1}.</span>
          <span style={{ flex: 1 }}>{r.name}</span>
          <span>{r.tons.toLocaleString()} т</span>
          {mode === 'customer' && r.matchedRows !== undefined && r.rows !== undefined && (
            <span style={{ marginLeft: 12, color: r.matchedRows / r.rows > 0.8 ? '#3f8600' : '#cf1322' }}>
              {r.matchedRows}/{r.rows} 已匹配
            </span>
          )}
          {mode === 'pending' && (
            <span style={{ marginLeft: 12, color: '#cf1322' }}>金额待合同复核 · {r.rows ?? 0} 条记录</span>
          )}
        </List.Item>
      )}
    />
  );
}
```
> 注：`transfer` 模式 web 全项目未使用，本组件不实现该分支（标预留）。

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/components/wholesale/
git commit -m "feat: 批发共享组件 BarList/RankList"
```

---

## Task 19-22: 批发页面（Overview / Products / Customers / Transfer / Trend / Review / Query）

**通用说明：**
- 每个页面位于 `src/pages/wholesale/<Name>.tsx`
- 统一用 `fetchWholesale({year, month?})` 一次取数（React Query 缓存），各 tab 取切片
- 图表用 `ChartCard`，KPI 用 `KpiCard`，列表用 `BarList`/`RankList`/`TableCard`
- i18n 键见 Task 17
- 搬运源：`frontend/src/pages/sales/wholesale/<对应>Tab.jsx`
- **有意偏离 web（用户要求，规格 §4.1）**：Overview 与 Review **不渲染"合同审核"与"待复核数据"区块**（合同管理已有独立菜单）；这两区块数据来自 `review` 字段，类型中保留但 UI 不取。Review 仅渲染 `issues`（数据质量问题）列表。

**Task 19: Overview.tsx**
- `useApiQuery(['wholesale', year, month], () => fetchWholesale({year, month}))`
- KPI 卡：遍历 `cards`（**顺序固定**：出口批发 → 本地批发 → 待审核批发 → 外运 → 采购入库 → 代加工），用 `KpiCard` 显示 **tons**；仅出口/本地两张额外显示 `amountCny`（金额元），其余 4 张仅吨数
  - 每张卡带次级指标：`entities`（出口/本地=客户数；待审核=客户数+记录数；外运=去向数+记录数；采购入库=供应商数+记录数；代加工=客户数+记录数）
- 数据质量问题：`issues` 列表（`wholesale.dataIssues`，4 类：合同未匹配/分类不符/缺少价格/缺少汇率）

**Task 20: Products.tsx**
- **6 个独立面板**（各用 `BarList`），非单张合并：
  - 出口批发油品（`showAmount`）、本地批发油品（`showAmount`）、待审核批发油品、外运油品、采购入库油品、代加工油品
  - 仅出口/本地面板传 `showAmount`（显示吨数 + CNY 金额）；其余 4 个仅吨数

**Task 21: Customers.tsx**
- **5 个独立面板**（各用 `RankList`）：
  - 出口客户排行（`mode="customer"`：吨数·金额·matchedRows/rows 已匹配）
  - 本地客户排行（`mode="customer"`）
  - 待审核合同客户（`mode="pending"`：吨数·"金额待合同复核·X 条记录"）
  - 采购供应商排行（`mode="customer"`）
  - 代加工客户排行（`mode="customer"`）
  - 注：`RankList` 的 `transfer` 模式 web 未使用，标为预留不实现

**Task 22: Transfer.tsx / Trend.tsx / Review.tsx / Query.tsx**
- Transfer: `transferSummary` 三面板 — ① 外运区域汇总（`BarList` 吨）；② 外运油品汇总（`BarList` 吨）；③ 区域×油品明细表（`TableCard`，列：区域/油品/**记录(条数)**/吨数，区域单元格跨行合并，**带"区域"下拉筛选**过滤明细）
- Trend: `dailyTrend` → `ChartCard` **双 Y 轴**（左吨 / 右人民币万元）：4 条折线 出口(实线)/本地(实线)/**待审核(虚线)**/外运(实线) + 销售额柱(右轴)；下方 `TableCard`（6 列：日期/出口吨数/本地吨数/待审核吨数/外运吨数/销售额元）
- Review: `issues` → `TableCard`（数据质量问题列表，4 类；**无合同/待审**，因已按用户要求剔除）
- Query: 重导出当前 `src/pages/Wholesale.tsx` 内容（保留旧"批发查询"页），文件另存为 `src/pages/wholesale/Query.tsx`，原 `Wholesale.tsx` 可保留或删除（删除需同步改 import）

每个 Task 完成后：
- [ ] `npx tsc --noEmit` 通过
- [ ] `git add src/pages/wholesale/<Name>.tsx && git commit -m "feat: 批发 <Name> 页"`

---

## Task 23: 数据录入 Excel 化

**Files:**
- Modify: `src/pages/TrainEntry/TrainEntryPage.tsx`（重写）
- Modify: `src/api/trainEntry.ts`（新增 `weighNo` 字段）

**Interfaces:**
- Consumes: `react-data-grid`；`src/api/trainEntry` 的 `list/create/batch/update/delete`
- 参考模板列：序号/入厂日期/油品名称/磅单号/车号/发货单位/收货单位/过磅重量/备注（规格 §5.1）

- [ ] **Step 1: 扩展 trainEntry API 加 weighNo**

```typescript
// 在 src/api/trainEntry.ts 的 TrainEntryRecord 相关方法 payload 中带 weighNo
export async function createTrainEntry(rec: any) {
  const res = await client.post('/train-entry', rec);
  return res.data;
}
export async function updateTrainEntry(id: number, rec: any) {
  const res = await client.put(`/train-entry/${id}`, rec);
  return res.data;
}
// batch 同理带 weighNo
```

- [ ] **Step 2: 写 TrainEntryPage.tsx（react-data-grid 内联编辑）**

```tsx
import { useState } from 'react';
import DataGrid, { Column } from 'react-data-grid';
import 'react-data-grid/lib/style.css';
import { Button, Space, message } from 'antd';
import { useApiQuery, useApiMutation } from '@/hooks/useApi';
import { getTrainEntryList, saveTrainEntry, deleteTrainEntry } from '@/api/trainEntry';
import { getProductOptions, getEntityOptions } from '@/api/client';
import type { TrainEntryRecord } from '@/types/api';

const columns: Column<TrainEntryRecord>[] = [
  { key: 'entryDate', name: '入厂日期', render: ({ entryDate }) => entryDate,
    editor: (p) => <input type="date" defaultValue={p.row.entryDate}
      onChange={(e) => p.onRowChange({ ...p.row, entryDate: e.target.value })} /> },
  { key: 'productName', name: '油品名称', editor: (p) => <ProductSelect ... /> },
  { key: 'weighNo', name: '磅单号', editor: 'text' },
  { key: 'vehicleNo', name: '车号', editor: 'text' },
  { key: 'senderName', name: '发货单位', editor: 'text' },
  { key: 'receiverName', name: '收货单位', editor: 'text' },
  { key: 'weightKg', name: '过磅重量', editor: 'number' },
  { key: 'remark', name: '备注', editor: 'text' },
];

export default function TrainEntryPage() {
  const listQ = useApiQuery(['train-entry', 'list'], () => getTrainEntryList());
  const [rows, setRows] = useState<TrainEntryRecord[]>([]);
  const saveM = useApiMutation((rec: TrainEntryRecord) =>
    rec.id ? saveTrainEntry(rec) : createTrainEntry(rec));

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={() => setRows([...rows, { entryDate: '', productName: '', vehicleNo: '' }])}>新增行</Button>
        <Button onClick={async () => { await saveM.mutateAsync(rows as any); message.success('已保存'); listQ.refetch(); }}>保存</Button>
      </Space>
      <DataGrid columns={columns} rows={rows} onRowsChange={setRows}
        className="rdg-light" style={{ height: 500 }} />
    </div>
  );
}
```

> 下拉编辑器（productName/senderName/receiverName）用 Ant Design `Select`，选项来自 `getProductOptions`/`getEntityOptions`；删除用行首 checkbox + 批量 `deleteTrainEntry`。顶部保留日期范围筛选 + Excel 导入（沿用现有 XLSX 解析逻辑）。

- [ ] **Step 3: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/pages/TrainEntry/TrainEntryPage.tsx src/api/trainEntry.ts
git commit -m "feat: 数据录入改为 react-data-grid Excel 化编辑"
```

---

## Task 24: 3D 地图角色过滤

**Files:**
- Modify: `src/components/KgzMap.tsx`

**Interfaces:**
- Consumes: `useAuth().user.role`；`mapRoleVisibleTypes(role)` from `src/config/mapRoles`；`MapPoint` 类型

- [ ] **Step 1: 在 KgzMap 取数后按角色过滤标点**

在 `KgzMap.tsx` 获取 `points: MapPoint[]` 后，渲染前加：

```tsx
import { useAuth } from '@/contexts/AuthContext';
import { mapRoleVisibleTypes } from '@/config/mapRoles';

// 组件内
const { user } = useAuth();
const visibleTypes = mapRoleVisibleTypes(user?.role);
const filtered = points.filter((p) => visibleTypes.includes(p.type));
// 用 filtered 渲染标点；无 lat/lng 的点跳过（规格 §6.3）
const renderPoints = filtered.filter((p) => p.lat != null && p.lng != null);
```

- [ ] **Step 2: 编译确认 + 手动验证**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过；`npm run dev` 后用 retail 账号登录只见油库+加油站，wholesale 账号见油库+客户

- [ ] **Step 3: 提交**

```bash
git add src/components/KgzMap.tsx
git commit -m "feat: 3D 地图按角色过滤标点类型"
```

---

## Task 25: 仪表板 KPI 宽度对齐

**Files:**
- Modify: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `KpiCard` from `src/components/ui/KpiCard`
- 数据关联：Dashboard 现有数据来自 `@/api/retail` 的 `getKpiYearly`/`getDashboardYearly`/`getMonthly`（Task 10 已保留这些方法名，故 Dashboard 导入不变）+ 内联 `client.get('/dashboard/overview')` 与 `client.get('/dashboard/market-watch')`（Task 1.6 要求回收内联调用，可在本任务把这两者迁入 `src/api/retail.ts` 为 `getDashboardOverview()` / `getMarketWatch()`，非必须；保留内联也能编译）

- [ ] **Step 1: 将 Dashboard 顶部 KPI 行改为 Row/Col 均分**

定位 Dashboard 现有 KPI 渲染块，替换为：

```tsx
<Row gutter={16}>
  <Col xs={24} sm={12} lg={6}><KpiCard title={t('dashboard.sales')} value={sales} precision={0} suffix="сом" /></Col>
  <Col xs={24} sm={12} lg={6}><KpiCard title={t('dashboard.liters')} value={liters} precision={0} suffix="L" /></Col>
  <Col xs={24} sm={12} lg={6}><KpiCard title={t('dashboard.transfer')} value={transferTons} precision={0} suffix="т" /></Col>
  <Col xs={24} sm={12} lg={6}><KpiCard title={t('dashboard.activeShops')} value={shops} /></Col>
</Row>
```

> 所有 KpiCard 高度/内边距一致（组件已固定 `height:120`），`lg=6` 保证 4 列等宽；窄屏自动换行。

- [ ] **Step 2: 编译确认**

Run: `cd D:\SalesVisualization\SalesDesktop && npx tsc --noEmit`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/pages/Dashboard.tsx
git commit -m "fix: 仪表板 KPI 卡片宽度对齐"
```

---

## Task 26: 依赖安装 + 版本号 + 构建配置

**Files:**
- Modify: `package.json`, `src/version.ts`, `electron-builder.yml`

**Interfaces:**
- Consumes: 无

- [ ] **Step 1: 安装新依赖**

Run: `cd D:\SalesVisualization\SalesDesktop && npm install @tanstack/react-query react-data-grid`
Expected: 两个包加入 dependencies

- [ ] **Step 2: 升版本号（三处同步）**

`src/version.ts`:
```typescript
export const VERSION = '3.0.0';
export const BUILD_DATE = '2026-07-09';
// CHANGELOG 顶部新增：
// { version: '3.0.0', date: '2026-07-09', type: 'major',
//   changes: ['零售板块重构为 7 页大类菜单', '新增批发板块 6 页', '数据录入改为 Excel 表格编辑',
//             '3D 地图按角色过滤标点', '仪表板 KPI 对齐', '架构重构：统一 HTTP 层、React Query、共享组件库、路由懒加载'] }
```

`package.json`: `"version": "3.0.0"`

`electron-builder.yml`: `directories.output: release_v18`

- [ ] **Step 3: 全量类型检查 + 构建**

Run: `cd D:\SalesVisualization\SalesDesktop && npm run build`
Expected: 构建成功，输出到 `release_v18/`

- [ ] **Step 4: 提交**

```bash
git add package.json package-lock.json src/version.ts electron-builder.yml
git commit -m "chore: 升版本至 3.0.0 + 构建配置 release_v18"
```

---

## 自审摘要

- **规格覆盖**：§1 架构（Task 1-6,9）→ ✓；§2 导航（Task 7-9）→ ✓；§3 零售（Task 10-16）→ ✓；§4 批发（Task 17-22，Overview 剔除合同/待审已注明）→ ✓；§5 数据录入（Task 23）→ ✓；§6 地图（Task 24）→ ✓；§7 仪表板/版本（Task 25-26）→ ✓
- **占位符扫描**：无 TBD/TODO；页面搬运任务均给出 API 签名、数据形状、组件、i18n 键与 web 源文件引用，无"类似 Task N"空引用
- **类型一致性**：`MapPointType`/`WholesalePageData`/`TrainEntryRecord` 等在 Task 4 定义，后续 Task 引用一致；`createApi` 在 Task 1 定义，各 api 模块复用
- **已知依赖**：`react-data-grid` 的 `Column` 泛型与编辑器签名以官方文档为准，实现时按运行时类型微调；报告下载统一走 `src/api/export.ts` 的 `downloadMonthlyReport`/`downloadYearlyReport`/`downloadWholesaleReport`（内部经 `window.electronAPI.downloadFile` 落盘）
