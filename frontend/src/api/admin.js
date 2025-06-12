// src/api/admin.js — 管理后台 API
import { get, post, buildQuery } from './client';

// ── 概览 & 通用 ──
export const getAdminOverview = () => get('/api/admin/overview');
export const getReferenceOptions = () => get('/api/reference/options');
export const getProducts = () => get('/api/admin/products');
export const getDensities = () => get('/api/densities');

// ── 用户管理 ──
export const getUsers = () => get('/api/admin/users');
export const createUser = (payload) => post('/api/admin/users', payload);

// ── 零售站点 ──
export const getStationCatalog = () => get('/api/retail/station-catalog');
export const getStationStatuses = () => get('/api/admin/retail-station-statuses');
export const saveStationStatus = (payload) => post('/api/admin/retail-station-statuses', payload);
export const closeStationStatus = (id) =>
  post(`/api/admin/retail-station-statuses/${id}/close`, {});

// ── 汇率 ──
export const getAdminExchangeRates = ({ year, month }) => {
  const q = { year };
  if (month) q.month = month;
  return get(`/api/admin/exchange-rates?${buildQuery(q)}`);
};
export const saveExchangeRate = (payload) => post('/api/admin/exchange-rates', payload);
export const fetchMissingRates = (payload) => post('/api/admin/exchange-rates/fetch-missing', payload);

// ── 市场观察 ──
export const getMarketWatch = () => get('/api/admin/market-watch');
export const saveMarketWatch = (payload) => post('/api/admin/market-watch', payload);
export const fetchMarketWatch = () => post('/api/admin/market-watch/fetch', {});

// ── 自动任务 ──
export const getAutomationTasks = () => get('/api/admin/automation-tasks');
export const runAutomationTask = (task) => post('/api/admin/automation-tasks/run', { task });

// ── 批发维护 ──
export const getImportBatches = () => get('/api/admin/import-batches');
export const rollbackBatch = (batchId) => post(`/api/admin/import-batches/${batchId}/rollback`, {});
export const organizeWholesale = () => post('/api/admin/wholesale/organize', {});
export const deduplicateWholesale = () => post('/api/admin/wholesale/deduplicate', {});
export const uploadWholesaleFile = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/import/upload', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '上传失败');
  return data;
};

// ── 在线录入 ──
export const saveManualDetail = (payload) => post('/api/manual/wholesale-detail', payload);
export const saveManualContract = (payload) => post('/api/manual/contract', payload);

// ── 合同管理 ──
export const getContracts = ({ year, month, salesType, productCode, customer }) => {
  const q = {};
  if (year) q.year = year;
  if (month) q.month = month;
  if (salesType) q.salesType = salesType;
  if (productCode) q.productCode = productCode;
  if (customer) q.customer = customer;
  return get(`/api/admin/contracts?${buildQuery(q)}`);
};
export const saveContract = (id, payload) =>
  fetch(`/api/admin/contracts/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(async res => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    return data;
  });

// ── 审核中心 ──
export const getReviewDetails = ({ kind, year, month }) => {
  const q = { kind };
  if (year) q.year = year;
  if (month) q.month = month;
  return get(`/api/review/details?${buildQuery(q)}`);
};
export const applyReviewCorrection = (payload) => post('/api/review/correct', payload);

// ── 客户管理 ──
export const getCustomers = ({ type, keyword }) => {
  const q = {};
  if (type) q.type = type;
  if (keyword) q.keyword = keyword;
  return get(`/api/admin/customers?${buildQuery(q)}`);
};
export const saveCustomer = (payload) => post('/api/admin/customers', payload);

// ── 实体别名 ──
export const getEntityAliases = ({ entityType, keyword }) => {
  const q = {};
  if (entityType) q.entityType = entityType;
  if (keyword) q.keyword = keyword;
  return get(`/api/admin/entity-aliases?${buildQuery(q)}`);
};
export const saveEntityAlias = (payload) => post('/api/admin/entity-aliases', payload);

// ── 实体选项 ──
export const getEntityOptions = () => get('/api/admin/entity-options');

// ── 油品别名 ──
export const saveProductAlias = (payload) => post('/api/admin/product-aliases', payload);

// ── 密度维护 ──
export const saveDensity = (payload) => post('/api/densities', payload);

// ── 操作日志 ──
export const getOperationLogs = () => get('/api/admin/operation-logs');

// ── 系统健康 ──
export const getSystemHealth = () => get('/api/admin/system-health');
export const refreshCache = () => post('/api/admin/system-health/refresh-cache', {});
export const restartService = () => post('/api/admin/system/restart', {});
