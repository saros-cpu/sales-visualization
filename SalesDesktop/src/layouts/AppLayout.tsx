import { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Typography } from 'antd';
import {
  DashboardOutlined, AuditOutlined, CarOutlined, ShoppingOutlined, BookOutlined,
  ImportOutlined, FileTextOutlined, ToolOutlined, DashOutlined, TeamOutlined,
  LogoutOutlined, GlobalOutlined, ShopOutlined, SettingOutlined, EnvironmentOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export default function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: t('nav.dashboard') },
    { key: '/retail', icon: <ShopOutlined />, label: t('nav.retail') },
    { key: '/exchange', icon: <DollarOutlined />, label: t('nav.exchange') },
    { key: '/weighing', icon: <AuditOutlined />, label: t('nav.weighing') },
    { key: '/train-entry', icon: <CarOutlined />, label: t('nav.dataEntry') },
    { key: '/aliases', icon: <BookOutlined />, label: t('nav.aliases') },
    { key: '/wholesale', icon: <ShoppingOutlined />, label: t('nav.wholesale') },
    { key: '/procurement', icon: <ImportOutlined />, label: t('nav.procurement') },
    { key: '/contracts', icon: <FileTextOutlined />, label: t('nav.contracts') },
    { key: '/materials', icon: <ToolOutlined />, label: t('nav.materials') },
    { key: '/transfer-loss', icon: <DashOutlined />, label: t('nav.transferLoss') },
    { key: '/map', icon: <EnvironmentOutlined />, label: t('nav.map') },
    {
      key: 'users-sub',
      icon: <TeamOutlined />,
      label: t('nav.users'),
      children: [
        { key: '/users', label: t('common.userList') },
        { key: '/users/roles', label: t('common.rolePermissions') },
      ],
    },
    { key: '/settings', icon: <SettingOutlined />, label: t('nav.settings') },
  ];

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
  };

  const siderWidth = collapsed ? 80 : 200;

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}
        style={{ position: 'fixed', left: 0, top: 0, bottom: 0, height: '100vh', zIndex: 10 }}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            {collapsed ? '⛽' : t('app.title')}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        <div style={{ flex: 1 }} />
      </Sider>
      <Layout style={{ marginLeft: siderWidth, transition: 'margin-left 0.2s' }}>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16 }}>
          <Dropdown menu={{ items: [
            { key: 'zh', label: t('settings.chinese'), onClick: () => switchLang('zh') },
            { key: 'ru', label: 'Русский', onClick: () => switchLang('ru') },
          ]}}>
            <Button icon={<GlobalOutlined />}>{i18n.language === 'ru' ? t('settings.russian') : t('settings.chinese')}</Button>
          </Dropdown>
          <Text>{user?.username}</Text>
          <Button icon={<LogoutOutlined />} onClick={logout}>{t('nav.logout')}</Button>
        </Header>
        <Content style={{ margin: 24, overflow: 'auto', height: 'calc(100vh - 64px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
