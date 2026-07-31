import { del, get, post, put, triggerDownload } from './client';
import { ApiPaths } from '@shared/api-contracts';

export const getKnowledgeBootstrap = () => get(ApiPaths.knowledge.bootstrap);

export const getKnowledgeArticles = (params = {}) =>
  get(ApiPaths.knowledge.articles(params));

export const getKnowledgeArticle = (id) =>
  get(ApiPaths.knowledge.article(id));

export const createKnowledgeArticle = (payload) =>
  post(ApiPaths.knowledge.articles(), payload);

export const updateKnowledgeArticle = (id, payload) =>
  put(ApiPaths.knowledge.article(id), payload);

export const archiveKnowledgeArticle = (id) =>
  del(ApiPaths.knowledge.article(id));

export const downloadKnowledgeAttachment = (id, filename) =>
  triggerDownload(ApiPaths.knowledge.attachment(id), filename);

export const deleteKnowledgeAttachment = (id) =>
  del(ApiPaths.knowledge.attachment(id));

export const reindexKnowledgeAttachments = (limit = 100) =>
  post(ApiPaths.knowledge.reindexAttachments, { limit });
