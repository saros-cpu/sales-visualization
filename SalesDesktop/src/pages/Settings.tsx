import { useState } from 'react';
import { Card, Typography, Button, Space, Descriptions, Modal, Form, Input, message } from 'antd';
import { GlobalOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { changePassword } from '@/api/client';

import { VERSION, BUILD_DATE, CHANGELOG } from '@/version';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const switchLang = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('lang', lang);
  };

  const handleChangePw = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await changePassword(values.oldPassword, values.newPassword);
      message.success(t('common.save'));
      setPwModalOpen(false);
      form.resetFields();
    } catch (e: any) {
      message.error(e.response?.data?.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <Card title={t('common.settings')}>
      <Descriptions column={1} bordered size="small" style={{ marginBottom: 24 }}>
        <Descriptions.Item label={t('common.version')}>{VERSION}</Descriptions.Item>
        <Descriptions.Item label={t('common.backendUrl')}>http://127.0.0.1:8900</Descriptions.Item>
        <Descriptions.Item label={t('common.currentUser')}>{user?.username} ({user?.role})</Descriptions.Item>
        <Descriptions.Item label={t('common.buildDate')}>{BUILD_DATE}</Descriptions.Item>
      </Descriptions>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small" title={t('common.langSwitch')}>
          <Space>
            <Button icon={<GlobalOutlined />} type={i18n.language === 'zh' ? 'primary' : 'default'} onClick={() => switchLang('zh')}>{t('settings.chinese')}</Button>
            <Button icon={<GlobalOutlined />} type={i18n.language === 'ru' ? 'primary' : 'default'} onClick={() => switchLang('ru')}>Русский</Button>
          </Space>
        </Card>
        <Card size="small" title={t('common.about')}>
          <Typography.Text style={{ whiteSpace: 'pre-line' }}>
            {t('app.title')} v{VERSION}
            {'\n\n'}{t('common.changelog')}
            {CHANGELOG.map((entry) => `\n\n${entry.version} (${entry.date})\n${entry.changes.map((c) => `  · ${c}`).join('\n')}`).join('')}
          </Typography.Text>
        </Card>
        <Card size="small" title={t('common.resetPassword')}>
          <Button icon={<LockOutlined />} onClick={() => setPwModalOpen(true)}>{t('common.resetPassword')}</Button>
        </Card>
      </Space>

      <Modal title={t('common.resetPassword')} open={pwModalOpen} onCancel={() => setPwModalOpen(false)}
        onOk={handleChangePw} confirmLoading={submitting}>
        <Form form={form} layout="vertical">
          <Form.Item name="oldPassword" label={t('common.oldPassword')} rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label={t('common.newPassword')} rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
