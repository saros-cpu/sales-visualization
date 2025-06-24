// src/types/api.ts

// ---- 通用 ----
export interface ApiListResult<T> {
  data: T[];
  total?: number;
}
export interface ApiResult<T> {
  data: T;
}

// 注：零售相关类型（MonthlyData / RegionData / StationInfo / ResourceRow / StationStatus 等）
// 已定义在现有 src/api/retail.ts（Dashboard 等现页依赖），本文件不重定义，避免冲突。
// 新零售页面直接从 '@/api/retail' 引入这些接口。

// ---- 批发 ----
export type WholesaleClass =
  | 'export_wholesale'
  | 'local_wholesale'
  | 'unknown'
  | 'transfer'
  | 'processing'
  | 'procurement';

export interface CategoryCard {
  rows: number;
  entities: number;
  tons: number;
  amountCny: number;
  matchedRows?: number;
  reviewRows?: number;
}

export interface ProductRanking {
  name: string;
  tons: number;
  amountCny?: number;
  rows?: number;
  matchedRows?: number;
}

export interface CustomerRanking {
  name: string;
  tons: number;
  amountCny?: number;
  matchedRows?: number;
  rows?: number;
}

export interface TransferSummary {
  byRegion: { region: string; rows: number; tons: number }[];
  byProduct: { product: string; rows: number; tons: number }[];
  byRegionProduct: { region: string; product: string; rows: number; tons: number }[];
}

export interface DailyTrendPoint {
  date: string;
  exportTons: number;
  localTons: number;
  pendingTons: number;
  transferTons: number;
  amountCny: number;
}

export interface WholesaleReview {
  status: { matched: { rows: number; tons: number }; needs_review: { rows: number; tons: number } };
  topNeedsReview: { entity: string; product: string; rows: number; tons: number }[];
}

export interface WholesalePageData {
  period: { year: number; month?: number };
  cards: Record<string, CategoryCard>;
  productRankings: Record<string, ProductRanking[]>;
  customerRankings: Record<string, CustomerRanking[]>;
  transferSummary: TransferSummary;
  dailyTrend: DailyTrendPoint[];
  issues: { id: number; type: string; date: string; message: string; severity: string }[];
  review?: WholesaleReview;
}

// ---- 数据录入 ----
export interface TrainEntryRecord {
  id?: number;
  entryDate: string;
  productName: string;
  weighNo?: string;
  vehicleNo: string;
  senderName?: string;
  receiverName?: string;
  weightKg?: number;
  remark?: string;
  createdAt?: string;
}

// ---- 地图 ----
export type MapPointType = 'depot' | 'station' | 'customer' | 'supplier';
export interface MapPoint {
  id: string;
  name: string;
  type: MapPointType;
  lat?: number;
  lng?: number;
  inventory?: number;
  price?: number;
}
