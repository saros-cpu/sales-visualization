import { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import WindowTitleBar from '@/components/WindowTitleBar';
import logoSrc from '@/assets/logo.svg';

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      await login(values.username, values.password);
      window.location.hash = '#/';
    } catch {
      message.error(t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f0f2f5' }}>
      <WindowTitleBar title="销售管理系统" />
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}>
        <img src={logoSrc} alt="" style={{ width: 80, height: 80, marginBottom: 24 }} />
        <Card style={{ width: 400 }}>
          <Form onFinish={onFinish} layout="vertical">
            <Form.Item name="username" rules={[{ required: true, message: t('login.username') }]}>
              <Input prefix={<UserOutlined />} placeholder={t('login.username')} />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: t('login.password') }]}>
              <Input.Password prefix={<LockOutlined />} placeholder={t('login.password')} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block>
                {t('login.submit')}
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </div>
    </div>
  );
}
