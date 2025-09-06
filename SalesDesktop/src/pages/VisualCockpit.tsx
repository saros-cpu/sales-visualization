import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { getCockpit, type CockpitComponent, type CockpitTemplate, type KpiDefinition } from '@/api/management';
import KpiCard, { KpiGrid, type KpiTone } from '@/components/ui/KpiCard';
import { useAuth } from '@/contexts/AuthContext';

const { Text } = Typography;

function titleFor(definition: KpiDefinition | undefined, language: string) {
  if (!definition) return '-';
  return language.startsWith('ru') ? definition.titleRu || definition.titleZh : definition.titleZh;
}

function templateTitle(template: CockpitTemplate | undefined, language: string) {
  if (!template) return '';
  return language.startsWith('ru') ? template.titleRu || template.titleZh : template.titleZh;
}

function unitFor(definition: KpiDefinition | undefined, language: string) {
  const unit = definition?.unit;
  if (!unit || !language.startsWith('ru')) return unit;
  return ({ '站': 'АЗС', '条': 'стр.', '份': 'шт.', '单': 'заяв.', '次': 'раз', '项': 'п.' } as Record<string, string>)[unit] || unit;
}

function toneFor(definition: KpiDefinition | undefined, value: number | string | undefined): KpiTone {
  if (!definition) return 'neutral';
  const numeric = Number(value || 0);
  if (definition.goodWhen === 'down' && numeric > 0) return 'danger';
  if (definition.goodWhen === 'up' && numeric > 0) return 'success';
  if (definition.group === 'system' && numeric === 0) return 'success';
  return 'neutral';
}

function RetailAlertPanel({ data }: { data: any }) {
  const { t, i18n } = useTranslation();
  const anomalies = data?.trendAnomalies || [];
  const suggestions = data?.suggestions || [];
  return (
    <Card size="small" title={t('cockpit.retailAlertSummary')} className="cockpit-component-card">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={anomalies.length ? 'red' : 'green'}>{t('retail.trendAnomaly')}: {anomalies.length}</Tag>
          <Tag color="blue">{t('retail.suggestions')}: {suggestions.length}</Tag>
          {data?.periodKey && <Tag>{data.periodKey}</Tag>}
        </Space>
        {suggestions.length ? suggestions.slice(0, 4).map((item: string, index: number) => (
          <div key={`${index}-${item}`} className="cockpit-suggestion-item">{item}</div>
        )) : <Text type="secondary">{t('common.noData')}</Text>}
        {data?.generatedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('retail.generatedAt')}: {i18n.language.startsWith('ru') ? data.generatedAt : data.generatedAt}
          </Text>
        )}
      </Space>
    </Card>
  );
}

export default function VisualCockpit() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useApiQuery(['cockpit', i18n.language], () => getCockpit(i18n.language), { refetchInterval: 120000 });
  const [selectedKey, setSelectedKey] = useState<string>();

  const templates = query.data?.templates || [];
  const selectedTemplate = useMemo(() => {
    if (!templates.length) return undefined;
    return templates.find(item => item.templateKey === selectedKey) || templates[0];
  }, [selectedKey, templates]);

  const catalogByKey = useMemo(() => {
    const map = new Map<string, KpiDefinition>();
    (query.data?.kpiCatalog || []).forEach(item => map.set(item.key, item));
    return map;
  }, [query.data?.kpiCatalog]);

  const renderComponent = (component: CockpitComponent) => {
    if (component.type === 'retail_alert') {
      return (
        <Col key={component.id} xs={24} xl={component.span || 24}>
          <RetailAlertPanel data={query.data?.retailAlert} />
        </Col>
      );
    }
    const definition = component.metricKey ? catalogByKey.get(component.metricKey) : undefined;
    const metric = component.metricKey ? query.data?.metrics?.[component.metricKey] : undefined;
    return (
      <Col key={component.id} xs={24} sm={12} md={8} xl={component.span || 6}>
        <KpiCard
          title={titleFor(definition, i18n.language)}
          value={metric?.value ?? 0}
          suffix={unitFor(definition, i18n.language)}
          precision={definition?.precision}
          goodWhen={definition?.goodWhen}
          tone={toneFor(definition, metric?.value)}
          tooltip={metric?.updatedAt ? `${t('common.updated')}: ${metric.updatedAt}` : undefined}
          onClick={() => {
            if (definition?.group === 'retail') navigate('/retail/alert');
            if (definition?.group === 'contracts') navigate('/contracts/view');
            if (definition?.group === 'materials') navigate('/materials');
            if (definition?.group === 'system') navigate('/system-health');
          }}
        />
      </Col>
    );
  };

  if (query.isLoading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (query.error) return <Alert type="error" message={t('common.error')} description={(query.error as Error).message} showIcon />;

  if (!selectedTemplate) {
    return <Card title={t('nav.visualCockpit')}><Empty description={t('cockpit.noTemplate')} /></Card>;
  }

  const components = selectedTemplate.config?.components || [];

  return (
    <div>
      <Row justify="space-between" className="page-toolbar">
        <Col>
          <h2>{t('nav.visualCockpit')}</h2>
          <Text type="secondary">{templateTitle(selectedTemplate, i18n.language)}</Text>
        </Col>
        <Col>
          <Space wrap>
            <Select
              value={selectedTemplate.templateKey}
              onChange={setSelectedKey}
              style={{ width: 220 }}
              options={templates.map(item => ({ value: item.templateKey, label: templateTitle(item, i18n.language) }))}
            />
            {user?.role === 'admin' && (
              <Button icon={<SettingOutlined />} onClick={() => navigate('/management-center')}>
                {t('cockpit.configure')}
              </Button>
            )}
          </Space>
        </Col>
      </Row>
      {components.length ? (
        <KpiGrid>
          {components.map(renderComponent)}
        </KpiGrid>
      ) : (
        <Card><Empty description={t('cockpit.emptyTemplate')} /></Card>
      )}
    </div>
  );
}
