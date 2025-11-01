import { useState } from 'react';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { changePassword } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import logoSrc from '@/assets/logo.svg';

export default function ForceChangePassword() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: { oldPassword: string; newPassword: string; confirmPassword: string }) => {
    if (values.newPassword !== values.confirmPassword) {
      message.error('两次输入的新密码不一致');
      return;
    }
    if (values.oldPassword === values.newPassword) {
      message.error('新密码不能与旧密码相同');
      return;
    }
    setLoading(true);
    try {
      await changePassword(values.oldPassword, values.newPassword);
      message.success('密码已修改，请重新登录');
      logout();
      window.location.hash = '#/login';
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f0f2f5' }}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0, padding: 24 }}>
        <img src={logoSrc} alt="" style={{ width: 72, height: 72, marginBottom: 20 }} />
        <Card style={{ width: 420, maxWidth: '100%' }}>
          <Typography.Title level={4} style={{ marginTop: 0, textAlign: 'center' }}>首次登录请修改密码</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 24 }}>
            账号由管理员创建后，需要先设置个人密码才能继续使用系统。
          </Typography.Paragraph>
          <Form onFinish={onFinish} layout="vertical">
            <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8, message: '新密码至少 8 位' }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请再次输入新密码' }]}>
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              修改密码
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
