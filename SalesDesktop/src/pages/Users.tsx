import { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, Select, Switch, message, Tag, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, KeyOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { getUsers, createUser, updateUser, resetPassword, UserRecord } from '@/api/users';

export default function Users() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [editing, setEditing] = useState<UserRecord | null>(null);
  const [form] = Form.useForm();
  const [pwForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    setLoading(true);
    getUsers().then((res) => setData(res.data)).finally(() => setLoading(false));
  }, []);

  const openAdd = () => {
    setEditing(null); form.resetFields(); form.setFieldsValue({ role: 'viewer', isActive: true }); setModalOpen(true);
  };

  const openEdit = (record: UserRecord) => {
    setEditing(record);
    form.setFieldsValue({ displayName: record.displayName, role: record.role, isActive: record.isActive });
    setModalOpen(true);
  };

  const openPw = (id: number) => {
    setPwUserId(id); pwForm.resetFields(); setPwModalOpen(true);
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
      const res = await getUsers();
      setData(res.data);
    } catch { /* */ }
    finally { setSubmitting(false); }
  };

  const handleResetPw = async () => {
    const values = await pwForm.validateFields();
    if (!pwUserId) return;
    setSubmitting(true);
    try {
      await resetPassword(pwUserId, values.password);
      message.success(t('common.passwordReset'));
      setPwModalOpen(false);
    } finally { setSubmitting(false); }
  };

  const roleColors: Record<string, string> = { admin: 'red', operator: 'blue', auditor: 'green', viewer: 'default' };
  const roleLabels: Record<string, string> = { admin: t('users.admin'), operator: t('users.operator'), auditor: t('users.auditor'), viewer: t('users.viewer') };

  const columns = [
    { title: t('common.username'), dataIndex: 'username', key: 'username' },
    { title: t('common.displayName'), dataIndex: 'displayName', key: 'displayName' },
    { title: t('common.role'), dataIndex: 'role', key: 'role', render: (v: string) => {
      // 强制转小写匹配，确保角色显示正确
      const key = v?.toLowerCase().trim() || '';
      const label = roleLabels[key] || v;
      return <Tag color={roleColors[key] || 'default'}>{label}</Tag>;
    }},
    { title: t('common.status'), dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? t('common.active') : t('common.inactive')}</Tag> },
    { title: t('common.lastLogin'), dataIndex: 'lastLoginAt', key: 'lastLoginAt' },
    { title: t('common.createdAt'), dataIndex: 'createdAt', key: 'createdAt' },
    {
      title: t('common.edit'), key: 'action', width: 120,
      render: (_: unknown, r: UserRecord) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => openPw(r.id)} />
        </Space>
      ),
    },
  ];

  if (!isAdmin) {
    return <Card title={t('nav.users')}><Tag color="red">{t('common.adminOnly')}</Tag></Card>;
  }

  return (
    <Card
      title={t('nav.users')} loading={loading}
      extra={<Button icon={<PlusOutlined />} type="primary" onClick={openAdd}>{t('common.addUser')}</Button>}
    >
      <Table dataSource={data} columns={columns} rowKey="id" size="small" pagination={false} scroll={{ x: 900 }} />

      <Modal title={editing ? t('common.editUser') : t('common.addUser')} open={modalOpen} onCancel={() => setModalOpen(false)}
        onOk={handleSubmit} confirmLoading={submitting}>
        <Form form={form} layout="vertical">
          {!editing && (
            <>
              <Form.Item name="username" label={t('common.username')} rules={[{ required: true }]}><Input /></Form.Item>
              <Form.Item name="password" label={t('common.password')} rules={[{ required: true }]}><Input.Password /></Form.Item>
            </>
          )}
          <Form.Item name="displayName" label={t('common.displayName')}><Input /></Form.Item>
          <Form.Item name="role" label={t('common.role')} rules={[{ required: true }]}>
            <Select>
              <Select.Option value="admin">{t('users.admin')}</Select.Option>
              <Select.Option value="operator">{t('users.operator')}</Select.Option>
              <Select.Option value="auditor">{t('users.auditor')}</Select.Option>
              <Select.Option value="viewer">{t('users.viewer')}</Select.Option>
            </Select>
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
              <Switch checkedChildren={t('common.active')} unCheckedChildren={t('common.inactive')} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal title={t('common.resetPassword')} open={pwModalOpen} onCancel={() => setPwModalOpen(false)}
        onOk={handleResetPw} confirmLoading={submitting}>
        <Form form={pwForm} layout="vertical">
          <Form.Item name="password" label={t('common.newPassword')} rules={[{ required: true, min: 6 }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
