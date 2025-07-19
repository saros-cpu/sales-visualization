# Frontend — 销售板块可视化平台前端

目录：`D:\SalesVisualization\frontend`

React + Vite 前端项目，构建产物由 Nginx 静态服务，API 请求转发到 Flask :8900。

## 技术栈

| 技术         | 版本       | 说明                               |
| ------------ | ---------- | ---------------------------------- |
| React        | 19.x       | UI 框架                            |
| React Router | 7.x        | 客户端路由                         |
| Vite         | 8.x        | 构建工具 + 开发服务器              |
| ECharts      | 全局       | 图表库，通过 `window.echarts` 使用 |
| Three.js     | 全局       | 3D 地图，动态 import `/assets/kgz-map/` |

## 目录结构

```text
frontend/
├── public/                          # 静态资源（favicon 等）
├── src/
│   ├── main.jsx                     # 应用入口
│   ├── App.jsx                      # 路由配置
│   ├── api/                         # API 请求封装
│   │   ├── client.js                #   基础请求（自动 credentials + 401 跳转）
│   │   ├── auth.js                  #   登录/登出/会话
│   │   ├── retail.js                #   零售板块 API
│   │   ├── sales.js                 #   销售板块 API
│   │   ├── wholesale.js             #   批发板块 API
│   │   └── admin.js                 #   管理后台 API
│   ├── components/                  # 共享组件
│   │   ├── layout/
│   │   │   ├── AppLayout.jsx        #   销售/批发/管理布局（Outlet + DataAssistant）
│   │   │   ├── RetailLayout.jsx     #   零售布局（暗色主题 + Header + Footer）
│   │   │   └── RetailHeaderContext.jsx  # 零售 Header 动态控件 Context
│   │   ├── admin/                   #   管理后台组件（9 个 Tab，批发合同含 4 子面板）
│   │   ├── wholesale/               #   批发子组件（BarList, RankList）
│   │   ├── common/                  #   AuthGuard, AdminGuard, LoadingSpinner
│   │   └── DataAssistant.jsx        #   数据助手（浮动面板）
│   ├── hooks/                       # 自定义 Hooks
│   │   ├── useAuth.jsx              #   认证状态管理
│   │   ├── useChart.js              #   ECharts 实例管理
│   │   ├── usePeriod.js             #   年份/月份周期管理
│   │   └── useApi.js                #   API 请求 Hook
│   ├── pages/                       # 页面组件
│   │   ├── retail/                  #   零售板块 7 个页面
│   │   │   ├── RetailDashboard.jsx  #     总览
│   │   │   ├── MonthlyPage.jsx      #     月度分析
│   │   │   ├── RegionPage.jsx       #     区域分析
│   │   │   ├── StationPage.jsx      #     站点分析
│   │   │   ├── ResourcePage.jsx     #     油品分析
│   │   │   ├── ReportPage.jsx       #     日报/月报
│   │   │   └── AlertPage.jsx        #     预警中心
│   │   └── sales/                   #   销售板块 3 个页面
│   │       ├── DashboardPage.jsx    #     销售主页
│   │       ├── WholesalePage.jsx    #     批发统计（8 个 Tab，含称重明细）
│   │       ├── AdminPage.jsx        #     管理后台（9 个 Tab）
│   │       └── LoginPage.jsx        #     登录
│   ├── styles/                      # 样式文件
│   │   ├── global.css               #   全局样式 + 销售/管理模块
│   │   └── retail.css               #   零售暗色主题
│   └── utils/                       # 工具函数
│       ├── format.js                #   数字/日期格式化
│       ├── retail-helpers.js        #   零售数据处理工具
│       └── admin-helpers.js         #   管理后台工具
├── index.html                       # Vite HTML 模板
├── vite.config.js                   # Vite 配置（开发代理 + 构建）
├── package.json
└── dist/                            # 构建产物（git 忽略）
```

## 路由

| 路径                | 页面         | 布局          | 说明                          |
| ------------------- | ------------ | ------------- | ----------------------------- |
| `/login`            | 登录页       | 独立           |                               |
| `/`                 | 销售主页     | AppLayout      | KPI + 汇率 + 市场观察 + 3D 地图 |
| `/wholesale`        | 批发板块     | AppLayout      | 8 个 Tab（含称重明细）         |
| `/admin`            | 管理后台     | AppLayout      | 需管理员权限，9 个 Tab         |
| `/retail`           | 零售总览     | RetailLayout   | 暗色大屏，三栏布局             |
| `/retail/monthly`   | 月度分析     | RetailLayout   | KPI + 趋势 + 油品 + 洞察      |
| `/retail/region`    | 区域分析     | RetailLayout   | 区域切换 + 站点排行            |
| `/retail/station`   | 站点分析     | RetailLayout   | 站点选择 + 6 个图表            |
| `/retail/resource`  | 油品分析     | RetailLayout   | 油品结构 + 同比环比            |
| `/retail/report`    | 日报/月报    | RetailLayout   | 多维查询 + 导出                |
| `/retail/alert`     | 预警中心     | RetailLayout   | 停业/库存/趋势预警 + 运营建议  |
| `/legacy/*`         | 旧版 HTML    | 无             | 过渡期保留                     |

## 开发

```powershell
cd D:\SalesVisualization\frontend
npm install
npm run dev
```

Vite 开发服务器启动在 `http://localhost:5173`，API 请求自动代理到 Flask :8900。

**注意**：开发前需先启动 Flask 后端：

```powershell
cd D:\SalesVisualization\Sales
python run_production.py
```

## 构建

```powershell
cd D:\SalesVisualization\frontend
npm run build
```

构建产物输出到 `frontend/dist/`，由 Nginx 静态服务。构建配置 `assetsDir: '_next'` 避免与 Nginx `/assets/` 路由冲突。

## 部署

推荐使用项目根目录的一键部署脚本：

```powershell
powershell -ExecutionPolicy Bypass -File D:\SalesVisualization\deploy-production.ps1
```

该脚本会：
1. 检测 Node.js 环境
2. 执行 `npm install` + `npm run build`
3. 生成/更新 `nginx.conf`
4. 启动或重载 Nginx

## 双布局架构

- **AppLayout**：销售/批发/管理模块共用。每个页面自带 topbar（标题 + 模块导航 + 年份/月份筛选），通过 `useOutletContext` 传递 `{ user, handleLogout }`。
- **RetailLayout**：零售模块所有页面共用。暗色科技风主题，Header 通过 `RetailHeaderContext` 接收子页面动态注册的控件（月份选择器、报告按钮等），Footer 显示滚动实时动态。

## API 请求

所有 API 请求通过 `src/api/client.js` 统一封装：

- 自动添加 `credentials: 'include'`（Session Cookie）
- 401 未登录自动跳转 `/login`
- 按模块拆分为 `retail.js`、`sales.js`、`wholesale.js`、`admin.js`

## ECharts 和 3D 地图

- **ECharts**：通过 `<script>` 标签在 `index.html` 中引入，页面组件中使用 `window.echarts` 创建实例
- **3D 地图**：使用 `import('/assets/kgz-map/kgz-map-entry.js')` 动态导入，ECharts 地图作为 fallback

## 认证

- 登录态通过 Flask Session Cookie 维护
- React 页面打开时自动检查 `/api/auth/me`
- `AuthGuard` 保护销售/批发页面，`AdminGuard` 保护管理后台
- 未登录自动跳转 `/login`

## 环境变量

开发模式下无需额外配置。Vite 代理已在 `vite.config.js` 中配置：

- `/api/*` → `http://127.0.0.1:8900`
- `/retail-app/*` → `http://127.0.0.1:8900`
- `/legacy/*` → `http://127.0.0.1:8900`

## 经营助手（DataAssistant）

全局浮动按钮（右下角），覆盖全项目数据查询：
- **零售**：销量/金额/吨位、按油品/站点/区域维度、日趋势
- **批发**：出口/本地/外运分类统计、客户/油品排行、待复核
- **合并**：零售+批发合并销售量/金额
- **同比环比**：月度销量/金额同比（较上年同月）、环比（较上月）
- **汇率/密度**：历史汇率快照、当前油品密度
- **市场观察**：俄罗斯/乌兹别克/国际成品油及原油行情
- **站点状态**：当前停业/异常站点列表
- **年度 KPI**：累计销量/金额/交易笔数/活跃站点
- 所有查询优先读取快照数据，毫秒级响应

## 响应式适配

零售板块 7 个页面已适配手机（480px）和平板（768px）：

- **全局**：`.retail-shell overflow-y:auto` 允许页面滚动，子容器 `overflow:visible` 避免内容裁剪
- **面板高度**：移动端 `.panel-body` 显式 `height:260px` 确保 `height:100%` 图表正确渲染
- **左列修复**：站点/区域页左列 `flex:1` 面板在自动高度父容器中坍缩，使用 `flex:none!important` 修复
- **KPI 卡片**：768px 2 列，480px 1 列
- **报表表格**：`tfoot` 固定底部，`min-height:70vh`（768px）/ `55vh`（480px）
- **网格**：多列网格收窄为单列，`overflow:visible` 替代 `overflow-y:auto`
- 详见 `src/styles/retail.css` 中 `@media (max-width: 768px)` 和 `@media (max-width: 480px)` 规则

## 版本记录

| 版本  | 日期       | 说明                                                   |
| ----- | ---------- | ------------------------------------------------------ |
| 0.1.0 | 2026-05    | 初始迁移：路由、双布局、10 个页面、API 封装、3D 地图    |
| 0.2.0 | 2026-06    | UI 一致性修复：KPI 修正、表单补齐、站点状态自动判定、运营建议动态化、审核分类完善、statusType 联动 |
| 0.3.0 | 2026-06-17 | 零售模块手机/平板响应式适配：768px/480px 断点，面板坍缩修复，滚动/溢出处理 |
| 0.4.0 | 2026-06-17 | 经营助手增强：趋势/同比环比/站点状态/油品占比/KPI 查询，覆盖全项目快照 |
| 0.5.0 | 2026-07-01 | 批发看板全功能整改：称重明细模板9列+筛选+报表、执行看板排序高亮跳转、自动审核、客户导出、日期筛选；T+1修复 |
