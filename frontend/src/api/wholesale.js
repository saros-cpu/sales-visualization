// src/api/wholesale.js — 批发统计 API
import { get, download, buildQuery } from './client';

/**
 * 获取批发统计汇总数据（一次性返回所有 Tab 数据）
 */
export function fetchWholesale({ year, month }) {
  return get('/api/wholesale', { year, month });
}

/**
 * 生成批发分析报告
 */
export function generateWholesaleReport({ year, month }) {
  const path = month
    ? `/api/export/analysis/wholesale/monthly/${year}-${String(month).padStart(2, '0')}`
    : `/api/export/analysis/wholesale/yearly/${year}`;
  return get(path);
}

/**
 * 导出汇率快照 Excel
 */
export function exportExchangeRates({ year, month }) {
  const query = { year };
  if (month) query.month = month;
  return download(`/api/export/exchange-rates?${buildQuery(query)}`);
}

/**
 * 获取称重生成的批发明细（支持筛选）
 */
export function fetchWeighDetails({ year, month, vehicle, entity, product, classification, matchStatus, auditStatus, colProduct, colSender, colReceiver, colClassification }) {
  const q = { year };
  if (month) q.month = month;
  if (vehicle) q.vehicle = vehicle;
  if (entity) q.entity = entity;
  if (product) q.product = product;
  if (classification) q.classification = classification;
  if (matchStatus) q.matchStatus = matchStatus;
  if (auditStatus) q.auditStatus = auditStatus;
  if (colProduct?.length) q.col_product = colProduct.join(',');
  if (colSender?.length) q.col_sender = colSender.join(',');
  if (colReceiver?.length) q.col_receiver = colReceiver.join(',');
  if (colClassification?.length) q.col_classification = colClassification.join(',');
  return get(`/api/wholesale/weigh-details?${buildQuery(q)}`);
}

/**
 * 获取称重明细列筛选选项
 */
export function fetchWeighFilterOptions({ year, month }) {
  const q = { year };
  if (month) q.month = month;
  return get(`/api/wholesale/weigh-details/filter-options?${buildQuery(q)}`);
}

/**
 * 导出称重批发明细 Excel（按正月下载）
 */
export function exportWeighDetails(year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  window.open(`/api/export/wholesale/details/${ym}`, '_blank');
}
