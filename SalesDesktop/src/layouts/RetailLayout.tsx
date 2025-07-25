import { Outlet } from 'react-router-dom';
import { Button, Typography } from 'antd';
import { GlobalOutlined, LogoutOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';

export default function RetailLayout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
  };

  return (
    <>
      <div style={{ 
        height: 36, 
        background: '#fff', 
        borderBottom: '1px solid #f0f0f0',
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        padding: '0 16px',
        WebkitAppRegion: 'drag'
      }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>零售管理</span>
        <div style={{ 
          WebkitAppRegion: 'no-drag',
          display: 'flex', 
          alignItems: 'center', 
          gap: 12
        }}>
          <Button icon={<GlobalOutlined />} size="small" onClick={() => switchLang(i18n.language === 'zh' ? 'ru' : 'zh')}>
            {i18n.language === 'ru' ? '中文' : 'Русский'}
          </Button>
          <Typography.Text style={{ fontSize: 14 }}>{user?.username}</Typography.Text>
          <Button icon={<LogoutOutlined />} size="small" onClick={logout}>
            {t('nav.logout')}
          </Button>
          <div style={{ display: 'flex', gap: 4 }}>
            <button style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.close()} />
            <button style={{ width: 12, height: 12, borderRadius: '50%', background: '#febc2e', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.minimize()} />
            <button style={{ width: 12, height: 12, borderRadius: '50%', background: '#28c840', cursor: 'pointer', WebkitAppRegion: 'no-drag' }} onClick={() => window.electronAPI?.maximize()} />
          </div>
        </div>
      </div>
      <Outlet />
    </>
  );
}
