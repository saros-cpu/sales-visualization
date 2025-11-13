import { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Layout, Menu, Tooltip, Typography } from 'antd';
import {
  LogoutOutlined,
  GlobalOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, type PermissionMap } from '@/contexts/AuthContext';
import { menuConfig, type MenuItem } from '@/config/menu';
import GlobalAiAssistant from '@/components/GlobalAiAssistant';
import logoSrc from '@/assets/logo.svg';

const { Sider, Content } = Layout;
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
      const nested = findOpenKeys(item.children, currentPath);
      if (nested.length > 0) return [item.key, ...nested];
      if (item.children.some(c => c.key.startsWith('/') && (currentPath === c.key || currentPath.startsWith(`${c.key}/`)))) {
        return [item.key];
      }
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

  const siderWidth = collapsed ? 72 : 216;
  const displayName = user?.displayName || user?.username || '-';
  const userInitial = displayName.trim().slice(0, 1).toUpperCase() || '?';
  const nextLang = i18n.language === 'ru' ? 'zh' : 'ru';
  const nextLangLabel = i18n.language === 'ru' ? '中文' : 'Русский';

  return (
    <Layout className="app-shell" style={{ height: '100vh', overflow: 'hidden', flexDirection: 'column' }}>
      <Layout style={{ flex: 1, minHeight: 0 }}>
        <Sider
          className="app-sider"
          collapsible
          collapsed={collapsed}
          collapsedWidth={72}
          width={216}
          trigger={null}
          onCollapse={setCollapsed}
          style={{ position: 'fixed', left: 0, top: 0, bottom: 0, height: '100vh', zIndex: 10 }}
        >
          <div className="app-sider-brand" style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            padding: collapsed ? '0' : '0 14px',
            borderBottom: '1px solid #f0f0f0',
          }}>
            <Tooltip title={collapsed ? '展开侧栏' : '收起侧栏'} placement="right">
              <button
                type="button"
                className={`app-sider-brand-button${collapsed ? ' is-collapsed' : ''}`}
                onClick={() => setCollapsed(value => !value)}
              >
                <img src={logoSrc} alt="" style={{ width: collapsed ? 30 : 36, height: collapsed ? 30 : 36, flexShrink: 0 }} />
                {!collapsed && (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1f1f1f', lineHeight: 1.2 }}>{t('app.title')}</div>
                    <div style={{ fontSize: 11, color: '#8c8c8c', lineHeight: 1.2 }}>Sales Desktop</div>
                  </div>
                )}
              </button>
            </Tooltip>
          </div>

          <div className="app-sider-scroll">
            <Menu
              className="app-menu"
              mode="inline"
              inlineCollapsed={collapsed}
              selectedKeys={[selectedKey]}
              defaultOpenKeys={openKeys}
              items={antMenuItems}
              onClick={({ key }) => {
                const nextKey = String(key);
                if (nextKey.startsWith('/')) navigate(nextKey);
              }}
              style={{ height: 'auto' }}
            />
          </div>

          <div className={`app-sider-footer${collapsed ? ' is-collapsed' : ''}`}>
            {collapsed ? (
              <>
                <Tooltip title={displayName} placement="right">
                  <Avatar size={34} className="app-sider-user-avatar" icon={displayName === '-' ? <UserOutlined /> : undefined}>
                    {displayName === '-' ? null : userInitial}
                  </Avatar>
                </Tooltip>
                <Tooltip title={nextLangLabel} placement="right">
                  <Button
                    className="app-sider-footer-button"
                    type="text"
                    icon={<GlobalOutlined />}
                    onClick={() => switchLang(nextLang)}
                  />
                </Tooltip>
                <Tooltip title={t('nav.logout')} placement="right">
                  <Button
                    className="app-sider-footer-button"
                    type="text"
                    danger
                    icon={<LogoutOutlined />}
                    onClick={logout}
                  />
                </Tooltip>
              </>
            ) : (
              <>
                <div className="app-sider-user">
                  <Avatar size={34} className="app-sider-user-avatar" icon={displayName === '-' ? <UserOutlined /> : undefined}>
                    {displayName === '-' ? null : userInitial}
                  </Avatar>
                  <div className="app-sider-user-text">
                    <Text className="app-sider-user-name" title={displayName}>{displayName}</Text>
                    <Text className="app-sider-user-role" title={user?.role}>{user?.role || '-'}</Text>
                  </div>
                </div>
                <div className="app-sider-actions">
                  <Button
                    className="app-sider-footer-button"
                    icon={<GlobalOutlined />}
                    size="small"
                    onClick={() => switchLang(nextLang)}
                  >
                    {nextLangLabel}
                  </Button>
                  <Button
                    className="app-sider-footer-button"
                    icon={<LogoutOutlined />}
                    size="small"
                    onClick={logout}
                  >
                    {t('nav.logout')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Sider>

        <Layout className="app-main-layout" style={{ marginLeft: siderWidth, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Content className="app-content" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Outlet />
          </Content>
          <GlobalAiAssistant />
        </Layout>
      </Layout>
    </Layout>
  );
}
