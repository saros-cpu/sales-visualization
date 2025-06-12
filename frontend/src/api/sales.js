import { get } from './client';

// 获取可用期间列表
export const getPeriods = () => get('/api/periods');

// 获取合并统计
export const getSummary = (year, month) =>
  get('/api/summary', { year, ...(month ? { month } : {}) });

// 获取今日汇率
export const getHomeExchange = () => get('/api/home/exchange-current');

// 获取市场观察
export const getMarketWatch = () => get('/api/home/market-watch');

// 生成销售分析报告
export const generateSalesReport = (year, month) => {
  const url = month
    ? `/api/export/analysis/sales/monthly/${year}-${String(month).padStart(2, '0')}`
    : `/api/export/analysis/sales/yearly/${year}`;
  return get(url);
};
