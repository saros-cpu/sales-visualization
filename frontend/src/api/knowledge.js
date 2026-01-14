import { del, get, post, put, triggerDownload } from './client';

export const getKnowledgeBootstrap = () => get('/api/v2/knowledge/bootstrap');

export const getKnowledgeArticles = (params = {}) =>
  get('/api/v2/knowledge/articles', params);

export const getKnowledgeArticle = (id) =>
  get(`/api/v2/knowledge/articles/${id}`);

export const createKnowledgeArticle = (payload) =>
  post('/api/v2/knowledge/articles', payload);

export const updateKnowledgeArticle = (id, payload) =>
  put(`/api/v2/knowledge/articles/${id}`, payload);

export const archiveKnowledgeArticle = (id) =>
  del(`/api/v2/knowledge/articles/${id}`);

export const downloadKnowledgeAttachment = (id, filename) =>
  triggerDownload(`/api/v2/knowledge/attachments/${id}`, filename);

export const deleteKnowledgeAttachment = (id) =>
  del(`/api/v2/knowledge/attachments/${id}`);

export const reindexKnowledgeAttachments = (limit = 100) =>
  post('/api/v2/knowledge/attachments/reindex', { limit });
