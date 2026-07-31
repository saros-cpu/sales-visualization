import { ApiPaths, yearMonth } from '@shared/api-contracts';
import { get } from './client';

// 获取可用期间列表
export const getPeriods = () => get(ApiPaths.retail.periods);

// 获取合并统计
export const getSummary = (year, month) =>
  get(ApiPaths.retail.summary({ year, ...(month ? { month } : {}) }));

// 获取今日汇率
export const getHomeExchange = () => get(ApiPaths.sales.homeExchangeCurrent);

// 获取市场观察
export const getMarketWatch = () => get(ApiPaths.sales.homeMarketWatch);

// 生成销售分析报告
export const generateSalesReport = (year, month) => {
  const url = month
    ? ApiPaths.reports.salesAnalysisMonthly(yearMonth(year, month))
    : ApiPaths.reports.salesAnalysisYearly(year);
  return get(url);
};
