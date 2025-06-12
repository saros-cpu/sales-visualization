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
