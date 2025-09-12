import {
  ShopOutlined, DollarOutlined, CarOutlined, ShoppingOutlined,
  ImportOutlined, FileTextOutlined, ToolOutlined, DashOutlined, EnvironmentOutlined,
  TeamOutlined, BookOutlined, SettingOutlined, AuditOutlined, FileSearchOutlined,
  MonitorOutlined, AppstoreOutlined, ControlOutlined,
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
  { key: '/', icon: <AppstoreOutlined />, labelKey: 'nav.visualCockpit', moduleKey: 'dashboard', permissionCode: 'dashboard:view' },
  {
    key: '/retail', icon: <ShopOutlined />, labelKey: 'nav.retailShort', moduleKey: 'retail',
    children: [
      { key: '/retail/overview', labelKey: 'retail.overview' },
      { key: '/retail/region', labelKey: 'retail.region' },
      { key: '/retail/station', labelKey: 'retail.station' },
      { key: '/retail/monthly', labelKey: 'retail.monthly' },
      { key: '/retail/resource', labelKey: 'retail.resource' },
      { key: '/retail/report', labelKey: 'retail.report' },
      { key: '/retail/alert', labelKey: 'retail.alert' },
      { key: '/retail/self-use', labelKey: 'retail.selfUse' },
    ],
  },
  {
    key: '/wholesale', icon: <ShoppingOutlined />, labelKey: 'nav.wholesale', moduleKey: 'wholesale',
    children: [
      { key: '/wholesale/overview', labelKey: 'wholesale.overview' },
      { key: '/wholesale/products', labelKey: 'wholesale.products' },
      { key: '/wholesale/customers', labelKey: 'wholesale.customers' },
      { key: '/wholesale/transfer', labelKey: 'wholesale.transfer' },
      { key: '/wholesale/trend', labelKey: 'wholesale.trend' },
      { key: '/wholesale/query', labelKey: 'wholesale.query' },
    ],
  },
  { key: '/exchange', icon: <DollarOutlined />, labelKey: 'nav.exchange', moduleKey: 'exchange' },
  { key: '/train-entry', icon: <CarOutlined />, labelKey: 'nav.dataEntry', moduleKey: 'train_entry' },
  { key: '/procurement', icon: <ImportOutlined />, labelKey: 'nav.procurement', moduleKey: 'procurement' },
  { key: '/contracts', icon: <FileTextOutlined />, labelKey: 'nav.contracts', moduleKey: 'contracts', children: [
    { key: '/contracts/view', labelKey: 'nav.contractView' },
    { key: '/contracts/add', labelKey: 'nav.contractAdd', permissionCode: 'contracts:create' },
  ] },
  { key: '/materials', icon: <ToolOutlined />, labelKey: 'nav.materials', moduleKey: 'materials' },
  { key: '/transfer-loss', icon: <DashOutlined />, labelKey: 'nav.transferLoss', moduleKey: 'transfer_loss' },
  { key: '/map', icon: <EnvironmentOutlined />, labelKey: 'nav.map', moduleKey: 'map' },
  {
    key: 'management-sub', icon: <TeamOutlined />, labelKey: 'nav.management',
    roles: ['admin'],
    children: [
      { key: '/users', labelKey: 'common.userList', moduleKey: 'users', permissionCode: 'users:view' },
      { key: '/users/organization', labelKey: 'common.organizationPermissions', anyPermissionCodes: ['users:manage', 'roles:manage', 'departments:manage'] },
      { key: '/aliases', icon: <BookOutlined />, labelKey: 'nav.aliases', moduleKey: 'aliases' },
      { key: '/weighing', icon: <AuditOutlined />, labelKey: 'nav.weighing', moduleKey: 'weighing' },
      { key: '/audit-logs', icon: <FileSearchOutlined />, labelKey: 'nav.auditLogs', moduleKey: 'audit_logs', permissionCode: 'audit_logs:view' },
      { key: '/system-health', icon: <MonitorOutlined />, labelKey: 'nav.systemHealth', moduleKey: 'system_health', permissionCode: 'system_health:view' },
      { key: '/management-center', icon: <ControlOutlined />, labelKey: 'nav.managementCenter', roles: ['admin'] },
    ],
  },
  { key: '/settings', icon: <SettingOutlined />, labelKey: 'nav.settings', moduleKey: 'settings' },
];
