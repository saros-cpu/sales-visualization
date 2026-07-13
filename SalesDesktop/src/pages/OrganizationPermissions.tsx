import { useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  createDepartment,
  createRole,
  getOrganizationOverview,
  updateDepartment,
  updateRole,
  updateRoleDataScopes,
  updateRolePermissions,
  type DataScopeResourceRecord,
  type DepartmentRecord,
  type OrganizationOverview,
  type PermissionRecord,
  type RoleRecord,
} from '@/api/organization';
import { useAuth } from '@/contexts/AuthContext';
import PageState from '@/components/ui/PageState';

const { Text } = Typography;

const copy = {
  zh: {
    title: '组织权限',
    intro: '配置部门、角色、动作权限和数据范围。油库、仓库、客户等业务资源不固定为部门，可按角色的数据范围绑定。',
    departments: '部门',
    roles: '角色',
    permissionMatrix: '权限矩阵',
    dataScopes: '数据范围',
    addDepartment: '新增部门',
    editDepartment: '编辑部门',
    addRole: '新增角色',
    editRole: '编辑角色',
    selectRole: '选择角色',
    savePermissions: '保存权限',
    saveDataScopes: '保存数据范围',
    customResources: '自定义资源范围',
    addScope: '添加范围',
    remove: '移除',
    savedDepartment: '已保存部门',
    savedRole: '已保存角色',
    savedPermissions: '权限矩阵已保存',
    savedScopes: '数据范围已保存',
    loadErrorTitle: '组织权限加载失败',
    deptCode: '部门编码',
    deptName: '部门名称',
    deptNameZh: '中文名称',
    deptNameRu: '俄语名称',
    parentDept: '上级部门',
    sortOrder: '排序',
    status: '状态',
    enabled: '启用',
    disabled: '停用',
    operation: '操作',
    roleCode: '角色编码',
    roleName: '角色名称',
    defaultScope: '默认数据范围',
    description: '说明',
    systemRole: '系统角色',
    customRole: '自定义',
    module: '功能模块',
    actions: '动作权限',
    resourceType: '资源类型',
    resource: '资源',
    chooseResource: '选择资源',
    scopeLabels: {
      all: '全部数据',
      dept_tree: '本部门及下级',
      dept: '本部门',
      self: '本人数据',
      custom: '自定义范围',
    },
    actionLabels: {
      view: '查看',
      create: '新增',
      update: '编辑',
      delete: '删除',
      export: '导出',
      approve: '审核',
      verify: '复核',
      manage: '管理',
      reset_password: '重置密码',
    },
    resourceTypeLabels: {
      depot: '油库/仓库',
      customer: '客户',
    },
    moduleNames: {
      dashboard: '数据可视化',
      retail: '零售',
      wholesale: '批发',
      exchange: '汇率查询',
      train_entry: '数据录入',
      procurement: '原料采购',
      contracts: '合同管理',
      materials: '物资调拨',
      transfer_loss: '外运损耗',
      map: '3D 地图',
      users: '用户管理',
      departments: '部门管理',
      roles: '角色权限',
      aliases: '别名管理',
      weighing: '称重审核',
      settings: '设置',
      data_entry: '数据录入',
      contract_mgmt: '合同管理',
      data_view: '数据查看',
      wholesale_view: '批发查看',
      transfer_view: '外运查看',
      procurement_view: '采购查看',
      processing_view: '代加工查看',
      retail_view: '零售查看',
      contract_view: '合同查看',
      reports: '报表打印',
      print_detail: '明细表打印',
      print_summary: '汇总表打印',
      print_loss: '损耗分析报告',
      print_retail: '零售分析报告',
      user_mgmt: '用户管理',
      about: '关于系统',
    },
    roleNames: {
      admin: '系统管理员',
      leadership: '领导层',
      operator: '业务操作员',
      auditor: '审计员',
      viewer: '查看员',
      sales_manager: '销售主管',
      sales_staff: '销售专员',
      procurement_staff: '采购专员',
      loading_staff: '物流管理专员',
      finance_staff: '财务资产专员',
    },
  },
  ru: {
    title: 'Организационная структура и права доступа',
    intro: 'Настройка отделов, ролей, прав на действия и областей видимости данных. Нефтебазы, склады и клиенты не являются отделами: их можно привязать к области данных роли.',
    departments: 'Отделы',
    roles: 'Роли',
    permissionMatrix: 'Матрица прав доступа',
    dataScopes: 'Области данных',
    addDepartment: 'Добавить отдел',
    editDepartment: 'Изменить отдел',
    addRole: 'Добавить роль',
    editRole: 'Изменить роль',
    selectRole: 'Выберите роль',
    savePermissions: 'Сохранить права доступа',
    saveDataScopes: 'Сохранить области данных',
    customResources: 'Индивидуальные ресурсы данных',
    addScope: 'Добавить ресурс',
    remove: 'Убрать',
    savedDepartment: 'Отдел сохранен',
    savedRole: 'Роль сохранена',
    savedPermissions: 'Матрица прав доступа сохранена',
    savedScopes: 'Области данных сохранены',
    loadErrorTitle: 'CTY-05ибка загрузки настроек прав доступа',
    deptCode: 'Код отдела',
    deptName: 'Название отдела',
    deptNameZh: 'Название на китайском',
    deptNameRu: 'Название на русском',
    parentDept: 'Родительский отдел',
    sortOrder: 'Порядок',
    status: 'Статус',
    enabled: 'Активен',
    disabled: 'Отключен',
    operation: 'Действие',
    roleCode: 'Код роли',
    roleName: 'Название роли',
    defaultScope: 'Область данных по умолчанию',
    description: 'Описание',
    systemRole: 'Системная',
    customRole: 'Своя',
    module: 'Модуль',
    actions: 'Права на действия',
    resourceType: 'Тип ресурса',
    resource: 'Ресурс',
    chooseResource: 'Выберите ресурс',
    scopeLabels: {
      all: 'Все данные',
      dept_tree: 'Отдел и подотделы',
      dept: 'Только свой отдел',
      self: 'Только свои данные',
      custom: 'Индивидуальная область',
    },
    actionLabels: {
      view: 'Просмотр',
      create: 'Создание',
      update: 'Изменение',
      delete: 'Удаление',
      export: 'Экспорт',
      approve: 'Согласование',
      verify: 'Проверка данных',
      manage: 'Администрирование',
      reset_password: 'Сброс пароля',
    },
    resourceTypeLabels: {
      depot: 'Нефтебаза / склад',
      customer: 'Клиент / контрагент',
    },
    moduleNames: {
      dashboard: 'Визуализация данных',
      retail: 'Розница',
      wholesale: 'Опт',
      exchange: 'Курсы валют',
      train_entry: 'Ввод операционных данных',
      procurement: 'Закупка сырья',
      contracts: 'Управление договорами',
      materials: 'Материалы и перемещения',
      transfer_loss: 'Потери перевозки',
      map: '3D карта',
      users: 'Управление пользователями',
      departments: 'Управление отделами',
      roles: 'Роли и права доступа',
      aliases: 'Справочник алиасов',
      weighing: 'Проверка данных взвешивания',
      settings: 'Настройки',
      data_entry: 'Ввод данных',
      contract_mgmt: 'Управление договорами',
      data_view: 'Просмотр данных',
      wholesale_view: 'Просмотр опта',
      transfer_view: 'Просмотр перевозок',
      procurement_view: 'Просмотр закупок',
      processing_view: 'Просмотр переработки',
      retail_view: 'Просмотр розницы',
      contract_view: 'Просмотр договоров',
      reports: 'Печать отчетов',
      print_detail: 'Печать детального отчета',
      print_summary: 'Печать сводного отчета',
      print_loss: 'Отчет по потерям',
      print_retail: 'Отчет по рознице',
      user_mgmt: 'Управление пользователями',
      about: 'О системе',
    },
    roleNames: {
      admin: 'Системный администратор',
      leadership: 'Руководящий состав',
      operator: 'Оператор',
      auditor: 'Аудитор',
      viewer: 'Наблюдатель',
      sales_manager: 'Руководитель отдела продаж',
      sales_staff: 'Специалист отдела продаж',
      procurement_staff: 'Специалист по закупке сырья',
      loading_staff: 'Специалист отдела логистики',
      finance_staff: 'Специалист по финансам и активам',
    },
  },
};

type LocaleCopy = typeof copy.zh;

function chooseCopy(language: string): LocaleCopy {
  return language.startsWith('ru') ? copy.ru : copy.zh;
}

export default function OrganizationPermissions() {
  const { i18n, t } = useTranslation();
  const { message } = AntApp.useApp();
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageDepartments = isAdmin || can('departments:manage');
  const canManageRoles = isAdmin || can('roles:manage');
  const text = chooseCopy(i18n.language);
  const [overview, setOverview] = useState<OrganizationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoleCode, setSelectedRoleCode] = useState('');
  const [permissionDraft, setPermissionDraft] = useState<Set<string>>(new Set());
  const [scopeDraft, setScopeDraft] = useState<Record<string, string>>({});
  const [resourceDraft, setResourceDraft] = useState<DataScopeResourceRecord[]>([]);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [savingScopes, setSavingScopes] = useState(false);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentRecord | null>(null);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [deptForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const [resourceForm] = Form.useForm();

  const selectedRole = overview?.roles.find((role) => role.roleCode === selectedRoleCode);
  const moduleLabel = (moduleKey: string, fallback?: string) => text.moduleNames[moduleKey as keyof typeof text.moduleNames] || fallback || moduleKey;
  const roleLabel = (roleCode: string, fallback?: string) => text.roleNames[roleCode as keyof typeof text.roleNames] || fallback || roleCode;
  const deptLabel = (dept: DepartmentRecord) => (
    i18n.language.startsWith('ru') ? (dept.deptNameRu?.trim() || dept.deptName) : dept.deptName
  );
  const scopeLabel = (scope: string) => text.scopeLabels[scope as keyof typeof text.scopeLabels] || scope;
  const actionLabel = (action: string) => text.actionLabels[action as keyof typeof text.actionLabels] || action;
  const resourceTypeLabel = (type: string) => text.resourceTypeLabels[type as keyof typeof text.resourceTypeLabels] || type;

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getOrganizationOverview();
      const firstRole = selectedRoleCode || data.roles[0]?.roleCode || '';
      setOverview(data);
      setSelectedRoleCode(firstRole);
      setPermissionDraft(rolePermissionCodes(data, firstRole));
      setScopeDraft(roleScopeMap(data, firstRole));
      setResourceDraft(roleResources(data, firstRole));
    } catch (err: any) {
      setError(err.message || text.loadErrorTitle);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  useEffect(() => {
    if (!overview || !selectedRoleCode) return;
    setPermissionDraft(rolePermissionCodes(overview, selectedRoleCode));
    setScopeDraft(roleScopeMap(overview, selectedRoleCode));
    setResourceDraft(roleResources(overview, selectedRoleCode));
  }, [overview, selectedRoleCode]);

  useEffect(() => {
    if (!deptModalOpen) return;
    deptForm.resetFields();
    deptForm.setFieldsValue(editingDept || { isActive: true, sortOrder: 0 });
  }, [deptModalOpen, editingDept, deptForm]);

  useEffect(() => {
    if (!roleModalOpen) return;
    roleForm.resetFields();
    roleForm.setFieldsValue(editingRole || { dataScope: 'dept', isActive: true, sortOrder: 0 });
  }, [roleModalOpen, editingRole, roleForm]);

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, PermissionRecord[]>();
    for (const permission of overview?.permissions || []) {
      const items = groups.get(permission.moduleKey) || [];
      items.push(permission);
      groups.set(permission.moduleKey, items);
    }
    return Array.from(groups.entries()).map(([moduleKey, permissions]) => ({
      moduleKey,
      moduleName: moduleLabel(moduleKey, overview?.modules.find((item) => item.moduleKey === moduleKey)?.moduleName),
      permissions,
    }));
  }, [overview, i18n.language]);

  const openDeptModal = (record?: DepartmentRecord) => {
    if (!canManageDepartments) {
      message.error(t('common.noPermission'));
      return;
    }
    setEditingDept(record || null);
    setDeptModalOpen(true);
  };

  const openRoleModal = (record?: RoleRecord) => {
    if (!canManageRoles) {
      message.error(t('common.noPermission'));
      return;
    }
    setEditingRole(record || null);
    setRoleModalOpen(true);
  };

  const saveDepartment = async () => {
    if (!canManageDepartments) {
      message.error(t('common.noPermission'));
      return;
    }
    const values = await deptForm.validateFields();
    if (editingDept) await updateDepartment(editingDept.id, values);
    else await createDepartment(values);
    message.success(text.savedDepartment);
    setDeptModalOpen(false);
    await reload();
  };

  const saveRole = async () => {
    if (!canManageRoles) {
      message.error(t('common.noPermission'));
      return;
    }
    const values = await roleForm.validateFields();
    if (editingRole) await updateRole(editingRole.id, values);
    else await createRole(values);
    message.success(text.savedRole);
    setRoleModalOpen(false);
    await reload();
  };

  const togglePermission = (code: string, checked: boolean) => {
    if (!canManageRoles) return;
    setPermissionDraft((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const savePermissions = async () => {
    if (!canManageRoles) {
      message.error(t('common.noPermission'));
      return;
    }
    if (!selectedRoleCode) return;
    setSavingPermissions(true);
    try {
      await updateRolePermissions(selectedRoleCode, Array.from(permissionDraft));
      message.success(text.savedPermissions);
      await reload();
    } finally {
      setSavingPermissions(false);
    }
  };

  const saveDataScopes = async () => {
    if (!canManageRoles) {
      message.error(t('common.noPermission'));
      return;
    }
    if (!selectedRoleCode || !overview) return;
    setSavingScopes(true);
    try {
      const scopes = overview.modules.map((item) => ({
        moduleKey: item.moduleKey,
        scopeType: scopeDraft[item.moduleKey] || selectedRole?.dataScope || 'dept',
      }));
      await updateRoleDataScopes(selectedRoleCode, scopes, resourceDraft);
      message.success(text.savedScopes);
      await reload();
    } finally {
      setSavingScopes(false);
    }
  };

  const addResourceBinding = async () => {
    if (!canManageRoles) {
      message.error(t('common.noPermission'));
      return;
    }
    const values = await resourceForm.validateFields();
    const options = overview?.resourceOptions?.[values.resourceType] || [];
    const selectedIds: string[] = values.resourceIds || [];
    const additions = selectedIds.map((resourceId) => {
      const option = options.find((item) => item.resourceId === resourceId);
      return {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 1000)}`),
        ownerType: 'role',
        ownerId: selectedRole?.id || 0,
        roleCode: selectedRoleCode,
        moduleKey: values.moduleKey,
        resourceType: values.resourceType,
        resourceId,
        resourceLabel: option?.resourceLabel || resourceId,
      } as DataScopeResourceRecord;
    });
    setResourceDraft((prev) => {
      const keys = new Set(prev.map((item) => `${item.moduleKey}:${item.resourceType}:${item.resourceId}`));
      return [...prev, ...additions.filter((item) => !keys.has(`${item.moduleKey}:${item.resourceType}:${item.resourceId}`))];
    });
    resourceForm.resetFields(['resourceIds']);
  };

  const departmentColumns = [
    { title: text.deptCode, dataIndex: 'deptCode', width: 160 },
    { title: text.deptNameZh, dataIndex: 'deptName', width: 180 },
    { title: text.deptNameRu, dataIndex: 'deptNameRu', width: 220, render: (value?: string | null) => value || '-' },
    {
      title: text.parentDept,
      dataIndex: 'parentId',
      width: 180,
      render: (value: number) => {
        const dept = overview?.departments.find((item) => item.id === value);
        return dept ? deptLabel(dept) : '-';
      },
    },
    { title: text.sortOrder, dataIndex: 'sortOrder', width: 90 },
    {
      title: text.status,
      dataIndex: 'isActive',
      width: 90,
      render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? text.enabled : text.disabled}</Tag>,
    },
    ...(canManageDepartments ? [{
      title: text.operation,
      width: 90,
      render: (_: unknown, record: DepartmentRecord) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openDeptModal(record)} />
      ),
    }] : []),
  ];

  const roleColumns = [
    { title: text.roleCode, dataIndex: 'roleCode', width: 170 },
    { title: text.roleName, dataIndex: 'roleName', width: 180, render: (_: string, record: RoleRecord) => roleLabel(record.roleCode, record.roleName) },
    { title: text.defaultScope, dataIndex: 'dataScope', width: 170, render: (value: string) => scopeLabel(value) },
    { title: text.description, dataIndex: 'description' },
    {
      title: text.systemRole,
      dataIndex: 'isSystem',
      width: 110,
      render: (value: boolean) => value ? <Tag color="blue">{text.systemRole}</Tag> : <Tag>{text.customRole}</Tag>,
    },
    {
      title: text.status,
      dataIndex: 'isActive',
      width: 90,
      render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? text.enabled : text.disabled}</Tag>,
    },
    ...(canManageRoles ? [{
      title: text.operation,
      width: 90,
      render: (_: unknown, record: RoleRecord) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openRoleModal(record)} />
      ),
    }] : []),
  ];

  const permissionColumns = [
    { title: text.module, dataIndex: 'moduleName', width: 190, fixed: 'left' as const },
    {
      title: text.actions,
      dataIndex: 'permissions',
      render: (items: PermissionRecord[]) => (
        <Space wrap>
          {items.map((item) => (
            <Checkbox
              key={item.permissionCode}
              checked={permissionDraft.has(item.permissionCode)}
              disabled={!canManageRoles}
              onChange={(event) => togglePermission(item.permissionCode, event.target.checked)}
            >
              {actionLabel(item.actionKey)}
            </Checkbox>
          ))}
        </Space>
      ),
    },
  ];

  const scopeColumns = [
    { title: text.module, dataIndex: 'moduleName', width: 220 },
    {
      title: text.dataScopes,
      dataIndex: 'moduleKey',
      render: (moduleKey: string) => (
        <Select
          value={scopeDraft[moduleKey] || selectedRole?.dataScope || 'dept'}
          style={{ width: 240 }}
          disabled={!canManageRoles}
          onChange={(value) => setScopeDraft((prev) => ({ ...prev, [moduleKey]: value }))}
          options={(overview?.dataScopeTypes || []).map((value) => ({ value, label: scopeLabel(value) }))}
        />
      ),
    },
  ];

  const resourceColumns = [
    { title: text.module, dataIndex: 'moduleKey', render: (value: string) => moduleLabel(value) },
    { title: text.resourceType, dataIndex: 'resourceType', render: (value: string) => resourceTypeLabel(value) },
    { title: text.resource, dataIndex: 'resourceLabel' },
    ...(canManageRoles ? [{
      title: text.operation,
      width: 90,
      render: (_: unknown, record: DataScopeResourceRecord) => (
        <Button
          danger
          type="link"
          size="small"
          onClick={() => setResourceDraft((prev) => prev.filter((item) => item !== record))}
        >
          {text.remove}
        </Button>
      ),
    }] : []),
  ];

  if (loading) return <PageState status="loading" />;
  if (error) return <PageState status="error" title={text.loadErrorTitle} description={error} onRetry={reload} />;

  return (
    <div className="client-fit-page">
      <div className="client-fit-fixed">
        <Typography.Title level={4} style={{ marginBottom: 4 }}>{text.title}</Typography.Title>
        <Text type="secondary">{text.intro}</Text>
      </div>

      <Tabs
        className="client-fit-tabs"
        items={[
          {
            key: 'departments',
            label: text.departments,
            children: (
              <div className="client-fit-page">
                <div className="client-fit-fixed" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {canManageDepartments && <Button type="primary" icon={<PlusOutlined />} onClick={() => openDeptModal()}>{text.addDepartment}</Button>}
                </div>
                <div className="client-fit-table-scroll">
                  <Table rowKey="id" size="small" dataSource={overview?.departments || []} columns={departmentColumns} pagination={false} scroll={{ x: 960 }} />
                </div>
              </div>
            ),
          },
          {
            key: 'roles',
            label: text.roles,
            children: (
              <div className="client-fit-page">
                <div className="client-fit-fixed" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {canManageRoles && <Button type="primary" icon={<PlusOutlined />} onClick={() => openRoleModal()}>{text.addRole}</Button>}
                </div>
                <div className="client-fit-table-scroll">
                  <Table rowKey="id" size="small" dataSource={overview?.roles || []} columns={roleColumns} pagination={false} scroll={{ x: 900 }} />
                </div>
              </div>
            ),
          },
          {
            key: 'permissions',
            label: text.permissionMatrix,
            children: (
              <div className="client-fit-page">
                <Space wrap className="client-fit-fixed">
                  <Text>{text.selectRole}</Text>
                  <Select
                    value={selectedRoleCode}
                    style={{ width: 280 }}
                    onChange={setSelectedRoleCode}
                    options={(overview?.roles || []).map((role) => ({
                      value: role.roleCode,
                      label: `${roleLabel(role.roleCode, role.roleName)} (${role.roleCode})`,
                    }))}
                  />
                  {canManageRoles && (
                    <Button type="primary" icon={<SaveOutlined />} loading={savingPermissions} onClick={savePermissions}>
                      {text.savePermissions}
                    </Button>
                  )}
                </Space>
                <div className="client-fit-table-scroll">
                  <Table rowKey="moduleKey" size="small" dataSource={permissionsByModule} columns={permissionColumns} pagination={false} scroll={{ x: 900 }} />
                </div>
              </div>
            ),
          },
          {
            key: 'scopes',
            label: text.dataScopes,
            children: (
              <div className="client-fit-page">
                <Space wrap className="client-fit-fixed">
                  <Text>{text.selectRole}</Text>
                  <Select
                    value={selectedRoleCode}
                    style={{ width: 280 }}
                    onChange={setSelectedRoleCode}
                    options={(overview?.roles || []).map((role) => ({
                      value: role.roleCode,
                      label: `${roleLabel(role.roleCode, role.roleName)} (${role.roleCode})`,
                    }))}
                  />
                  {canManageRoles && (
                    <Button type="primary" icon={<SaveOutlined />} loading={savingScopes} onClick={saveDataScopes}>
                      {text.saveDataScopes}
                    </Button>
                  )}
                </Space>
                <div className="client-fit-inner-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <Table
                    rowKey="moduleKey"
                    size="small"
                    dataSource={(overview?.modules || []).map((item) => ({ ...item, moduleName: moduleLabel(item.moduleKey, item.moduleName) }))}
                    columns={scopeColumns}
                    pagination={false}
                    scroll={{ x: 760 }}
                  />
                  <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
                  <Typography.Title level={5}>{text.customResources}</Typography.Title>
                  {canManageRoles && <Form form={resourceForm} layout="inline" style={{ marginBottom: 12 }}>
                    <Form.Item name="moduleKey" rules={[{ required: true }]} initialValue="wholesale">
                      <Select
                        style={{ width: 190 }}
                        options={(overview?.modules || []).map((item) => ({
                          value: item.moduleKey,
                          label: moduleLabel(item.moduleKey, item.moduleName),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="resourceType" rules={[{ required: true }]} initialValue="depot">
                      <Select
                        style={{ width: 170 }}
                        options={Object.keys(overview?.resourceOptions || {}).map((key) => ({
                          value: key,
                          label: resourceTypeLabel(key),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item shouldUpdate noStyle>
                      {() => {
                        const type = resourceForm.getFieldValue('resourceType') || 'depot';
                        return (
                          <Form.Item name="resourceIds" rules={[{ required: true }]}>
                            <Select
                              mode="multiple"
                              style={{ minWidth: 360 }}
                              placeholder={text.chooseResource}
                              options={(overview?.resourceOptions?.[type] || []).map((item) => ({
                                value: item.resourceId,
                                label: item.resourceLabel,
                              }))}
                            />
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <Button icon={<PlusOutlined />} onClick={addResourceBinding}>{text.addScope}</Button>
                  </Form>}
                  <Table
                    rowKey={(record) => `${record.moduleKey}:${record.resourceType}:${record.resourceId}:${record.id}`}
                    size="small"
                    dataSource={resourceDraft}
                    columns={resourceColumns}
                    pagination={false}
                    scroll={{ x: 760 }}
                  />
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />

      <Modal title={editingDept ? text.editDepartment : text.addDepartment} open={deptModalOpen} onCancel={() => setDeptModalOpen(false)} onOk={saveDepartment} destroyOnHidden>
        <Form form={deptForm} layout="vertical">
          {!editingDept && (
            <Form.Item name="deptCode" label={text.deptCode} rules={[{ required: true }]}>
              <Input placeholder="sales" />
            </Form.Item>
          )}
          <Form.Item name="deptName" label={text.deptNameZh} rules={[{ required: true }]}>
            <Input placeholder="ProductTeam" />
          </Form.Item>
          <Form.Item name="deptNameRu" label={text.deptNameRu}>
            <Input placeholder="Отдел маркетинга и продаж" />
          </Form.Item>
          <Form.Item name="parentId" label={text.parentDept}>
            <Select
              allowClear
              options={(overview?.departments || [])
                .filter((item) => item.id !== editingDept?.id)
                .map((item) => ({ value: item.id, label: deptLabel(item) }))}
            />
          </Form.Item>
          <Form.Item name="sortOrder" label={text.sortOrder}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label={text.status} valuePropName="checked">
            <Switch checkedChildren={text.enabled} unCheckedChildren={text.disabled} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={editingRole ? text.editRole : text.addRole} open={roleModalOpen} onCancel={() => setRoleModalOpen(false)} onOk={saveRole} destroyOnHidden>
        <Form form={roleForm} layout="vertical">
          {!editingRole && (
            <Form.Item name="roleCode" label={text.roleCode} rules={[{ required: true }]}>
              <Input placeholder="sales_manager" />
            </Form.Item>
          )}
          <Form.Item name="roleName" label={text.roleName} rules={[{ required: true }]}>
            <Input placeholder={text.roleNames.sales_manager} />
          </Form.Item>
          <Form.Item name="description" label={text.description}>
            <Input />
          </Form.Item>
          <Form.Item name="dataScope" label={text.defaultScope}>
            <Select options={Object.keys(text.scopeLabels).map((value) => ({ value, label: scopeLabel(value) }))} />
          </Form.Item>
          <Form.Item name="sortOrder" label={text.sortOrder}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label={text.status} valuePropName="checked">
            <Switch checkedChildren={text.enabled} unCheckedChildren={text.disabled} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function rolePermissionCodes(overview: OrganizationOverview | null, roleCode: string) {
  return new Set(
    overview?.rolePermissions
      .filter((item) => item.roleCode === roleCode && item.granted)
      .map((item) => item.permissionCode) || [],
  );
}

function roleScopeMap(overview: OrganizationOverview | null, roleCode: string) {
  return Object.fromEntries(
    overview?.roleDataScopes
      .filter((item) => item.roleCode === roleCode)
      .map((item) => [item.moduleKey, item.scopeType]) || [],
  ) as Record<string, string>;
}

function roleResources(overview: OrganizationOverview | null, roleCode: string) {
  return overview?.dataScopeResources.filter((item) => item.roleCode === roleCode) || [];
}
