import { useMemo, useState } from 'react';
import { GlobalOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Segmented, Space, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import GlobeMap from '@/components/GlobeMap';
import KgzMap from '@/components/KgzMap';
import '@/lib/kgz-map/kgz-map.css';

export default function MapPage() {
  const { i18n } = useTranslation();
  const [mode, setMode] = useState<'kgz' | 'globe'>('kgz');
  const isRu = i18n.language.startsWith('ru');
  const copy = useMemo(() => ({
    kgz: isRu ? 'Карта Кыргызстана' : '吉尔吉斯地图',
    globe: isRu ? 'Глобус' : '地球视图',
    procurement: isRu ? 'Закупка' : '采购来源',
    exportCustomers: isRu ? 'Экспортные клиенты' : '出口客户',
  }), [isRu]);
  const mapHeight = 'calc(100vh - 158px)';

  return (
    <div style={{ minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as 'kgz' | 'globe')}
          options={[
            { label: copy.kgz, value: 'kgz', icon: <EnvironmentOutlined /> },
            { label: copy.globe, value: 'globe', icon: <GlobalOutlined /> },
          ]}
        />
        {mode === 'globe' && (
          <Space size={8} wrap>
            <Tag color="orange">{copy.procurement}</Tag>
            <Tag color="purple">{copy.exportCustomers}</Tag>
          </Space>
        )}
      </div>
      {mode === 'kgz' ? <KgzMap height={mapHeight} /> : <GlobeMap height={mapHeight} />}
    </div>
  );
}
