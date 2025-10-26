import { useState, useEffect, useCallback } from 'react';
import { Card, Typography, Button, Space, Descriptions, Modal, Form, Input, message, Progress } from 'antd';
import { GlobalOutlined, LockOutlined, ReloadOutlined, DownloadOutlined, SyncOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { changePassword } from '@/api/client';
import { API_HOST } from '@/api/http';

import { VERSION, BUILD_DATE, CHANGELOG } from '@/version';

const UPDATE_MODULE_MISSING = '当前客户端未检测到更新模块，请安装最新版客户端后再使用自动更新';
const AUTO_UPDATE_HINT = '客户端启动后会自动检查更新，发现新版本会自动下载，下载完成后提示重启安装。';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  const [showAllVersions, setShowAllVersions] = useState(false);

  useEffect(() => {
    const updater = window.updater;
    if (!updater) {
      setUpdateStatus({ status: 'unsupported', message: UPDATE_MODULE_MISSING, autoCheck: false });
      return;
    }

    let mounted = true;
    updater.getStatus()
      .then(status => {
        if (mounted) setUpdateStatus(status);
      })
      .catch(() => {});
    const cleanup = updater.onStatusChange(status => {
      if (mounted) setUpdateStatus(status);
    });
    return () => {
      mounted = false;
      cleanup();
    };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (!window.updater) {
      setUpdateStatus({ status: 'unsupported', message: UPDATE_MODULE_MISSING, autoCheck: false });
      message.warning(UPDATE_MODULE_MISSING);
      return;
    }
    try {
      await window.updater.checkForUpdates();
    } catch (error) {
      setUpdateStatus({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    if (!window.updater) {
      setUpdateStatus({ status: 'unsupported', message: UPDATE_MODULE_MISSING, autoCheck: false });
      message.warning(UPDATE_MODULE_MISSING);
      return;
    }
    try {
      await window.updater.downloadUpdate();
    } catch (error) {
      setUpdateStatus({ status: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const handleRestart = useCallback(async () => {
    if (!window.updater) {
      message.warning(UPDATE_MODULE_MISSING);
      return;
    }
    await window.updater.restartApp();
  }, []);

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
        <Descriptions.Item label={t('common.backendUrl')}>{API_HOST}</Descriptions.Item>
        <Descriptions.Item label={t('common.currentUser')}>{user?.username} ({user?.role})</Descriptions.Item>
        <Descriptions.Item label={t('common.buildDate')}>{BUILD_DATE}</Descriptions.Item>
      </Descriptions>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small" title={t('common.langSwitch')}>
          <Space wrap>
            <Button icon={<GlobalOutlined />} type={i18n.language === 'zh' ? 'primary' : 'default'} onClick={() => switchLang('zh')}>{t('settings.chinese')}</Button>
            <Button icon={<GlobalOutlined />} type={i18n.language === 'ru' ? 'primary' : 'default'} onClick={() => switchLang('ru')}>Русский</Button>
          </Space>
        </Card>
        <Card size="small" title={t('settings.appUpdate')}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">{AUTO_UPDATE_HINT}</Typography.Text>
            {(updateStatus.status === 'idle' || updateStatus.status === 'not-available' || updateStatus.status === 'error' || updateStatus.status === 'unsupported') && (
              <Button icon={<SyncOutlined />} onClick={handleCheckUpdate}>{t('settings.update')}</Button>
            )}
            {updateStatus.status === 'unsupported' && (
              <Typography.Text type="danger">{updateStatus.message || UPDATE_MODULE_MISSING}</Typography.Text>
            )}
            {updateStatus.status === 'checking' && (
              <Space><SyncOutlined spin />{t('settings.checking')}</Space>
            )}
            {updateStatus.status === 'not-available' && (
              <Typography.Text type="secondary">{t('settings.upToDate')} (v{VERSION})</Typography.Text>
            )}
            {updateStatus.status === 'available' && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text type="warning">{t('settings.updateAvailable', { version: updateStatus.version })}，正在自动下载...</Typography.Text>
                <Button icon={<DownloadOutlined />} type="primary" onClick={handleDownloadUpdate}>{t('settings.downloadNow')}</Button>
              </Space>
            )}
            {updateStatus.status === 'downloading' && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text>{t('settings.downloading', { percent: updateStatus.percent })}</Typography.Text>
                <Progress percent={updateStatus.percent || 0} showInfo={false} />
              </Space>
            )}
            {updateStatus.status === 'downloaded' && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Text type="success">{t('settings.updateReady')}</Typography.Text>
                <Button icon={<ReloadOutlined />} type="primary" onClick={handleRestart}>{t('settings.restartNow')}</Button>
              </Space>
            )}
            {updateStatus.status === 'error' && (
              <Space wrap>
                <Typography.Text type="danger">{t('settings.updateError')}: {updateStatus.message}</Typography.Text>
                <Button size="small" onClick={handleCheckUpdate}>{t('common.retry')}</Button>
              </Space>
            )}
          </Space>
        </Card>
        <Card size="small" title={t('common.about')}>
          <Typography.Paragraph style={{ whiteSpace: 'pre-line', marginBottom: 4 }}>
            {t('app.title')} v{VERSION}
          </Typography.Paragraph>
          <div style={{ maxHeight: showAllVersions ? 400 : 180, overflow: 'auto', transition: 'max-height 0.3s' }}>
            <Typography.Text style={{ whiteSpace: 'pre-line', fontSize: 12, color: '#888' }}>
              {t('common.changelog')}
              {(showAllVersions ? CHANGELOG : CHANGELOG.slice(0, 2)).map((entry) =>
                `\n\n${entry.version} (${entry.date})\n${entry.changes.map((c) => `  · ${c}`).join('\n')}`
              ).join('')}
            </Typography.Text>
          </div>
          {CHANGELOG.length > 2 && (
            <Button type="link" size="small" onClick={() => setShowAllVersions(!showAllVersions)}
              icon={showAllVersions ? <UpOutlined /> : <DownOutlined />}>
              {showAllVersions ? '收起' : `展开全部 (共 ${CHANGELOG.length} 个版本)`}
            </Button>
          )}
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
          <Form.Item name="newPassword" label={t('common.newPassword')} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
