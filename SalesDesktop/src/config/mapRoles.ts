import type { MapPointType } from '@/types/api';

const ROLE_MAP: Record<string, MapPointType[]> = {
  admin: ['depot', 'station', 'customer', 'supplier'],
  retail: ['depot', 'station'],
  wholesale: ['depot', 'customer'],
  procurement: ['supplier', 'depot'],
};

export function mapRoleVisibleTypes(role?: string): MapPointType[] {
  if (!role) return ['depot', 'station'];
  return ROLE_MAP[role] ?? ['depot', 'station'];
}
