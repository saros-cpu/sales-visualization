import { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Button, Dropdown, Typography } from 'antd';
import {
  LogoutOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, type PermissionMap } from '@/contexts/AuthContext';
import { menuConfig, type MenuItem } from '@/config/menu';
import WindowTitleBar from '@/components/WindowTitleBar';
import GlobalAiAssistant from '@/components/GlobalAiAssistant';
import logoSrc from '@/assets/logo.svg';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function hasAccess(roles: string[] | undefined, userRole: string | undefined): boolean {
  if (!roles || roles.length === 0) return true;
  if (!userRole) return false;
  return roles.includes(userRole);
}

function canViewModule(
  moduleKey: string | undefined,
  permissions: PermissionMap,
  permissionCodes: string[],
  userRole: string | undefined,
): boolean {
  if (!moduleKey) return true;
  if (userRole === 'admin') return true;
  if (permissions['*']?.view) return true;
  if (permissionCodes.includes(`${moduleKey}:view`)) return true;
  return Boolean(permissions[moduleKey]?.view);
}

function hasPermissionCode(
  permissionCode: string | undefined,
  permissionCodes: string[],
  userRole: string | undefined,
): boolean {
  if (!permissionCode) return true;
  if (userRole === 'admin') return true;
  if (permissionCodes.includes(permissionCode) || permissionCodes.includes('*')) return true;
  const [moduleKey] = permissionCode.split(':');
  return Boolean(moduleKey && permissionCodes.includes(`${moduleKey}:*`));
}

function hasAnyPermissionCode(
  anyPermissionCodes: string[] | undefined,
  permissionCodes: string[],
  userRole: string | undefined,
): boolean {
  if (!anyPermissionCodes || anyPermissionCodes.length === 0) return true;
  return anyPermissionCodes.some((permissionCode) => hasPermissionCode(permissionCode, permissionCodes, userRole));
}

function flattenKeys(items: MenuItem[]): string[] {
  return items.flatMap(item => item.children ? [item.key, ...flattenKeys(item.children)] : [item.key]);
}

function findFirstPath(items: MenuItem[]): string | undefined {
  for (const item of items) {
    if (item.key.startsWith('/') && !item.children?.length) return item.key;
    const childPath = item.children ? findFirstPath(item.children) : undefined;
    if (childPath) return childPath;
    if (item.key.startsWith('/')) return item.key;
  }
  return undefined;
}

function hasPathAccess(items: MenuItem[], currentPath: string): boolean {
  const keys = flattenKeys(items).filter(key => key.startsWith('/'));
  if (currentPath === '/') return keys.includes('/');
  return keys.some(key => key !== '/' && (currentPath === key || currentPath.startsWith(`${key}/`)));
}

function findOpenKeys(items: MenuItem[], currentPath: string): string[] {
  for (const item of items) {
    if (item.children) {
      if (item.children.some(c => currentPath.startsWith(c.key))) {
        return [item.key];
      }
      const nested = findOpenKeys(item.children, currentPath);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, permissions, permissionCodes, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const filteredMenu = useMemo(() => {
    function filterItems(items: MenuItem[], inheritedModuleKey?: string): MenuItem[] {
      const result: MenuItem[] = [];
      for (const item of items) {
        const moduleKey = item.moduleKey ?? inheritedModuleKey;
        if (
          !hasAccess(item.roles, user?.role) ||
          !canViewModule(moduleKey, permissions, permissionCodes, user?.role) ||
          !hasPermissionCode(item.permissionCode, permissionCodes, user?.role) ||
          !hasAnyPermissionCode(item.anyPermissionCodes, permissionCodes, user?.role)
        ) {
          continue;
        }
        const children = item.children ? filterItems(item.children, moduleKey) : undefined;
        if (item.children && (!children || children.length === 0)) continue;
        result.push({ ...item, children });
      }
      return result;
    }
    return filterItems(menuConfig);
  }, [permissions, permissionCodes, user?.role]);

  useEffect(() => {
    if (!filteredMenu.length || hasPathAccess(filteredMenu, location.pathname)) return;
    const fallbackPath = findFirstPath(filteredMenu);
    if (fallbackPath) navigate(fallbackPath, { replace: true });
  }, [filteredMenu, location.pathname, navigate]);

  const antMenuItems = useMemo(() => {
    function toAnt(items: MenuItem[]): any[] {
      return items.map(item => ({
        key: item.key,
        icon: item.icon,
        label: t(item.labelKey),
        children: item.children ? toAnt(item.children) : undefined,
      }));
    }
    return toAnt(filteredMenu);
  }, [filteredMenu, t]);

  const selectedKey = useMemo(() => {
    const all = flattenKeys(filteredMenu);
    if (all.includes(location.pathname)) return location.pathname;
    const matched = all.filter(k => k !== '/' && location.pathname.startsWith(k));
    return matched.sort((a, b) => b.length - a.length)[0] || '/';
  }, [location.pathname, filteredMenu]);

  const openKeys = useMemo(() => findOpenKeys(filteredMenu, location.pathname), [filteredMenu, location.pathname]);

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
  };

  const siderWidth = collapsed ? 80 : 200;

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', flexDirection: 'column' }}>
      <WindowTitleBar title="销售管理系统" />
      <Layout style={{ flex: 1, minHeight: 0 }}>
        <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}
          style={{ position: 'fixed', left: 0, top: 32, bottom: 0, height: 'calc(100vh - 32px)', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
            <img src={logoSrc} alt="" style={{ width: collapsed ? 28 : 36, height: collapsed ? 28 : 36 }} />
          </div>
          <div style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 32px - 64px)' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              defaultOpenKeys={openKeys}
              items={antMenuItems}
              onClick={({ key }) => navigate(key)}
              style={{ height: 'auto' }}
            />
          </div>
        </Sider>
        <Layout style={{ marginLeft: siderWidth, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Header style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            height: 36,
            lineHeight: '36px',
            borderBottom: '1px solid #f0f0f0',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button icon={<GlobalOutlined />} size="small" onClick={() => switchLang(i18n.language === 'zh' ? 'ru' : 'zh')}>
                {i18n.language === 'ru' ? '中文' : 'Русский'}
              </Button>
              <Text style={{ fontSize: 14 }}>{user?.username}</Text>
              <Button icon={<LogoutOutlined />} size="small" onClick={logout}>
                {t('nav.logout')}
              </Button>
            </div>
          </Header>
          <Content className="app-content" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Outlet />
          </Content>
          <GlobalAiAssistant />
        </Layout>
      </Layout>
    </Layout>
  );
}
