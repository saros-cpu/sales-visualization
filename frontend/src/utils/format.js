// src/utils/format.js — 统一数字/货币格式化
export const yuan = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0,
});

export const num = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });

export const rateNum = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});

export const typeLabels = {
  retail_station: '自有加油站',
  own_depot: '自营油库',
  wholesale_customer: '批发客户',
  unknown: '未识别',
};

export function card(data, key) {
  return data?.cards?.[key] || { rows: 0, entities: 0, tons: 0, amountCny: 0 };
}
