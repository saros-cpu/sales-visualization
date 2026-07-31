// src/api/wholesale.js — 批发统计 API
import { ApiPaths, yearMonth } from '@shared/api-contracts';
import { get, download } from './client';

function compactParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

/**
 * 获取批发统计汇总数据（一次性返回所有 Tab 数据）
 */
export function fetchWholesale({ year, month }) {
  return get(ApiPaths.wholesale.overview({ year, month }));
}

/**
 * 获取统一明细表。默认使用业务口径：
 * 2026-06-01 前取称重生成数据，之后取上传/手工录入明细表。
 */
export function fetchWholesaleDetails(params = {}) {
  return get(ApiPaths.wholesale.details, compactParams({
    data_source: 'business',
    ...params,
  }));
}

export function fetchWholesaleDetailFilterOptions() {
  return get(ApiPaths.wholesale.detailFilterOptions);
}

export function exportWholesaleDetails(params = {}) {
  const query = compactParams({
    data_source: 'business',
    ...params,
  });
  const qs = new URLSearchParams(query).toString();
  const filename = `明细表_${query.date_from || 'start'}_${query.date_to || 'end'}.xlsx`;
  return download(`${ApiPaths.wholesale.detailsExport}${qs ? `?${qs}` : ''}`, filename);
}

/**
 * 生成批发分析报告
 */
export function generateWholesaleReport({ year, month }) {
  const path = month
    ? ApiPaths.reports.wholesaleAnalysisMonthly(yearMonth(year, month))
    : ApiPaths.reports.wholesaleAnalysisYearly(year);
  return get(path);
}

/**
 * 导出汇率快照 Excel
 */
export function exportExchangeRates({ year, month }) {
  const query = { year };
  if (month) query.month = month;
  return download(ApiPaths.reports.exchangeRates(query));
}

/**
 * 获取称重生成的明细表（支持筛选）
 */
export function fetchWeighDetails({ year, month, vehicle, entity, product, classification, matchStatus, colProduct, colSender, colReceiver, colClassification }) {
  const q = { year };
  if (month) q.month = month;
  if (vehicle) q.vehicle = vehicle;
  if (entity) q.entity = entity;
  if (product) q.product = product;
  if (classification) q.classification = classification;
  if (matchStatus) q.matchStatus = matchStatus;
  if (colProduct?.length) q.col_product = colProduct.join(',');
  if (colSender?.length) q.col_sender = colSender.join(',');
  if (colReceiver?.length) q.col_receiver = colReceiver.join(',');
  if (colClassification?.length) q.col_classification = colClassification.join(',');
  return get(ApiPaths.wholesale.weighDetails(q));
}

/**
 * 获取称重明细列筛选选项
 */
export function fetchWeighFilterOptions({ year, month }) {
  const q = { year };
  if (month) q.month = month;
  return get(ApiPaths.wholesale.weighFilterOptions(q));
}

/**
 * 导出称重明细表 Excel（按正月下载）
 */
export function exportWeighDetails(year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return download(ApiPaths.reports.wholesaleDetails(ym), `明细表_${ym}.xlsx`);
}
