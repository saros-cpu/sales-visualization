import {
  ShopOutlined, DollarOutlined, CarOutlined, ShoppingOutlined,
  ImportOutlined, FileTextOutlined,
  TeamOutlined, BookOutlined, SettingOutlined, AuditOutlined, FileSearchOutlined,
  MonitorOutlined, AppstoreOutlined, ControlOutlined,
  DashboardOutlined, EnvironmentOutlined, BarChartOutlined, BankOutlined,
  CalendarOutlined, DatabaseOutlined, FileDoneOutlined, AlertOutlined,
  ToolOutlined, UserOutlined, ClusterOutlined, SafetyCertificateOutlined,
  PlusSquareOutlined, LineChartOutlined, SearchOutlined, PartitionOutlined,
  SwapOutlined, ProfileOutlined, CalculatorOutlined, MoneyCollectOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export interface MenuItem {
  key: string;
  icon?: ReactNode;
  labelKey: string;
  moduleKey?: string;
  permissionCode?: string;
  anyPermissionCodes?: string[];
  children?: MenuItem[];
  roles?: string[];
}

export const menuConfig: MenuItem[] = [
  {
    key: 'data-dashboard-sub', icon: <AppstoreOutlined />, labelKey: 'nav.dataDashboard',
    children: [
      { key: '/', icon: <DashboardOutlined />, labelKey: 'nav.visualCockpit', moduleKey: 'dashboard', permissionCode: 'dashboard:view' },
      { key: '/map', icon: <EnvironmentOutlined />, labelKey: 'nav.map', moduleKey: 'map' },
    ],
  },
  {
    key: 'business-analysis-sub', icon: <ShoppingOutlined />, labelKey: 'nav.businessAnalysis',
    children: [
      {
        key: '/retail', icon: <ShopOutlined />, labelKey: 'nav.retailShort', moduleKey: 'retail',
        children: [
          { key: '/retail/overview', icon: <BarChartOutlined />, labelKey: 'retail.overview' },
          { key: '/retail/region', icon: <PartitionOutlined />, labelKey: 'retail.region' },
          { key: '/retail/station', icon: <BankOutlined />, labelKey: 'retail.station' },
          { key: '/retail/monthly', icon: <CalendarOutlined />, labelKey: 'retail.monthly' },
          { key: '/retail/resource', icon: <DatabaseOutlined />, labelKey: 'retail.resource' },
          { key: '/retail/transfer', icon: <SwapOutlined />, labelKey: 'retail.transfer' },
          { key: '/retail/self-use', icon: <ToolOutlined />, labelKey: 'retail.selfUse' },
          { key: '/retail/profit', icon: <CalculatorOutlined />, labelKey: 'retail.profit', moduleKey: 'profit', permissionCode: 'profit:view' },
          { key: '/retail/report', icon: <FileDoneOutlined />, labelKey: 'retail.report' },
          { key: '/retail/alert', icon: <AlertOutlined />, labelKey: 'retail.alert' },
        ],
      },
      {
        key: '/wholesale', icon: <ShoppingOutlined />, labelKey: 'nav.wholesale', moduleKey: 'wholesale',
        children: [
          { key: '/wholesale/overview', icon: <BarChartOutlined />, labelKey: 'wholesale.overview' },
          { key: '/wholesale/products', icon: <AppstoreOutlined />, labelKey: 'wholesale.products' },
          { key: '/wholesale/customers', icon: <TeamOutlined />, labelKey: 'wholesale.customers' },
          { key: '/wholesale/transfer', icon: <SwapOutlined />, labelKey: 'wholesale.transfer' },
          { key: '/wholesale/trend', icon: <LineChartOutlined />, labelKey: 'wholesale.trend' },
          { key: '/wholesale/query', icon: <SearchOutlined />, labelKey: 'wholesale.query' },
        ],
      },
      { key: '/procurement', icon: <ImportOutlined />, labelKey: 'nav.procurement', moduleKey: 'procurement' },
      { key: '/exchange', icon: <DollarOutlined />, labelKey: 'nav.exchange', moduleKey: 'exchange' },
      { key: '/reports', icon: <FileDoneOutlined />, labelKey: 'nav.reports', anyPermissionCodes: ['retail:export', 'wholesale:export'] },
    ],
  },
  {
    key: 'business-processing-sub', icon: <CarOutlined />, labelKey: 'nav.businessProcessing',
    children: [
      { key: '/train-entry', icon: <CarOutlined />, labelKey: 'nav.dataEntry', moduleKey: 'train_entry' },
      { key: '/materials', icon: <DatabaseOutlined />, labelKey: 'nav.materials', moduleKey: 'materials' },
    ],
  },
  { key: '/knowledge', icon: <BookOutlined />, labelKey: 'nav.knowledgeBase', moduleKey: 'knowledge', permissionCode: 'knowledge:view' },
  {
    key: '/contracts', icon: <FileTextOutlined />, labelKey: 'nav.contracts', moduleKey: 'contracts',
    children: [
      { key: '/contracts/view', icon: <ProfileOutlined />, labelKey: 'nav.contractView' },
      { key: '/contracts/add', icon: <PlusSquareOutlined />, labelKey: 'nav.contractAdd', permissionCode: 'contracts:create' },
    ],
  },
  {
    key: 'management-sub', icon: <TeamOutlined />, labelKey: 'nav.management',
    children: [
      {
        key: 'user-permissions-sub', icon: <SafetyCertificateOutlined />, labelKey: 'nav.userPermissions',
        children: [
          { key: '/users', icon: <UserOutlined />, labelKey: 'nav.userManagement', moduleKey: 'users', permissionCode: 'users:view' },
          { key: '/users/organization', icon: <ClusterOutlined />, labelKey: 'common.organizationPermissions', anyPermissionCodes: ['users:manage', 'roles:manage', 'departments:manage'] },
        ],
      },
      { key: '/management-center', icon: <ControlOutlined />, labelKey: 'nav.configCenter', moduleKey: 'management', permissionCode: 'management:view' },
      { key: '/profit-cost-items', icon: <MoneyCollectOutlined />, labelKey: 'nav.profitCostItems', moduleKey: 'profit', permissionCode: 'profit:view' },
      { key: '/aliases', icon: <BookOutlined />, labelKey: 'nav.referenceMaintenance', moduleKey: 'aliases' },
      { key: '/weighing', icon: <AuditOutlined />, labelKey: 'nav.weighing', moduleKey: 'weighing' },
      { key: '/system-health', icon: <MonitorOutlined />, labelKey: 'nav.systemHealth', moduleKey: 'system_health', permissionCode: 'system_health:view' },
      { key: '/audit-logs', icon: <FileSearchOutlined />, labelKey: 'nav.auditLogs', moduleKey: 'audit_logs', permissionCode: 'audit_logs:view' },
    ],
  },
  { key: '/settings', icon: <SettingOutlined />, labelKey: 'nav.settings', moduleKey: 'settings' },
];
