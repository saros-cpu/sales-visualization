import { Button, Empty, Result, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

type PageStateStatus = 'loading' | 'error' | 'empty' | 'no-permission';

interface PageStateProps {
  status: PageStateStatus;
  title?: string;
  description?: string;
  onRetry?: () => void;
}

const centerStyle = {
  minHeight: 360,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
} as const;

export default function PageState({ status, title, description, onRetry }: PageStateProps) {
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <div style={centerStyle}>
        <div style={{ textAlign: 'center' }}>
          <Spin />
          <div style={{ marginTop: 12, color: 'rgba(0, 0, 0, 0.45)' }}>
            {title || t('common.loading')}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div style={centerStyle}>
        <Empty description={description || title || t('common.noData')} />
      </div>
    );
  }

  const isPermission = status === 'no-permission';
  return (
    <Result
      status={isPermission ? '403' : 'error'}
      title={title || (isPermission ? t('common.noPermission') : t('common.error'))}
      subTitle={description}
      extra={onRetry ? (
        <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : undefined}
    />
  );
}
