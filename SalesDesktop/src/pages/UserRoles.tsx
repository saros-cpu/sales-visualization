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
  const { t } = useTranslation();
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
    { title: t('common.module'), dataIndex: 'moduleName', key: 'moduleName', width: 200 },
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
