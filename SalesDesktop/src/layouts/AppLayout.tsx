import { useMemo, useState } from 'react';
import { Layout, Menu, Button, Dropdown, Typography } from 'antd';
import {
  LogoutOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { menuConfig, type MenuItem } from '@/config/menu';
import logoSrc from '@/assets/logo.svg';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function hasAccess(roles: string[] | undefined, userRole: string | undefined): boolean {
  if (!roles || roles.length === 0) return true;
  if (!userRole) return false;
  return roles.includes(userRole);
}

function flattenKeys(items: MenuItem[]): string[] {
  return items.flatMap(item => item.children ? [item.key, ...flattenKeys(item.children)] : [item.key]);
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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const filteredMenu = useMemo(() => {
    function filterItems(items: MenuItem[]): MenuItem[] {
      return items
        .filter(item => hasAccess(item.roles, user?.role))
        .map(item => ({
          ...item,
          children: item.children ? filterItems(item.children) : undefined,
        }));
    }
    return filterItems(menuConfig);
  }, [user?.role]);

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
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}
        style={{ position: 'fixed', left: 0, top: 0, bottom: 0, height: '100vh', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <img src={logoSrc} alt="" style={{ width: collapsed ? 28 : 36, height: collapsed ? 28 : 36 }} />
        </div>
        <div style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0, maxHeight: 'calc(100vh - 64px)' }}>
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
      <Layout style={{ marginLeft: siderWidth, height: '100%' }}>
        <Header style={{ 
          background: '#fff', 
          padding: 0, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          height: 36, 
          lineHeight: '36px',
          borderBottom: '1px solid #f0f0f0'
        }}>
          <div style={{ flex: 1, height: '100%', WebkitAppRegion: 'drag', display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>销售管理系统</span>
          </div>
          <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button icon={<GlobalOutlined />} size="small" onClick={() => switchLang(i18n.language === 'zh' ? 'ru' : 'zh')}>
              {i18n.language === 'ru' ? '中文' : 'Русский'}
            </Button>
            <Text style={{ fontSize: 14 }}>{user?.username}</Text>
            <Button icon={<LogoutOutlined />} size="small" onClick={logout}>
              {t('nav.logout')}
            </Button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ width: 12, height: 12, border: 'none', borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.close()} title="关闭" />
              <button style={{ width: 12, height: 12, border: 'none', borderRadius: '50%', background: '#febc2e', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.minimize()} title="最小化" />
              <button style={{ width: 12, height: 12, border: 'none', borderRadius: '50%', background: '#28c840', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.maximize()} title="最大化/还原" />
            </div>
          </div>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
