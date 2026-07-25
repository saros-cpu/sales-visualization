import client from './client';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface UserRecord {
  id: number; username: string; displayName: string; role: string;
  isActive: boolean; mustChangePassword?: boolean; lastLoginAt: string; createdAt: string;
  roles?: Array<{ id: number; roleCode: string; roleName: string; isPrimary: boolean }>;
  departments?: Array<{ id: number; deptCode: string; deptName: string; deptNameRu?: string | null; isPrimary: boolean }>;
}

export async function getUsers() {
  const res = await client.get(v2(ApiPaths.users.list));
  return res.data;
}

export async function createUser(data: {
  username: string; password: string; displayName?: string; role?: string;
  roleCodes?: string[]; departmentIds?: number[];
}) {
  const res = await client.post(v2(ApiPaths.users.list), data);
  return res.data;
}

export async function updateUser(id: number, data: Partial<{
  displayName: string; role: string; roleCodes: string[];
  departmentIds: number[]; isActive: boolean;
}>) {
  const res = await client.put(v2(ApiPaths.users.item(id)), data);
  return res.data;
}

export async function resetPassword(id: number, password: string) {
  const res = await client.put(v2(ApiPaths.users.resetPassword(id)), { password });
  return res.data;
}
