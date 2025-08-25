# SalesDesktop 3.0 设计文档

> 状态：已与用户逐节确认（2026-07-09）
> 方案：A（全量重构 + 功能搬运）

## 目标

将 web 项目的零售、批发功能完整移植到 Electron 桌面客户端，并借此次大版本对客户端架构做一次彻底重构：统一 HTTP 层、引入数据缓存、补全类型、建立共享组件库、路由懒加载、错误边界。版本号升 `3.0.0`。

## 范围

| 类别 | 内容 |
|------|------|
| 新功能 | 零售 7 页、批发 6 页、数据录入 Excel 化、3D 地图角色过滤 |
| 结构改动 | 侧边栏重构（零售/批发大类）、称重移入管理、仪表板 KPI 对齐 |
| 架构重构 | 单 Axios 实例、React Query、TS 类型化、组件库、代码分割、错误边界 |
| 不做 | 不改后端 Flask 逻辑（除 `train-entry` 表加 `weigh_no` 列）、不加报表类型、不动权限模型本身 |

---

## 1. 架构基础

### 1.1 统一 HTTP 层
- 合并 `client.ts` / `retail.ts` / `exchange.ts` 三个 Axios 实例 → 单一 `src/api/http.ts`
- 通过 `createApi(basePath)` 工厂生成实例：
  - 零售 / 汇率 → `baseURL=/api`
  - 其他资源 → `baseURL=/api/v2`
- 401 拦截器只写一份（统一跳登录、刷新 token）

### 1.2 数据获取层（React Query）
- 新增 `@tanstack/react-query`，在 `main.tsx` 挂 `QueryClientProvider`
- 封装 `useApiQuery` / `useApiMutation` hooks，取代现有 `useEffect + useState + loading/error` 样板
- 查询键按 `(module, endpoint, params)` 规范，自动去重 + 缓存

### 1.3 类型化
- 新建 `src/types/api.ts`，为所有端点定义请求/响应接口
- 移除散落的 `any`，页面组件 props/state 全类型化

### 1.4 共享组件库（`src/components/ui/`）
- `ChartCard` — ECharts 图表容器（标题 + 图例 + 加载态）
- `KpiRow` / `KpiCard` — KPI 卡片
- `PeriodPicker` — 年/月选择器（零售、批发复用）
- `TableCard` — 带标题的导出表格
- `ErrorBoundary` + `Skeleton` 加载态

### 1.5 路由与性能
- 全部路由改为 `React.lazy` 懒加载
- 顶层 `ErrorBoundary` 包裹 `<App>`，页面级 `ErrorBoundary` 兜底

### 1.6 内联 API 调用回收
- `Dashboard.tsx`、`KgzMap.tsx`、`UserRoles.tsx` 中的直接 Axios 调用 → 迁入对应 `api/*.ts`

---

## 2. 导航与布局

### 2.1 侧边栏新结构
```
仪表板                 /dashboard
零售（大类，可展开）     /retail
  ├ 总览                /retail/overview
  ├ 区域                /retail/region
  ├ 站点                /retail/station
  ├ 月度                /retail/monthly
  ├ 油品                /retail/resource
  ├ 报表                /retail/report
  └ 预警                /retail/alert
批发（大类，可展开）     /wholesale
  ├ 总览                /wholesale/overview
  ├ 油品统计             /wholesale/products
  ├ 客户排行             /wholesale/customers
  ├ 外运详情             /wholesale/transfer
  ├ 每日趋势             /wholesale/trend
  ├ 审核                /wholesale/review
  └ 批发查询             /wholesale/query（保留旧页）
汇率查询                /exchange
数据录入                /train-entry   ← Excel 化
采购查询                /procurement
合同管理                /contracts
物资调拨                /materials
外运损耗                /transfer-loss
3D 地图                 /map
管理（子类，可展开）     /management
  ├ 用户列表            /users
  ├ 角色权限            /users/roles
  ├ 别名管理            /aliases
  └ 称重审核            /weighing      ← 从顶层移入
设置                    /settings
```

### 2.2 路由实现
- `App.tsx` 改为声明式嵌套路由 + `React.lazy`
- 新增 `RetailLayout` / `WholesaleLayout` 包裹各自子页面
- 菜单配置抽到 `src/config/menu.ts`，支持 `children` + `roles` 字段

### 2.3 角色与菜单可见性
- `menu.ts` 每项可标 `roles: ['admin','retail',...]`
- `AppLayout` 读取 `useAuth()` 的 role 过滤菜单
- 默认：未标角色的菜单对所有登录用户可见

### 2.4 子菜单交互形式
采用 **(a) 侧边栏嵌套展开**，与现有"管理"风格一致。

---

## 3. 零售模块（7 页搬运）

从 web `frontend/src/pages/retail/*` 移植，JSX → TSX + Ant Design 5 + i18n（zh/ru），基于第 1 节组件库重写。

### 3.1 页面清单与映射
| 子路由 | 来源（web） | 主要内容 | 特殊处理 |
|--------|------------|---------|---------|
| `/retail/overview` | RetailDashboard.jsx (704行) | 年份选择 + 4 KPI + 区域柱图 + 站点TOP10 + 油品排行 + 支付饼图 + 区域销量榜 + 生成年报按钮 | **不含 3D 地图** |
| `/retail/monthly` | MonthlyPage.jsx (358行) | 月份选择 + 5 KPI + 日趋势 + 洞察文本 + 油品结构 + 支付饼 + TOP10表 + 生成月报按钮 | 复用 `exportAnalysis` 下载 |
| `/retail/station` | StationPage.jsx (352行) | 站点下拉（按区域分组）+ 信息面板 + 4 KPI + 6 图（趋势/支付/油品/同区对比/雷达） | 站点选择器抽为共享组件 |
| `/retail/region` | RegionPage.jsx (249行) | 区域 Tab + 4 KPI + 5 图 + 站点列表（可跳站点页） | 区域 Tab 抽共享 |
| `/retail/resource` | ResourcePage.jsx (192行) | 年/月选择 + 4 KPI + 油品表 + 2 图 | — |
| `/retail/report` | ReportPage.jsx (270行) | 筛选栏 + 3 视图（按站点/区域/支付）+ 导出 Excel/CSV/打印 | 导出走 IPC（Electron）|
| `/retail/alert` | AlertPage.jsx (277行) | 3 统计卡 + 停业/装修/库存/趋势异常/建议/规则配置 | 预警数据来自 `station-statuses` |

### 3.2 API 接入
- 新建 `api/retail.ts`：`getYears / getMonths / getDashboardYearly / getKpiYearly / getMonthlyData / getStations / getStationDetail / getRegions / getDaily / getResourcesYearly / getStationStatuses`
- React Query 查询键：`['retail', 'monthly', ym]` 等

### 3.3 i18n
- 新增 `retail` 命名空间（zh/ru），从 web 中文硬编码提取翻译

### 3.4 复用组件
- `ChartCard`（所有图表）、`KpiRow`（所有 KPI 行）、`PeriodPicker`（年/月选择）、`TableCard`（报表/排行表）

---

## 4. 批发模块（6 页搬运 + 旧页保留）

从 web `frontend/src/pages/sales/wholesale/*` 移植，去掉汇率、称重明细两个 tab（已独立），基于组件库重写。

### 4.1 页面清单
| 子路由 | 来源（web） | 主要内容 |
|--------|------------|---------|
| `/wholesale/overview` | OverviewTab.jsx | KPI 卡（出口/本地/待审/外运/采购/代加工 吨·金额·实体）+ 数据质量问题。**剔除合同审核状态、待审项**（合同管理已有独立菜单） |
| `/wholesale/products` | ProductsTab.jsx | 按分类的油品排行（横向条形）吨数 + CNY 金额 |
| `/wholesale/customers` | CustomersTab.jsx | 客户排行 吨数·金额·匹配率 |
| `/wholesale/transfer` | TransferTab.jsx | 3 面板：按区域外运 + 按油品外运 + 区域×油品明细表 |
| `/wholesale/trend` | TrendTab.jsx | 每日吨数折线（出口/本地/待审/外运）+ 金额柱图 + 数据表 |
| `/wholesale/review` | ReviewTab.jsx | 数据质量问题列表 |
| `/wholesale/query` | 现有 Wholesale.tsx | 保留旧"批发查询"页，作为子项入口 |

### 4.2 API 接入
- 新建 `api/wholesale.ts`：`fetchWholesale({year,month})` → `GET /api/wholesale`
- 子 tab 数据均来自 `summarize_wholesale_page` 返回的同一对象，用 React Query 取一次、各 tab 取切片
- 导出：`generateWholesaleReport`（`/api/export/analysis/wholesale/monthly/:ym`）走 IPC 下载

### 4.3 i18n
- 新增 `wholesale` 命名空间（zh/ru），从 web 中文硬编码提取翻译

### 4.4 共享组件复用
- `BarList` / `RankList`（web 已有，转 TS + Ant Design）+ 第 1 节 `ChartCard` / `KpiRow`

---

## 5. 数据录入 Excel 化

### 5.1 技术方案
- 用 `react-data-grid`（轻量、免费、类 Excel 内联编辑）替换现有 Modal 单条录入
- 列定义（9 列）：

| 列 | 字段 | 编辑器类型 | 必填 |
|----|------|-----------|------|
| 序号 | `id`（自动） | 只读 | — |
| 入厂日期 | `entryDate` | 日期 | ✔ |
| 油品名称 | `productName` | 下拉（别名产品） | ✔ |
| 磅单号 | `weighNo` | 文本 | — |
| 车号 | `vehicleNo` | 文本 | ✔ |
| 发货单位 | `senderName` | 下拉（别名实体） | — |
| 收货单位 | `receiverName` | 下拉（别名实体） | — |
| 过磅重量 | `weightKg` | 数字 | — |
| 备注 | `remark` | 文本 | — |

### 5.2 交互
- 行内编辑：双击单元格直接改，Enter 提交、Esc 取消
- 新增行：底部空白行或"新增"按钮，自动校验必填
- 批量保存：编辑后点"保存"，差异行 PUT/POST
- 删除：行首勾选 → 批量删除
- 顶部保留：日期范围筛选 + 搜索 + Excel 导入（沿用现有 XLSX 解析）

### 5.3 API
- 沿用 `api/trainEntry.ts`：`list / create / batch / update / delete`
- 字段扩展：API 需新增 `weighNo` 字段（后端 `train-entry` 表加列）

### 5.4 备注用途
- 备注登记"油品所属油罐"或区分"火车/汽车"运输方式

---

## 6. 3D 地图角色过滤

### 6.1 过滤规则
| 角色 | 显示标点 |
|------|---------|
| admin | 全部：油库 + 加油站 + 客户 + 供应商 |
| retail（零售账号） | 油库 + 加油站 |
| wholesale（批发账号） | 油库 + 客户 |
| procurement（采购账号） | 供应商 + 油库 |

### 6.2 实现
- `KgzMap.tsx` 读取 `useAuth()` 的 role，按上表过滤 `GET /api/map/stations` 返回的标点集
- 标点类型：油库（depot）、加油站（station）、客户（customer）、供应商（supplier），各用不同颜色/图标
- 悬浮卡片（库存/价格）仅对有权限的类型显示
- 角色→可见类型映射抽到 `src/config/mapRoles.ts`

### 6.3 数据
- 后端 `/api/map/stations` 当前的油库/加油站标点应已带类型标识；若无 `type` 字段则在客户端按现有字段（如 `kind`/`isDepot`）映射，不要求后端改接口
- 客户/供应商坐标后端暂未提供，对应类型标点暂不渲染（优雅跳过），待后期配置

### 6.4 待确认（后期）
- 客户/供应商的地理坐标后端是否已提供？还是客户端配静态表？→ 用户答复：后期再配。

---

## 7. 仪表板修复 + 收尾项

### 7.1 仪表板 KPI 宽度对齐
- 现有 `Dashboard.tsx` 顶部 KPI 行左右列宽不一致 → 改用 Ant Design `Row` + `Col` 固定 24 栅格均分（如 4 列用 `xs=24 sm=12 lg=6`）
- 所有 KPI 卡统一 `KpiCard` 组件（第 1.4 节），高度/内边距一致
- 响应式：窄屏自动换行不挤压

### 7.2 称重移入管理子菜单
- `AppLayout` 菜单配置：把 `/weighing` 从顶层移到 `management` 子项（第 2.1 节已含）

### 7.3 版本与构建
- 升 `version.ts` → `3.0.0`，CHANGELOG 写明大改内容
- `electron-builder.yml` 输出目录改 `release_v18`（避免 `app.asar` 锁）
- 构建后更新 `latest.yml` 到 Nginx `/download/`

### 7.4 依赖新增
- `@tanstack/react-query`
- `react-data-grid`
- （可选）`@tanstack/react-query-devtools` 仅 dev

### 7.5 不做的范围（明确排除）
- 不改动后端 Flask 逻辑（仅客户端；后端 `train-entry` 表加 `weigh_no` 列除外）
- 不新增报表类型
- 不碰登录/权限模型本身（仅用现有 role 做菜单+地图过滤）

---

## 实施顺序建议

1. 架构基础（1.1–1.6）→ 全项目可编译
2. 导航与布局（2.1–2.4）→ 菜单骨架 + 路由
3. 零售模块（3）→ 7 页
4. 批发模块（4）→ 6 页 + 旧页
5. 数据录入 Excel 化（5）
6. 3D 地图角色过滤（6）
7. 仪表板修复 + 收尾（7）
8. 构建 3.0.0 发包
