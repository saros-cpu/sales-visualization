import client from './client';

export interface UserRecord {
  id: number; username: string; displayName: string; role: string;
  isActive: boolean; lastLoginAt: string; createdAt: string;
  roles?: Array<{ id: number; roleCode: string; roleName: string; isPrimary: boolean }>;
  departments?: Array<{ id: number; deptCode: string; deptName: string; deptNameRu?: string | null; isPrimary: boolean }>;
}

export interface ModulePermission {
  key: string; label: string;
}

export async function getUsers() {
  const res = await client.get('/users');
  return res.data;
}

export async function createUser(data: {
  username: string; password: string; displayName?: string; role?: string;
  roleCodes?: string[]; departmentIds?: number[];
}) {
  const res = await client.post('/users', data);
  return res.data;
}

export async function updateUser(id: number, data: Partial<{
  displayName: string; role: string; roleCodes: string[];
  departmentIds: number[]; isActive: boolean;
}>) {
  const res = await client.put(`/users/${id}`, data);
  return res.data;
}

export async function resetPassword(id: number, password: string) {
  const res = await client.put(`/users/${id}/reset-password`, { password });
  return res.data;
}

export async function updateUserPermissions(id: number, permissions: Array<{
  moduleKey: string; canView: boolean; canEdit: boolean;
}>) {
  const res = await client.put(`/users/${id}/permissions`, { permissions });
  return res.data;
}

export async function getPermissionModules() {
  const res = await client.get('/users/permissions/modules');
  return res.data;
}
