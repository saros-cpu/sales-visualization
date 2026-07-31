export const API_PREFIX = Object.freeze({
  core: '/api',
  v2: '/api/v2',
});

export function buildQuery(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return query.toString();
}

export function withQuery(path, params = {}) {
  const query = buildQuery(params);
  return query ? `${path}?${query}` : path;
}

export function yearMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

const cnMonthNames = [
  '一月份',
  '二月份',
  '三月份',
  '四月份',
  '五月份',
  '六月份',
  '七月份',
  '八月份',
  '九月份',
  '十月份',
  '十一月份',
  '十二月份',
];

function yesterday(value = new Date()) {
  const day = new Date(value);
  day.setDate(day.getDate() - 1);
  return day;
}

export function retailDailyFilename(period, generatedAt = new Date()) {
  const month = Number(String(period || '').split('-')[1]);
  const monthName = cnMonthNames[month - 1] || `${month}月份`;
  const day = yesterday(generatedAt);
  const dd = String(day.getDate()).padStart(2, '0');
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  return `加油站${monthName}日销表${dd}.${mm}.xlsx`;
}

export const ApiPaths = Object.freeze({
  auth: {
    status: `${API_PREFIX.v2}/auth/status`,
    bootstrap: `${API_PREFIX.v2}/auth/bootstrap`,
    login: `${API_PREFIX.v2}/auth/login`,
    logout: `${API_PREFIX.v2}/auth/logout`,
    refresh: `${API_PREFIX.v2}/auth/refresh`,
    me: `${API_PREFIX.v2}/auth/me`,
    changePassword: `${API_PREFIX.v2}/auth/change-password`,
  },
  assistant: {
    query: `${API_PREFIX.v2}/assistant/query`,
    queryStream: `${API_PREFIX.v2}/assistant/query/stream`,
    feedback: `${API_PREFIX.v2}/assistant/feedback`,
    tools: `${API_PREFIX.v2}/assistant/tools`,
    qualityDashboard: `${API_PREFIX.v2}/assistant/quality-dashboard`,
    status: `${API_PREFIX.v2}/assistant/status`,
  },
  aliases: {
    products: `${API_PREFIX.v2}/aliases/products`,
    entities: `${API_PREFIX.v2}/aliases/entities`,
    customers: (params) => withQuery(`${API_PREFIX.v2}/aliases/customers`, params),
    customersBase: `${API_PREFIX.v2}/aliases/customers`,
    customerMerge: `${API_PREFIX.v2}/aliases/customers/merge`,
    productsList: `${API_PREFIX.v2}/aliases/products/list`,
    entitiesList: `${API_PREFIX.v2}/aliases/entities/list`,
    unmatched: `${API_PREFIX.v2}/aliases/unmatched`,
    unmatchedIgnore: `${API_PREFIX.v2}/aliases/unmatched/ignore`,
    product: (id) => `${API_PREFIX.v2}/aliases/products/${encodeURIComponent(String(id))}`,
    entity: (id) => `${API_PREFIX.v2}/aliases/entities/${encodeURIComponent(String(id))}`,
  },
  map: {
    stations: `${API_PREFIX.v2}/map/stations`,
  },
  users: {
    list: `${API_PREFIX.v2}/users`,
    item: (id) => `${API_PREFIX.v2}/users/${encodeURIComponent(String(id))}`,
    resetPassword: (id) => `${API_PREFIX.v2}/users/${encodeURIComponent(String(id))}/reset-password`,
    permissionsModules: `${API_PREFIX.v2}/users/permissions/modules`,
    permissions: `${API_PREFIX.v2}/users/permissions`,
  },
  contracts: {
    list: (params) => withQuery(`${API_PREFIX.v2}/contracts`, params),
    batch: `${API_PREFIX.v2}/contracts/batch`,
    item: (id) => `${API_PREFIX.v2}/contracts/${encodeURIComponent(String(id))}`,
    execution: (id) => `${API_PREFIX.v2}/contracts/${encodeURIComponent(String(id))}/execution`,
    autoVolume: (id) => `${API_PREFIX.v2}/contracts/${encodeURIComponent(String(id))}/auto-volume`,
  },
  auditLogs: {
    list: `${API_PREFIX.v2}/audit-logs`,
    export: (params) => withQuery(`${API_PREFIX.v2}/audit-logs/export`, params),
  },
  organization: {
    overview: `${API_PREFIX.v2}/organization/overview`,
    departments: `${API_PREFIX.v2}/organization/departments`,
    department: (id) => `${API_PREFIX.v2}/organization/departments/${encodeURIComponent(String(id))}`,
    roles: `${API_PREFIX.v2}/organization/roles`,
    role: (id) => `${API_PREFIX.v2}/organization/roles/${encodeURIComponent(String(id))}`,
    rolePermissions: (roleCode) => `${API_PREFIX.v2}/organization/roles/${encodeURIComponent(String(roleCode))}/permissions`,
    roleDataScopes: (roleCode) => `${API_PREFIX.v2}/organization/roles/${encodeURIComponent(String(roleCode))}/data-scopes`,
  },
  knowledge: {
    bootstrap: `${API_PREFIX.v2}/knowledge/bootstrap`,
    articles: (params) => withQuery(`${API_PREFIX.v2}/knowledge/articles`, params),
    article: (id) => `${API_PREFIX.v2}/knowledge/articles/${encodeURIComponent(String(id))}`,
    articleAttachments: (articleId) => `${API_PREFIX.v2}/knowledge/articles/${encodeURIComponent(String(articleId))}/attachments`,
    attachment: (id) => `${API_PREFIX.v2}/knowledge/attachments/${encodeURIComponent(String(id))}`,
    reindexAttachments: `${API_PREFIX.v2}/knowledge/attachments/reindex`,
  },
  retail: {
    years: `${API_PREFIX.core}/years`,
    months: `${API_PREFIX.core}/months`,
    periods: `${API_PREFIX.core}/periods`,
    summary: (params) => withQuery(`${API_PREFIX.core}/summary`, params),
    dashboardYearly: (year) => withQuery(`${API_PREFIX.core}/dashboard/yearly`, { year }),
    kpi: `${API_PREFIX.core}/kpi`,
    kpiYearly: (year, inventory = 0) => withQuery(`${API_PREFIX.core}/kpi/yearly`, { year, inventory }),
    monthly: (ym) => `${API_PREFIX.core}/monthly/${encodeURIComponent(ym)}`,
    stations: (ym) => `${API_PREFIX.core}/stations/${encodeURIComponent(ym)}`,
    station: (ym, shopKey) => `${API_PREFIX.core}/station/${encodeURIComponent(ym)}/${encodeURIComponent(String(shopKey))}`,
    regions: (ym) => `${API_PREFIX.core}/regions/${encodeURIComponent(ym)}`,
    daily: (ym) => `${API_PREFIX.core}/daily/${encodeURIComponent(ym)}`,
    resourcesYearly: (params) => withQuery(`${API_PREFIX.core}/resources/yearly`, params),
    stationMapDetails: `${API_PREFIX.core}/station-map-details`,
    stationStatuses: `${API_PREFIX.core}/retail/station-statuses`,
    stationCatalog: `${API_PREFIX.core}/retail/station-catalog`,
    selfUseRange: (dateFrom, dateTo) => withQuery(`${API_PREFIX.core}/retail/self-use`, { date_from: dateFrom, date_to: dateTo }),
    selfUseMonth: (ym) => `${API_PREFIX.core}/retail/self-use/${encodeURIComponent(ym)}`,
    pages: `${API_PREFIX.core}/retail/pages`,
    alertInsights: (params) => withQuery(`${API_PREFIX.v2}/retail/alert-insights`, params),
  },
  sales: {
    homeExchangeCurrent: `${API_PREFIX.core}/home/exchange-current`,
    homeMarketWatch: `${API_PREFIX.core}/home/market-watch`,
  },
  wholesale: {
    overview: (params) => withQuery(`${API_PREFIX.core}/wholesale`, params),
    details: `${API_PREFIX.v2}/wholesale/details`,
    detailFilterOptions: `${API_PREFIX.v2}/wholesale/details/filter-options`,
    detail: (id) => `${API_PREFIX.v2}/wholesale/details/${encodeURIComponent(String(id))}`,
    detailsExport: `${API_PREFIX.v2}/wholesale/details/export`,
    exportDetail: `${API_PREFIX.v2}/wholesale/export-detail`,
    weighDetails: (params) => withQuery(`${API_PREFIX.core}/wholesale/weigh-details`, params),
    weighFilterOptions: (params) => withQuery(`${API_PREFIX.core}/wholesale/weigh-details/filter-options`, params),
  },
  weighing: {
    list: `${API_PREFIX.v2}/weighing/list`,
    filterOptions: `${API_PREFIX.v2}/weighing/filter-options`,
    verify: `${API_PREFIX.v2}/weighing/verify`,
    batchReview: `${API_PREFIX.v2}/weighing/batch-review`,
  },
  procurement: {
    details: `${API_PREFIX.v2}/procurement/details`,
    products: `${API_PREFIX.v2}/procurement/products`,
    suppliers: `${API_PREFIX.v2}/suppliers`,
  },
  trainEntry: {
    list: `${API_PREFIX.v2}/train-entry/list`,
    create: `${API_PREFIX.v2}/train-entry`,
    batch: `${API_PREFIX.v2}/train-entry/batch`,
    item: (id) => `${API_PREFIX.v2}/train-entry/${encodeURIComponent(String(id))}`,
  },
  transferLoss: {
    list: `${API_PREFIX.v2}/transfer/loss`,
    years: `${API_PREFIX.v2}/transfer/loss/years`,
  },
  materials: {
    categories: `${API_PREFIX.v2}/materials/categories`,
    depots: `${API_PREFIX.v2}/materials/depots`,
    list: `${API_PREFIX.v2}/materials`,
    item: (id) => `${API_PREFIX.v2}/materials/${encodeURIComponent(String(id))}`,
    inbound: `${API_PREFIX.v2}/materials/inbound`,
    inboundItem: (id) => `${API_PREFIX.v2}/materials/inbound/${encodeURIComponent(String(id))}`,
    orders: `${API_PREFIX.v2}/materials/orders`,
    order: (id) => `${API_PREFIX.v2}/materials/orders/${encodeURIComponent(String(id))}`,
    orderStatus: (id) => `${API_PREFIX.v2}/materials/orders/${encodeURIComponent(String(id))}/status`,
    inventory: `${API_PREFIX.v2}/materials/inventory`,
  },
  exchange: {
    current: `${API_PREFIX.core}/home/exchange-current`,
    rates: (params) => withQuery(`${API_PREFIX.core}/exchange-rates`, params),
  },
  system: {
    health: `${API_PREFIX.v2}/system/health`,
    automationTasks: `${API_PREFIX.v2}/system/automation-tasks`,
    runAutomationTask: `${API_PREFIX.v2}/system/automation-tasks/run`,
    accountingReportStatus: (date) => withQuery(`${API_PREFIX.v2}/system/accounting-reports/status`, { date }),
    generateAccountingReports: `${API_PREFIX.v2}/system/accounting-reports/generate`,
    devtoolsOpen: `${API_PREFIX.v2}/system/devtools-open`,
  },
  management: {
    overview: `${API_PREFIX.v2}/management/overview`,
    config: (configKey) => `${API_PREFIX.v2}/management/configs/${encodeURIComponent(String(configKey))}`,
    dictionaryItems: `${API_PREFIX.v2}/management/dictionary-items`,
    dictionaryItem: (id) => `${API_PREFIX.v2}/management/dictionary-items/${encodeURIComponent(String(id))}`,
    cockpitTemplate: (templateKey) => `${API_PREFIX.v2}/management/cockpit/templates/${encodeURIComponent(String(templateKey))}`,
    cockpit: `${API_PREFIX.v2}/cockpit`,
    profitCostTypes: `${API_PREFIX.v2}/profit/cost-types`,
    profitCostItems: `${API_PREFIX.v2}/profit/cost-items`,
    profitPurchasePrices: `${API_PREFIX.v2}/profit/purchase-prices`,
    profitWholesaleBriefingPrices: `${API_PREFIX.v2}/profit/wholesale-briefing-prices`,
  },
  admin: {
    referenceOptions: `${API_PREFIX.core}/reference/options`,
    products: `${API_PREFIX.core}/admin/products`,
    densities: `${API_PREFIX.core}/densities`,
    stationStatuses: `${API_PREFIX.core}/admin/retail-station-statuses`,
    stationStatusClose: (id) => `${API_PREFIX.core}/admin/retail-station-statuses/${encodeURIComponent(String(id))}/close`,
    exchangeRates: (params) => withQuery(`${API_PREFIX.core}/admin/exchange-rates`, params),
    exchangeRatesBase: `${API_PREFIX.core}/admin/exchange-rates`,
    exchangeRatesFetchMissing: `${API_PREFIX.core}/admin/exchange-rates/fetch-missing`,
    marketWatch: `${API_PREFIX.core}/admin/market-watch`,
    marketWatchFetch: `${API_PREFIX.core}/admin/market-watch/fetch`,
    importBatches: `${API_PREFIX.core}/admin/import-batches`,
    importBatchRollback: (id) => `${API_PREFIX.core}/admin/import-batches/${encodeURIComponent(String(id))}/rollback`,
    wholesaleOrganize: `${API_PREFIX.core}/admin/wholesale/organize`,
    wholesaleDeduplicate: `${API_PREFIX.core}/admin/wholesale/deduplicate`,
    importUpload: `${API_PREFIX.core}/import/upload`,
    manualWholesaleDetail: `${API_PREFIX.core}/manual/wholesale-detail`,
    manualContract: `${API_PREFIX.core}/manual/contract`,
    contracts: (params) => withQuery(`${API_PREFIX.core}/admin/contracts`, params),
    contract: (id) => `${API_PREFIX.core}/admin/contracts/${encodeURIComponent(String(id))}`,
    reviewDetails: (params) => withQuery(`${API_PREFIX.core}/review/details`, params),
    reviewCorrect: `${API_PREFIX.core}/review/correct`,
    customers: (params) => withQuery(`${API_PREFIX.core}/admin/customers`, params),
    customersBase: `${API_PREFIX.core}/admin/customers`,
    entityAliases: (params) => withQuery(`${API_PREFIX.core}/admin/entity-aliases`, params),
    entityAliasesBase: `${API_PREFIX.core}/admin/entity-aliases`,
    entityOptions: `${API_PREFIX.core}/admin/entity-options`,
    productAliases: `${API_PREFIX.core}/admin/product-aliases`,
    operationLogs: `${API_PREFIX.core}/admin/operation-logs`,
    contractExecution: (params) => withQuery(`${API_PREFIX.core}/admin/contracts/execution`, params),
    weighMappingEntities: (params) => withQuery(`${API_PREFIX.core}/admin/weigh/mappings/entities`, params),
    weighMappingEntity: (id) => `${API_PREFIX.core}/admin/weigh/mappings/entities/${encodeURIComponent(String(id))}`,
    weighMappingProducts: (params) => withQuery(`${API_PREFIX.core}/admin/weigh/mappings/products`, params),
    weighMappingProduct: (id) => `${API_PREFIX.core}/admin/weigh/mappings/products/${encodeURIComponent(String(id))}`,
    weighRecords: (params) => withQuery(`${API_PREFIX.core}/admin/weigh/records`, params),
    weighRecordFilterOptions: `${API_PREFIX.core}/admin/weigh/records/filter-options`,
    weighGenerate: `${API_PREFIX.core}/admin/weigh/generate`,
    weighAudit: (params) => withQuery(`${API_PREFIX.core}/admin/weigh/audit`, params),
    weighAuditBase: `${API_PREFIX.core}/admin/weigh/audit`,
    weighAutoAudit: `${API_PREFIX.core}/admin/weigh/auto-audit`,
    systemRestart: `${API_PREFIX.core}/admin/system/restart`,
  },
  reports: {
    analysisMonthly: (ym) => `${API_PREFIX.core}/export/analysis/monthly/${encodeURIComponent(ym)}`,
    analysisYearly: (year) => `${API_PREFIX.core}/export/analysis/yearly/${encodeURIComponent(String(year))}`,
    salesAnalysisMonthly: (ym) => `${API_PREFIX.core}/export/analysis/sales/monthly/${encodeURIComponent(ym)}`,
    salesAnalysisYearly: (year) => `${API_PREFIX.core}/export/analysis/sales/yearly/${encodeURIComponent(String(year))}`,
    wholesaleAnalysisMonthly: (ym) => `${API_PREFIX.core}/export/analysis/wholesale/monthly/${encodeURIComponent(ym)}`,
    wholesaleAnalysisYearly: (year) => `${API_PREFIX.core}/export/analysis/wholesale/yearly/${encodeURIComponent(String(year))}`,
    analysisDownload: (filename) => `${API_PREFIX.core}/export/analysis/sales/download/${encodeURIComponent(filename)}`,
    monthlyRetail: (ym) => `${API_PREFIX.core}/export/monthly/${encodeURIComponent(ym)}`,
    monthlyRetailDownload: (ym) => `${API_PREFIX.core}/export/monthly/${encodeURIComponent(ym)}/download`,
    monthlyRetailSingleDayDownload: (ym) => `${API_PREFIX.core}/export/monthly/${encodeURIComponent(ym)}/daily/download`,
    retailRange: (params) => withQuery(`${API_PREFIX.core}/export/retail/range`, params),
    retailRangeDownload: (params) => withQuery(`${API_PREFIX.core}/export/retail/range/download`, params),
    dailyBriefing: (date, params) => withQuery(`${API_PREFIX.core}/export/daily-briefing/${encodeURIComponent(date)}`, params),
    dailyBriefingDownload: (date) => `${API_PREFIX.core}/export/daily-briefing/${encodeURIComponent(date)}/download`,
    selfUse: (params) => withQuery(`${API_PREFIX.core}/export/self-use`, params),
    exchangeRates: (params) => withQuery(`${API_PREFIX.core}/export/exchange-rates`, params),
    wholesaleDetails: (ym) => `${API_PREFIX.core}/export/wholesale/details/${encodeURIComponent(ym)}`,
    profitMonth: (ym) => `${API_PREFIX.core}/export/profit/${encodeURIComponent(ym)}`,
    profitMonthData: (ym, params) => withQuery(`${API_PREFIX.core}/export/profit/${encodeURIComponent(ym)}/data`, params),
    profitMonthDownload: (ym) => `${API_PREFIX.core}/export/profit/${encodeURIComponent(ym)}/download`,
    profitYear: (year) => `${API_PREFIX.core}/export/profit-year/${encodeURIComponent(String(year))}`,
    profitYearData: (year, params) => withQuery(`${API_PREFIX.core}/export/profit-year/${encodeURIComponent(String(year))}/data`, params),
    profitYearDownload: (year) => `${API_PREFIX.core}/export/profit-year/${encodeURIComponent(String(year))}/download`,
  },
  wallpaper: {
    map: `${API_PREFIX.core}/wallpaper/map`,
    settings: `${API_PREFIX.core}/wallpaper/settings`,
    settingsPreview: `${API_PREFIX.core}/wallpaper/settings/preview`,
    settingsPreviewCommit: `${API_PREFIX.core}/wallpaper/settings/preview/commit`,
    editMode: `${API_PREFIX.core}/wallpaper/edit-mode`,
    refresh: `${API_PREFIX.core}/wallpaper/refresh`,
    checkUpdate: `${API_PREFIX.core}/wallpaper/check-update`,
  },
});

export const ReportCatalog = Object.freeze({
  analysisMonthly: {
    generate: ApiPaths.reports.analysisMonthly,
    fallbackName: (ym) => `月度分析报告_${ym}.docx`,
  },
  analysisYearly: {
    generate: ApiPaths.reports.analysisYearly,
    fallbackName: (year) => `年度分析报告_${year}.docx`,
  },
  retailDaily: {
    generate: ApiPaths.reports.monthlyRetail,
    download: ApiPaths.reports.monthlyRetailDownload,
    singleDayDownload: ApiPaths.reports.monthlyRetailSingleDayDownload,
    fallbackName: retailDailyFilename,
  },
  dailyBriefing: {
    generate: ApiPaths.reports.dailyBriefing,
    download: ApiPaths.reports.dailyBriefingDownload,
    fallbackName: (date) => `ProductTeam销售日报表${String(date).replace(/-/g, '.')}.xlsx`,
  },
  selfUse: {
    generate: ApiPaths.reports.selfUse,
    fallbackName: (dateFrom, dateTo) => `自用油_${dateFrom}_至_${dateTo}.xlsx`,
  },
  profitMonth: {
    generate: ApiPaths.reports.profitMonth,
    data: ApiPaths.reports.profitMonthData,
    download: ApiPaths.reports.profitMonthDownload,
    fallbackName: (ym) => `利润核算_${ym}.xlsx`,
  },
  profitYear: {
    generate: ApiPaths.reports.profitYear,
    data: ApiPaths.reports.profitYearData,
    download: ApiPaths.reports.profitYearDownload,
    fallbackName: (year) => `利润核算_${year}年.xlsx`,
  },
});
