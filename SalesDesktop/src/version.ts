// 版本号管理 — 语义化版本 (SemVer)
// MAJOR: 不兼容的 API 或架构变更
// MINOR: 新增功能（向后兼容）
// PATCH: Bug 修复、小优化（向后兼容）

export const VERSION = '3.0.0';
export const BUILD_DATE = '2026-07-10';

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.0.0',
    date: '2026-07-10',
    type: 'major',
    changes: [
      '零售板块重构为 7 页大类菜单（总览/区域/站点/月度/油品/报表/预警）',
      '新增批发板块 6 页（总览/油品统计/客户排行/外运详情/每日趋势/审核）',
      '数据录入改为 Excel 表格编辑，增加磅单号字段',
      '3D 地图按角色过滤标点',
      '仪表板 KPI 对齐',
      '架构重构：统一 HTTP 层、React Query、共享组件库、路由懒加载',
    ],
  },
  {
    version: '2.7.0',
    date: '2026-07-09',
    type: 'minor',
    changes: [
      '重构：左侧栏菜单 — 别名管理移入管理菜单下（用户管理 → 管理），管理菜单含用户列表/角色权限/别名管理',
      '优化：设置页关于只显示最近 2 个版本，展开按钮查看完整版本历史',
      '修复：桌面快捷图标不更新（NSIS 增加 installerIcon / uninstallerIcon 配置）',
      '修复：IPC downloadFile 传 JWT token 到主进程 fetch，彻底解决所有下载路径的 401 问题',
    ],
  },
  {
    version: '2.6.7',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '修复：IPC downloadFile 传 JWT token 到主进程 fetch，彻底解决所有下载路径的 401 问题',
    ],
  },
  {
    version: '2.6.6',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '修复：分析报告端点改回 /api/export/analysis/monthly/（之前误用 sales/monthly 生成批发+零售合并报告）',
      '修复：分析报告 HTML 改用 IPC downloadFile 下载 + shell.openExternal 系统浏览器打开',
      '修复：分析报告下载 401（主进程 fetch 不带 auth；后端 /api/export/analysis/sales/download/ 加入公共白名单）',
    ],
  },
  {
    version: '2.6.5',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '修复：分析报告 API 端点改为 /api/export/analysis/sales/monthly（之前命中 catch-all 代理返回错误格式）',
      '修复：分析报告下载 URL 双 /api/ 重复导致 404 保存取消',
      '修复：分析报告下载 IPC handler 回退 fetch+write 确保文件保存到用户选择的路径',
    ],
  },
  {
    version: '2.6.4',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '修复：分析报告下载读取 API 字段名（docxDownloadUrl / docxFile），兼容真实后端响应',
      '修复：客户端下载改用 mainWindow.webContents.downloadURL 原生下载管理器，替代手动 fetch+write',
      '修复：桌面快捷图标不更新（electron-builder 增加 createDesktopShortcut: true）',
    ],
  },
  {
    version: '2.6.3',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '修复：3D 地图 station-map-details 请求缺少 auth token，导致 inventory 合并失败',
    ],
  },
  {
    version: '2.6.2',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '新增：零售导出改用 Electron IPC 原生保存对话框，修复客户端导出不弹框不存文件',
      '优化：仪表板左右栏 12/12 等宽 + flex 等高布局',
      '修复：3D 地图站点 shopKey 写入后端，合并库存/价格数据，tooltip 显示油品库存与零售价',
      '修复：数据录入页「导入」按钮中俄双语文本',
    ],
  },
  {
    version: '2.6.1',
    date: '2026-07-09',
    type: 'patch',
    changes: [
      '新增：导入按钮 — 解析参考 Excel 模板（明细表格式）批量录入火车外运数据',
      '修复：零售导出按钮改为 fetch + blob 方式，弹窗准确保存 Excel 文件',
      '优化：仪表板左右栏比例调整（左侧 KPI 缩窄至 14/24，市场观察扩至 10/24）',
      '变更：移除英文界面，仅保留客户端中俄双语',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-07-08',
    type: 'minor',
    changes: [
      '重构：仪表板 KPI 布局（左列 KPI+汇率，右列市场观察，底部趋势图）',
      '优化：市场观察卡片只显示最近 3 条资讯',
      '优化：零售分析页资源排行改为饼图，区分区域排行条形图',
      '新增：3D 地图站点悬停显示库存与零售价信息',
      '记忆：版本管理规则写入 AGENTS.md（每次改动必升版本号）',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-07-08',
    type: 'minor',
    changes: [
      '新增：浅色主题（白背景 + 品牌红 #CC0000 强调色）',
      '新增：客户端专属 logo（红色方块「中」字 + 浅黑环形）',
      '新增：自定义应用图标（build/icon.ico + favicon）',
      '新增：登录页背景 + logo 居中展示',
      '新增：侧栏 logo 替代此前文字占位',
      '修复：版本历史列表顺序错乱（改为严格倒序）',
    ],
  },
  {
    version: '2.3.1',
    date: '2026-07-08',
    type: 'patch',
    changes: [
      '修复：安装包显示名 GB2312 编码问题（productName 改为 ASCII）',
      '修复：桌面快捷方式显示 .lnk 问题（nsis.shortcutName 单独设置中文）',
      '修复：3D 地图在外网客户端初始化失败（Nginx 代理 kgz-map 数据 + 绝对路径回退）',
      '修复：仪表板 KPI 卡片板块布局错位（统一 flex 列 + 预留 YoY 空间）',
      '补充：版本历史完整记录（v1.0.0 初始平台 + v1.1.0 优化改进）',
      '优化：productName 改为 SalesDesktop（避免非中文系统编码问题）',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-07-08',
    type: 'minor',
    changes: [
      '新增：Electron 自动更新（electron-updater + IPC + 设置页 UI）',
      '新增：自动更新配置（electron-builder.yml publish + preload 桥接）',
      '优化：package.json 版本号与 version.ts 对齐',
    ],
  },
  {
    version: '2.2.1',
    date: '2026-07-08',
    type: 'patch',
    changes: [
      '修复：3D 地图标点悬停不显示站点信息（缺少 kgz-map.css 引用）',
      '修复：3D 地图客户点位不显示（mountHomeMap 参数映射修复）',
      '修复：Electron CSP 警告（添加 Content-Security-Policy）',
      '修复：React Router v7 迁移警告（HashRouter 添加 future 配置）',
      '优化：CORS 手工处理替代 Flask-CORS（修复跨域问题）',
      '优化：Three.js Clock → Timer 废弃警告修复',
      '优化：仪表板市场观察卡片显示真实数据',
    ],
  },
  {
    version: '2.2.0',
    date: '2026-07-07',
    type: 'minor',
    changes: [
      '新增：别名 API（/api/v2/aliases/products|entities|suggest）',
      '新增：别名管理页面（/aliases 双 Tab 页）',
      '新增：用户角色权限矩阵页面（/users/roles）',
      '新增：合同后端前缀匹配（EXHT/CUSTOMER-S-АББР）+ 分页支持',
      '新增：仪表板 KPI 卡片统一等高 + 汇率卡片优化',
      '优化：火车录入产品名/发货/收货单位改为下拉选择',
      '优化：3D 地图改为 Vite 静态资源 iframe 方案',
      '优化：汇率图表 Y 轴 10% padding 使波动可见',
      '优化：多处列表列宽响应式 + ellipsis 溢出隐藏',
      '优化：全局俄语 i18n 补漏',
      '变更：侧栏 dataEntry 菜单 + users 展开子菜单',
    ],
  },
  {
    version: '2.1.0',
    date: '2026-07-06',
    type: 'minor',
    changes: [
      '新增：汇率查询页面 + 仪表盘汇率/市场观察卡片',
      '新增：零售报表导出（Excel 日销表 + 分析报告）',
      '新增：称重数据导出按钮',
      '优化：3D 地图从 iframe 改为直接 Three.js 打包，加载速度大幅提升',
      '优化：地图按角色过滤点位（admin/operator/auditor/viewer）',
      '优化：俄语翻译补充与界面国际化完善',
    ],
  },
  {
    version: '2.0.0',
    date: '2026-07-05',
    type: 'major',
    changes: [
      '全新 Electron 桌面客户端架构',
      '仪表板改版：批发合计 + 合同 + 采购 + 零售趋势 ECharts',
      '合同管理：公司筛选 + 合同号排序 + 签约日期校验',
      '火车录入重构：发货单位/收货单位替换所属公司',
      '采购去重：entityName 改为 senderName',
      '用户管理：修改密码功能',
      '3D 地图嵌入',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-07-01',
    type: 'minor',
    changes: [
      '新增：经营助手覆盖全项目快照',
      '新增：零售模块手机/平板响应式适配',
      '重构：全量清理旧HTML/BAT/VBA，统一架构',
      '优化：Nginx 配置精简，旧路由改为 301 跳转',
      '优化：OilStation 快照脚本模块引用修复',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-06-15',
    type: 'major',
    changes: [
      '完整销售可视化数据平台（Web SPA）',
      '仪表盘：批发合计 + 合同 + 采购 + 零售趋势',
      '零售分析：按站点/产品/区域多维度钻取',
      '合同管理：增删改查 + 执行跟踪',
      '称重数据：录入 + 核对 + 详情导出',
      '汇率管理：每日汇率录入 + 图表分析',
      '3D 地图：站点/油库/客户标点展示',
      '用户角色权限：admin/operator/auditor/viewer',
      '双语界面：中文 + 俄语',
      '数据导出：Excel 报表 + 分析报告',
    ],
  },
];