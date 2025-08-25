import client from './client';
import { API_HOST } from './http';

export interface AuditLogRecord {
  id: number;
  userId?: number | null;
  username?: string | null;
  displayName?: string | null;
  moduleKey: string;
  actionKey: string;
  method: string;
  path: string;
  endpoint?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  roleCode?: string | null;
  roleName?: string | null;
  departmentId?: number | null;
  departmentName?: string | null;
  statusCode: number;
  success: boolean;
  requestQuery?: string | null;
  requestBody?: string | null;
  durationMs?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  preset?: string;
  moduleKey?: string;
  actionKey?: string;
  roleCode?: string;
  departmentName?: string;
  username?: string;
  dateFrom?: string;
  dateTo?: string;
  success?: '0' | '1';
}

export interface AuditLogResult {
  items: AuditLogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAuditLogs(params: AuditLogQuery) {
  const res = await client.get('/audit-logs', { params });
  return res.data as AuditLogResult;
}

export async function exportAuditLogs(params: AuditLogQuery) {
  const token = localStorage.getItem('accessToken') || '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  const url = `${API_HOST}/api/v2/audit-logs/export${query ? `?${query}` : ''}`;
  const filename = `审计日志_${new Date().toISOString().slice(0, 10)}.xlsx`;

  if ((window as any).electronAPI?.downloadFile) {
    const ok = await (window as any).electronAPI.downloadFile(url, filename, token);
    if (!ok) throw new Error('download cancelled');
    return;
  }

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  }, 200);
}
