import client from './client';
import { API_HOST } from './http';
import { downloadWithAuth } from './download';
import { ApiPaths } from '@shared/api-contracts';

const v2 = (path: string) => path.replace(/^\/api\/v2/, '') || '/';

export interface KnowledgeSpace {
  id: number;
  spaceKey: string;
  spaceName: string;
  description?: string;
  sortOrder?: number;
}

export interface KnowledgeCategory {
  id: number;
  spaceId: number;
  parentId?: number | null;
  categoryName: string;
  description?: string;
  sortOrder?: number;
}

export interface KnowledgeAttachment {
  id: number;
  articleId: number;
  originalName: string;
  fileSize: number;
  mimeType?: string;
  extractionStatus?: 'pending' | 'ok' | 'empty' | 'unsupported' | 'failed' | 'missing';
  extractionError?: string;
  extractedAt?: string;
  createdAt?: string;
}

export interface KnowledgeVersion {
  id: number;
  articleId: number;
  versionNo: number;
  title: string;
  summary?: string;
  status: string;
  moduleKey?: string;
  allowAi?: boolean;
  createdAt?: string;
}

export interface KnowledgeArticle {
  id: number;
  spaceId: number;
  spaceName?: string;
  categoryId?: number | null;
  categoryName?: string;
  title: string;
  summary?: string;
  content?: string;
  contentFormat?: string;
  articleType?: string;
  status: string;
  moduleKey?: string;
  tags?: string[];
  visibleRoleCodes?: string[];
  visibleDepartmentIds?: number[];
  allowAi?: boolean;
  viewCount?: number;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  attachments?: KnowledgeAttachment[];
  versions?: KnowledgeVersion[];
}

export interface KnowledgeArticlePayload {
  spaceId: number;
  categoryId?: number | null;
  title: string;
  summary?: string;
  content?: string;
  contentFormat?: string;
  articleType?: string;
  status?: string;
  moduleKey?: string;
  tags?: string[];
  visibleRoleCodes?: string[];
  visibleDepartmentIds?: number[];
  allowAi?: boolean;
}

export async function getKnowledgeBootstrap(): Promise<{
  spaces: KnowledgeSpace[];
  categories: KnowledgeCategory[];
  canManage: boolean;
  canReindex: boolean;
}> {
  const res = await client.get(v2(ApiPaths.knowledge.bootstrap));
  return res.data || { spaces: [], categories: [], canManage: false, canReindex: false };
}

export async function getKnowledgeArticles(params: Record<string, any> = {}): Promise<{
  items: KnowledgeArticle[];
  total: number;
}> {
  const res = await client.get(v2(ApiPaths.knowledge.articles()), { params });
  return res.data || { items: [], total: 0 };
}

export async function getKnowledgeArticle(id: number): Promise<KnowledgeArticle> {
  const res = await client.get(v2(ApiPaths.knowledge.article(id)));
  return res.data;
}

export async function createKnowledgeArticle(payload: KnowledgeArticlePayload) {
  const res = await client.post(v2(ApiPaths.knowledge.articles()), payload);
  return res.data;
}

export async function updateKnowledgeArticle(id: number, payload: KnowledgeArticlePayload) {
  const res = await client.put(v2(ApiPaths.knowledge.article(id)), payload);
  return res.data;
}

export async function archiveKnowledgeArticle(id: number) {
  const res = await client.delete(v2(ApiPaths.knowledge.article(id)));
  return res.data;
}

export async function uploadKnowledgeAttachment(articleId: number, file: File) {
  const token = localStorage.getItem('accessToken') || '';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_HOST}${ApiPaths.knowledge.articleAttachments(articleId)}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback = body?.message || `HTTP ${res.status}`;
    const messages: Record<string, string> = {
      attachment_too_large: '附件超过大小限制',
      attachment_type_not_allowed: '不支持的附件类型',
      file_required: '请选择附件',
    };
    throw new Error(messages[String(fallback)] || fallback);
  }
  return body?.data ?? body;
}

export async function downloadKnowledgeAttachment(id: number, filename: string) {
  const token = localStorage.getItem('accessToken') || '';
  await downloadWithAuth(`${API_HOST}${ApiPaths.knowledge.attachment(id)}`, filename, token);
}

export async function deleteKnowledgeAttachment(id: number) {
  const res = await client.delete(v2(ApiPaths.knowledge.attachment(id)));
  return res.data;
}

export async function reindexKnowledgeAttachments(limit = 100) {
  const res = await client.post(v2(ApiPaths.knowledge.reindexAttachments), { limit });
  return res.data;
}
