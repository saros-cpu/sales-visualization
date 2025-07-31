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
    key: '/retail', icon: <ShopOutlined />, labelKey: 'nav.retailShort',
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
    key: '/wholesale', icon: <ShoppingOutlined />, labelKey: 'nav.wholesale',
    children: [
      { key: '/wholesale/overview', labelKey: 'wholesale.overview' },
      { key: '/wholesale/products', labelKey: 'wholesale.products' },
      { key: '/wholesale/customers', labelKey: 'wholesale.customers' },
      { key: '/wholesale/transfer', labelKey: 'wholesale.transfer' },
      { key: '/wholesale/trend', labelKey: 'wholesale.trend' },
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
