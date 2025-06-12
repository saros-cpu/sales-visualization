// 版本号管理 — 语义化版本 (SemVer)
// MAJOR: 不兼容的 API 或架构变更
// MINOR: 新增功能（向后兼容）
// PATCH: Bug 修复、小优化（向后兼容）

export const VERSION = '2.2.1';
export const BUILD_DATE = '2026-07-08';

export interface ChangelogEntry {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
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
];