import { useEffect, useState } from 'react';
import { Table, Card, Checkbox, Button, Spin, Alert, message, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import client from '@/api/client';

interface ModuleItem {
  id: number;
  moduleKey: string;
  moduleName: string;
}

interface Permission {
  role: string;
  moduleKey: string;
  granted: boolean;
}

export default function UserRoles() {
  const { t, i18n } = useTranslation();
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const roles = ['admin', 'operator', 'auditor', 'viewer'];
  const roleLabels: Record<string, string> = {
    admin: t('users.admin'),
    operator: t('users.operator'),
    auditor: t('users.auditor'),
    viewer: t('users.viewer'),
  };

  // 模块名称中俄对照（从数据库moduleKey映射）
  const moduleNameZh: Record<string, string> = {
    dashboard: '仪表板', data_entry: '数据录入', train_entry: '火车装卸车',
    contract_mgmt: '合同管理', monthly_volume: '月拉运量', data_view: '数据查看',
    wholesale_view: '批发', transfer_view: '外运', procurement_view: '采购',
    processing_view: '代加工', retail_view: '零售', contract_view: '合同查看',
    reports: '报表打印', print_detail: '明细表打印', print_summary: '汇总表打印',
    print_loss: '损耗分析报告', print_retail: '零售分析报告',
    settings: '设置', user_mgmt: '用户管理', about: '关于系统',
  };
  const moduleNameRu: Record<string, string> = {
    dashboard: 'Панель', data_entry: 'Ввод данных', train_entry: 'Ж/д налив',
    contract_mgmt: 'Договоры', monthly_volume: 'Объем за месяц', data_view: 'Просмотр',
    wholesale_view: 'Опт', transfer_view: 'Перевозки', procurement_view: 'Закупки',
    processing_view: 'Переработка', retail_view: 'Розница', contract_view: 'Договоры',
    reports: 'Отчеты', print_detail: 'Детали', print_summary: 'Сводка',
    print_loss: 'Потери', print_retail: 'Розница',
    settings: 'Настройки', user_mgmt: 'Пользователи', about: 'О системе',
  };
  const getModuleName = (record: ModuleItem) => {
    if (i18n.language === 'ru') return moduleNameRu[record.moduleKey] || record.moduleName;
    return moduleNameZh[record.moduleKey] || record.moduleName;
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [modRes, permRes] = await Promise.all([
        client.get('/users/permissions/modules'),
        client.get('/users/permissions'),
      ]);
      setModules(modRes.data.data || []);
      setPermissions(permRes.data.data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const isGranted = (modKey: string, role: string) => {
    return permissions.some((p) => p.moduleKey === modKey && p.role === role && p.granted);
  };

  const togglePermission = (modKey: string, role: string, checked: boolean) => {
    setPermissions((prev) => {
      const next = prev.filter((p) => !(p.moduleKey === modKey && p.role === role));
      next.push({ role, moduleKey: modKey, granted: checked });
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await client.put('/users/permissions', { permissions });
      message.success(t('common.save'));
    } catch (e: any) {
      message.error(e.response?.data?.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
  if (error) return <Alert type="error" message={t('common.error')} description={error} showIcon />;

  const columns = [
    { title: t('common.module'), dataIndex: 'moduleName', key: 'moduleName', width: 200, render: (_: string, record: ModuleItem) => getModuleName(record) },
    ...roles.map((role) => ({
      title: roleLabels[role],
      key: role,
      width: 120,
      render: (_: unknown, record: ModuleItem) => (
        <Checkbox
          checked={isGranted(record.moduleKey, role)}
          onChange={(e) => togglePermission(record.moduleKey, role, e.target.checked)}
          disabled={role === 'admin'}
        />
      ),
    })),
  ];

  return (
    <Card
      title={t('common.rolePermissions')}
      extra={<Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>{t('common.save')}</Button>}
    >
      <Table
        dataSource={modules}
        columns={columns}
        rowKey="id"
        pagination={false}
        size="small"
      />
    </Card>
  );
}
