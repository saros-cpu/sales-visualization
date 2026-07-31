import { ApiPaths } from '@shared/api-contracts';
import { get, post } from './client';

async function requestJson(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = localStorage.getItem('accessToken');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { credentials: 'include', ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || '请求失败');
  return data;
}

export const getReferenceOptions = () => get(ApiPaths.admin.referenceOptions);
export const getProducts = () => get(ApiPaths.admin.products);
export const getDensities = () => get(ApiPaths.admin.densities);

export const getUsers = async () => {
  const items = await get(ApiPaths.users.list);
  return { items: Array.isArray(items) ? items : (items?.items || []) };
};

export const createUser = (payload) => post(ApiPaths.users.list, {
  ...payload,
  role: payload.role === 'user' ? 'viewer' : payload.role,
});

export const getStationCatalog = () => get(ApiPaths.retail.stationCatalog);
export const getStationStatuses = () => get(ApiPaths.admin.stationStatuses);
export const saveStationStatus = (payload) => post(ApiPaths.admin.stationStatuses, payload);
export const closeStationStatus = (id) => post(ApiPaths.admin.stationStatusClose(id), {});

export const getAdminExchangeRates = ({ year, month }) => {
  const params = { year };
  if (month) params.month = month;
  return get(ApiPaths.admin.exchangeRates(params));
};
export const saveExchangeRate = (payload) => post(ApiPaths.admin.exchangeRatesBase, payload);
export const fetchMissingRates = (payload) => post(ApiPaths.admin.exchangeRatesFetchMissing, payload);

export const getMarketWatch = () => get(ApiPaths.admin.marketWatch);
export const saveMarketWatch = (payload) => post(ApiPaths.admin.marketWatch, payload);
export const fetchMarketWatch = () => post(ApiPaths.admin.marketWatchFetch, {});

export const getAutomationTasks = () => get(ApiPaths.system.automationTasks);
export const runAutomationTask = (task) => post(ApiPaths.system.runAutomationTask, { task });

export const getImportBatches = () => get(ApiPaths.admin.importBatches);
export const rollbackBatch = (batchId) => post(ApiPaths.admin.importBatchRollback(batchId), {});
export const organizeWholesale = () => post(ApiPaths.admin.wholesaleOrganize, {});
export const deduplicateWholesale = () => post(ApiPaths.admin.wholesaleDeduplicate, {});
export const uploadWholesaleFile = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  const token = localStorage.getItem('accessToken');
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(ApiPaths.admin.importUpload, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || '上传失败');
  return data;
};

export const saveManualDetail = (payload) => post(ApiPaths.admin.manualWholesaleDetail, payload);
export const saveManualContract = (payload) => post(ApiPaths.admin.manualContract, payload);

export const getContracts = ({ year, month, salesType, productCode, customer }) => {
  const params = {};
  if (year) params.year = year;
  if (month) params.month = month;
  if (salesType) params.salesType = salesType;
  if (productCode) params.productCode = productCode;
  if (customer) params.customer = customer;
  return get(ApiPaths.admin.contracts(params));
};
export const saveContract = (id, payload) =>
  requestJson(ApiPaths.admin.contract(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const getReviewDetails = ({ kind, year, month }) => {
  const params = { kind };
  if (year) params.year = year;
  if (month) params.month = month;
  return get(ApiPaths.admin.reviewDetails(params));
};
export const applyReviewCorrection = (payload) => post(ApiPaths.admin.reviewCorrect, payload);

export const getCustomers = ({ type, keyword }) => {
  const params = {};
  if (type) params.customerType = type;
  if (keyword) params.keyword = keyword;
  return get(ApiPaths.admin.customers(params));
};
export const saveCustomer = (payload) => post(ApiPaths.admin.customersBase, payload);

export const getEntityAliases = ({ entityType, keyword }) => {
  const params = {};
  if (entityType) params.entityType = entityType;
  if (keyword) params.keyword = keyword;
  return get(ApiPaths.admin.entityAliases(params));
};
export const saveEntityAlias = (payload) => post(ApiPaths.admin.entityAliasesBase, payload);

export const getEntityOptions = () => get(ApiPaths.admin.entityOptions);
export const saveProductAlias = (payload) => post(ApiPaths.admin.productAliases, payload);
export const saveDensity = (payload) => post(ApiPaths.admin.densities, payload);
export const getOperationLogs = () => get(ApiPaths.admin.operationLogs);

export const getContractExecution = ({ status, lifecycle, customerId, year, month, page, perPage }) => {
  const params = {};
  if (status) params.status = status;
  if (lifecycle) params.lifecycle = lifecycle;
  if (customerId) params.customerId = customerId;
  if (year) params.year = year;
  if (month) params.month = month;
  if (page) params.page = page;
  if (perPage) params.perPage = perPage;
  return get(ApiPaths.admin.contractExecution(params));
};

export const getWeighEntityMappings = (params) => {
  const query = {};
  if (params?.keyword) query.keyword = params.keyword;
  if (params?.unmapped) query.unmapped = params.unmapped;
  return get(ApiPaths.admin.weighMappingEntities(query));
};
export const saveWeighEntityMapping = (payload) => post(ApiPaths.admin.weighMappingEntities(), payload);
export const deleteWeighEntityMapping = (id) => requestJson(ApiPaths.admin.weighMappingEntity(id), { method: 'DELETE' });

export const getWeighProductMappings = (params) => {
  const query = {};
  if (params?.keyword) query.keyword = params.keyword;
  if (params?.unmapped) query.unmapped = params.unmapped;
  return get(ApiPaths.admin.weighMappingProducts(query));
};
export const saveWeighProductMapping = (payload) => post(ApiPaths.admin.weighMappingProducts(), payload);
export const deleteWeighProductMapping = (id) => requestJson(ApiPaths.admin.weighMappingProduct(id), { method: 'DELETE' });

const DEFAULT_WEIGHING_DATE_FROM = '2000-01-01';
const WEIGH_SOURCE_LABELS = {
  storagedistrict: '储运区',
  lpg: '液化气罐区',
};
const WEIGH_SOURCE_TO_V2 = {
  储运区: 'storagedistrict',
  kj_weighing: 'storagedistrict',
  storage_district: 'storagedistrict',
  storagedistrict: 'storagedistrict',
  液化气罐区: 'lpg',
  lpg: 'lpg',
  lpg_weighing: 'lpg',
  lpg_storage: 'lpg',
};

function todayLocalIso() {
  const day = new Date();
  day.setMinutes(day.getMinutes() - day.getTimezoneOffset());
  return day.toISOString().slice(0, 10);
}

function csv(values, mapper = value => value) {
  if (!Array.isArray(values) || !values.length) return '';
  return values.map(value => mapper(value)).filter(Boolean).join(',');
}

function toLegacyWeighRecord(item = {}) {
  const sourceLabel = WEIGH_SOURCE_LABELS[item.source] || item.source || '储运区';
  return {
    id: item.id,
    source: item.source,
    classification: item.classification,
    status: item.status,
    编号: item.weighSerialNo,
    毛重日期: item.businessDate,
    皮重日期: item.businessDate,
    车号: item.vehicleNo,
    原发货单位: item.senderName,
    原收货单位: item.receiverName,
    原货名: item.rawProductName,
    标准发货单位: item.standardSenderName,
    标准收货单位: item.standardReceiverName || item.standardEntityName,
    标准货名: item.standardProductName,
    发货单位显示: item.displaySenderName,
    收货单位显示: item.displayReceiverName,
    货名显示: item.displayProductName,
    发货单位: item.displaySenderName || item.senderName,
    收货单位: item.displayReceiverName || item.receiverName,
    货名: item.displayProductName || item.rawProductName,
    净重: item.netWeight,
    备注: item.remark,
    weigh_source: sourceLabel,
  };
}

function buildWeighingQuery(params = {}) {
  const query = {
    page: params.page || 1,
    page_size: params.size || 50,
    date_from: params.dateFrom || DEFAULT_WEIGHING_DATE_FROM,
    date_to: params.dateTo || todayLocalIso(),
  };
  if (params.vehicle) query.vehicle_no = params.vehicle;
  if (params.entity) query.entity_name = params.entity;
  if (params.product) query.product_name = params.product;
  const senderNames = csv(params.colSender);
  const receiverNames = csv(params.colReceiver);
  const productNames = csv(params.colProduct);
  const sources = csv(params.colSource, value => WEIGH_SOURCE_TO_V2[value] || value);
  if (senderNames) query.sender_names = senderNames;
  if (receiverNames) query.receiver_names = receiverNames;
  if (productNames) query.product_names = productNames;
  if (sources) query.source = sources;
  return query;
}

export const getWeighRecords = async (params) => {
  const data = await get(ApiPaths.weighing.list, buildWeighingQuery(params));
  return {
    ...data,
    items: (data?.items || []).map(toLegacyWeighRecord),
    size: data?.page_size || params?.size || 50,
  };
};
export const getWeighRecordFilterOptions = () => get(ApiPaths.weighing.filterOptions, {
  date_from: DEFAULT_WEIGHING_DATE_FROM,
  date_to: todayLocalIso(),
});
export const generateWeighDetails = (payload) => post(ApiPaths.admin.weighGenerate, payload);

export const getWeighAuditItems = ({ year, month }) => {
  const params = { year };
  if (month) params.month = month;
  return get(ApiPaths.admin.weighAudit(params));
};
export const applyWeighAudit = (payload) => post(ApiPaths.admin.weighAuditBase, payload);
export const autoAuditWeigh = (payload) => post(ApiPaths.admin.weighAutoAudit, payload);

export const getSystemHealth = () => get(ApiPaths.system.health);
export const refreshCache = () => runAutomationTask('retail_snapshots');
export const restartService = () => post(ApiPaths.admin.systemRestart, {});
