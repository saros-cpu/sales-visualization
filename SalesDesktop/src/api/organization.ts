import client from './client';

export interface DepartmentRecord {
  id: number;
  parentId?: number | null;
  deptCode: string;
  deptName: string;
  deptNameRu?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface RoleRecord {
  id: number;
  roleCode: string;
  roleName: string;
  description?: string | null;
  dataScope: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface PermissionRecord {
  id: number;
  permissionCode: string;
  moduleKey: string;
  actionKey: string;
  permissionType: string;
  permissionName: string;
  sortOrder: number;
}

export interface ModuleRecord {
  id: number;
  moduleKey: string;
  moduleName: string;
  sortOrder: number;
}

export interface RolePermissionRecord {
  roleCode: string;
  permissionCode: string;
  granted: boolean;
}

export interface RoleDataScopeRecord {
  roleCode: string;
  moduleKey: string;
  scopeType: string;
}

export interface DataScopeResourceRecord {
  id: number;
  ownerType: string;
  ownerId: number;
  roleCode?: string;
  moduleKey: string;
  resourceType: string;
  resourceId: string;
  resourceLabel?: string;
}

export interface ResourceOption {
  resourceId: string;
  resourceLabel: string;
}

export interface OrganizationOverview {
  modules: ModuleRecord[];
  departments: DepartmentRecord[];
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  rolePermissions: RolePermissionRecord[];
  roleDataScopes: RoleDataScopeRecord[];
  dataScopeResources: DataScopeResourceRecord[];
  resourceOptions: Record<string, ResourceOption[]>;
  dataScopeTypes: string[];
}

export async function getOrganizationOverview() {
  const res = await client.get('/organization/overview');
  return res.data as OrganizationOverview;
}

export async function createDepartment(data: Partial<DepartmentRecord>) {
  const res = await client.post('/organization/departments', data);
  return res.data;
}

export async function updateDepartment(id: number, data: Partial<DepartmentRecord>) {
  const res = await client.put(`/organization/departments/${id}`, data);
  return res.data;
}

export async function createRole(data: Partial<RoleRecord>) {
  const res = await client.post('/organization/roles', data);
  return res.data;
}

export async function updateRole(id: number, data: Partial<RoleRecord>) {
  const res = await client.put(`/organization/roles/${id}`, data);
  return res.data;
}

export async function updateRolePermissions(roleCode: string, permissionCodes: string[]) {
  const res = await client.put(`/organization/roles/${roleCode}/permissions`, { permissionCodes });
  return res.data;
}

export async function updateRoleDataScopes(
  roleCode: string,
  scopes: Array<{ moduleKey: string; scopeType: string }>,
  resources: Array<{
    moduleKey: string;
    resourceType: string;
    resourceId: string;
    resourceLabel?: string;
  }>,
) {
  const res = await client.put(`/organization/roles/${roleCode}/data-scopes`, { scopes, resources });
  return res.data;
}
