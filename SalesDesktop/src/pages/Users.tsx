import { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, Select, Switch, message, Tag } from 'antd';
import { PlusOutlined, EditOutlined, KeyOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { getUsers, createUser, updateUser, resetPassword, UserRecord } from '@/api/users';
import { getOrganizationOverview, type DepartmentRecord, type RoleRecord } from '@/api/organization';

export default function Users() {
  const { t, i18n } = useTranslation();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = currentUser?.role === 'admin';
  const canViewUsers = isAdmin;
  const canManageUsers = isAdmin;
  const canCreateUser = isAdmin;
  const canUpdateUser = isAdmin;
  const canResetUserPassword = isAdmin;
  const isRu = i18n.language.startsWith('ru');
  const departmentLabel = isRu ? 'Отдел' : '部门';
  const displayNameLabel = isRu ? 'Отображаемое имя' : t('common.displayName');
  const roleNameMap: Record<string, string> = {
    admin: t('users.admin'),
    leadership: isRu ? 'Руководящий состав' : '领导层',
    operator: t('users.operator'),
    auditor: t('users.auditor'),
    viewer: t('users.viewer'),
    sales_manager: isRu ? 'Руководитель отдела продаж' : '销售主管',
    sales_staff: isRu ? 'Специалист отдела продаж' : '销售专员',
    procurement_staff: isRu ? 'Специалист по закупке сырья' : '采购专员',
    loading_staff: isRu ? 'Специалист отдела логистики' : '物流管理专员',
    finance_staff: isRu ? 'Специалист по финансам и активам' : '财务资产专员',
  };
  const departmentNameMap: Record<string, string> = {
    management: isRu ? 'Административно-управленческий отдел' : '综合管理部',
    sales: isRu ? 'Отдел маркетинга и продаж' : 'ProductTeam',
    procurement: isRu ? 'Отдел закупки сырья' : '原料采购部',
    loading: isRu ? 'Логистический отдел' : '物流管理部',
    finance: isRu ? 'Отдел финансов и активов' : '财务资产部',
  };
  const roleColors: Record<string, string> = {
    admin: 'red',
    leadership: 'gold',
    operator: 'blue',
    auditor: 'green',
    viewer: 'default',
    sales_manager: 'volcano',
    sales_staff: 'cyan',
    procurement_staff: 'orange',
    loading_staff: 'purple',
    finance_staff: 'geekblue',
  };

  const normalizeUsers = (payload: any): UserRecord[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };
  const translateRole = (roleCode?: string, fallback?: string) => roleNameMap[roleCode || ''] || fallback || roleCode || '';
  const translateDept = (dept?: { deptCode?: string; deptName?: string }) => departmentNameMap[dept?.deptCode || ''] || dept?.deptName || '';

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, org] = await Promise.all([
        getUsers(),
        getOrganizationOverview().catch(() => null),
      ]);
      setData(normalizeUsers(usersRes));
      if (org) {
        setRoles(org.roles.filter((role) => role.isActive));
        setDepartments(org.departments.filter((dept) => dept.isActive));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ roleCodes: ['viewer'], departmentIds: [], isActive: true });
    setModalOpen(true);
  };

  const openEdit = (record: UserRecord) => {
    setEditing(record);
    form.setFieldsValue({
      displayName: record.displayName,
      roleCodes: record.roles?.map((role) => role.roleCode) || [record.role],
      departmentIds: record.departments?.map((dept) => dept.id) || [],
      isActive: record.isActive,
    });
    setModalOpen(true);
  };

  const openPw = (id: number) => {
    setPwUserId(id);
    pwForm.resetFields();
    setPwModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await updateUser(editing.id, values);
        message.success(t('common.updated'));
      } else {
        await createUser(values);
        message.success(t('common.created'));
      }
      setModalOpen(false);
      await loadData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPw = async () => {
    const values = await pwForm.validateFields();
    if (!pwUserId) return;
    setSubmitting(true);
    try {
      await resetPassword(pwUserId, values.password);
      message.success(t('common.passwordReset'));
      setPwModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const roleOptions = (roles.length ? roles : [
    { roleCode: 'admin', roleName: t('users.admin') },
    { roleCode: 'operator', roleName: t('users.operator') },
    { roleCode: 'auditor', roleName: t('users.auditor') },
    { roleCode: 'viewer', roleName: t('users.viewer') },
  ] as RoleRecord[]).map((role) => ({
    value: role.roleCode,
    label: translateRole(role.roleCode, role.roleName),
  }));

  const columns = [
    { title: t('common.username'), dataIndex: 'username', key: 'username' },
    { title: displayNameLabel, dataIndex: 'displayName', key: 'displayName' },
    {
      title: t('common.role'),
      dataIndex: 'roles',
      key: 'roles',
      render: (_: unknown, record: UserRecord) => {
        const items = record.roles?.length
          ? record.roles
          : [{ roleCode: record.role, roleName: record.role, isPrimary: true, id: 0 }];
        return (
          <Space wrap size={[0, 4]}>
            {items.map((item) => {
              const key = item.roleCode?.toLowerCase().trim() || '';
              return <Tag key={item.roleCode} color={roleColors[key] || 'default'}>{translateRole(key, item.roleName)}</Tag>;
            })}
          </Space>
        );
      },
    },
    {
      title: departmentLabel,
      dataIndex: 'departments',
      key: 'departments',
      render: (items: UserRecord['departments']) => (
        <Space wrap size={[0, 4]}>
          {(items || []).map((item) => <Tag key={item.id}>{translateDept(item)}</Tag>)}
        </Space>
      ),
    },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      key: 'isActive',
      render: (value: boolean) => <Tag color={value ? 'green' : 'red'}>{value ? t('common.active') : t('common.inactive')}</Tag>,
    },
    { title: t('common.lastLogin'), dataIndex: 'lastLoginAt', key: 'lastLoginAt' },
    { title: t('common.createdAt'), dataIndex: 'createdAt', key: 'createdAt' },
    ...(canUpdateUser || canResetUserPassword ? [{
      title: t('common.edit'),
      key: 'action',
      width: 120,
      render: (_: unknown, record: UserRecord) => (
        <Space>
          {canUpdateUser && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />}
          {canResetUserPassword && <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => openPw(record.id)} />}
        </Space>
      ),
    }] : []),
  ];

  if (!canViewUsers) {
    return <Card title={t('nav.users')}><Tag color="red">{t('common.noPermission')}</Tag></Card>;
  }

  return (
    <Card
      title={t('nav.users')}
      loading={loading}
      extra={canCreateUser ? <Button icon={<PlusOutlined />} type="primary" onClick={openAdd}>{t('common.addUser')}</Button> : undefined}
    >
      <Table
        dataSource={data}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1000, y: 'calc(100vh - 300px)' }}
      />

      <Modal
        title={editing ? t('common.editUser') : t('common.addUser')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="username" label={t('common.username')} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="password" label={t('common.password')} rules={[{ required: true }]}><Input.Password /></Form.Item>
            </>
          )}
          <Form.Item name="displayName" label={displayNameLabel}><Input /></Form.Item>
          <Form.Item name="roleCodes" label={t('common.role')} rules={[{ required: true }]}>
            <Select mode="multiple" options={roleOptions} />
          </Form.Item>
          <Form.Item name="departmentIds" label={departmentLabel}>
            <Select
              mode="multiple"
              options={departments.map((dept) => ({ value: dept.id, label: translateDept(dept) }))}
            />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
              <Switch checkedChildren={t('common.active')} unCheckedChildren={t('common.inactive')} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        title={t('common.resetPassword')}
        open={pwModalOpen}
        onCancel={() => setPwModalOpen(false)}
        onOk={handleResetPw}
        confirmLoading={submitting}
      >
        <Form form={pwForm} layout="vertical">
          <Form.Item name="password" label={t('common.newPassword')} rules={[{ required: true, min: 6 }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
