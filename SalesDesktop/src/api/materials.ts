import client from './client';

export interface MaterialCategory {
  id: number; category_code: string; name_zh: string; name_ru: string;
  sort_order: number; is_active: boolean;
}

export interface DepotOption {
  id: number; depot_code: string; name_zh: string; name_ru: string;
  depot_type: string; is_active: boolean;
}

export interface Material {
  id: number; material_code: string; category_id: number; category_name: string;
  name_zh: string; name_ru: string; specification: string; unit: string;
  unit_price: number; is_active: boolean;
}

export interface InboundRecord {
  id: number; inbound_date: string; material_id: number; material_name: string;
  depot_id: number; depot_name: string; supplier_name: string;
  quantity: number; unit_price: number; total_amount: number;
  invoice_no: string; remark: string; created_at: string;
}

export interface TransferOrder {
  id: number; order_no: string; order_date?: string; material_id: number; material_name: string; material_unit?: string;
  from_depot_id: number; from_depot_name: string;
  to_depot_id: number; to_depot_name: string;
  requested_qty: number; transport_mode: string;
  vehicle_no: string; driver_name: string; handler_name?: string;
  status: string; remark: string; created_at: string;
}

export interface InventoryItem {
  id: number; material_id: number; material_name: string; unit: string;
  depot_id: number; depot_name: string; depot_name_ru: string;
  quantity: number; last_inbound_at: string; updated_at: string;
}

type MaterialCreateInput = Partial<Material> & {
  materialCode?: string; categoryId?: number; nameZh?: string;
  nameRu?: string; unitPrice?: number;
};

type InboundCreateInput = Partial<InboundRecord> & {
  inboundDate?: string; materialId?: number; depotId?: number;
  supplierName?: string; unitPrice?: number; totalAmount?: number;
  invoiceNo?: string;
};

type TransferOrderCreateInput = Partial<TransferOrder> & {
  orderNo?: string; orderDate?: string; materialId?: number; fromDepotId?: number;
  toDepotId?: number; requestedQty?: number; transportMode?: string;
  vehicleNo?: string; driverName?: string; handlerName?: string;
};

export async function getCategories() {
  const res = await client.get('/materials/categories');
  return res.data;
}

export async function getDepots() {
  const res = await client.get('/materials/depots');
  return res.data;
}

export async function getMaterials() {
  const res = await client.get('/materials');
  return res.data;
}

export async function createMaterial(data: MaterialCreateInput) {
  const payload = {
    materialCode: data.materialCode ?? data.material_code,
    categoryId: data.categoryId ?? data.category_id,
    nameZh: data.nameZh ?? data.name_zh,
    nameRu: data.nameRu ?? data.name_ru,
    specification: data.specification,
    unit: data.unit,
    unitPrice: data.unitPrice ?? data.unit_price,
  };
  const res = await client.post('/materials', payload);
  return res.data;
}

export async function deleteMaterial(id: number) {
  const res = await client.delete(`/materials/${id}`);
  return res.data;
}

export async function getInboundList(params: { page?: number; page_size?: number }) {
  const res = await client.get('/materials/inbound', { params });
  return res.data;
}

export async function createInbound(data: InboundCreateInput) {
  const payload = {
    inboundDate: data.inboundDate ?? data.inbound_date,
    materialId: data.materialId ?? data.material_id,
    quantity: data.quantity,
    depotId: data.depotId ?? data.depot_id,
    supplierName: data.supplierName ?? data.supplier_name,
    unitPrice: data.unitPrice ?? data.unit_price,
    totalAmount: data.totalAmount ?? data.total_amount,
    invoiceNo: data.invoiceNo ?? data.invoice_no,
    remark: data.remark,
  };
  const res = await client.post('/materials/inbound', payload);
  return res.data;
}

export async function getTransferOrders(params: { status?: string; page?: number; page_size?: number }) {
  const res = await client.get('/materials/orders', { params });
  return res.data;
}

export async function createTransferOrder(data: TransferOrderCreateInput) {
  const payload = {
    orderNo: data.orderNo ?? data.order_no,
    orderDate: data.orderDate ?? data.order_date,
    materialId: data.materialId ?? data.material_id,
    fromDepotId: data.fromDepotId ?? data.from_depot_id,
    toDepotId: data.toDepotId ?? data.to_depot_id,
    requestedQty: data.requestedQty ?? data.requested_qty,
    transportMode: data.transportMode ?? data.transport_mode,
    vehicleNo: data.vehicleNo ?? data.vehicle_no,
    driverName: data.driverName ?? data.driver_name,
    handlerName: data.handlerName ?? data.handler_name,
    remark: data.remark,
  };
  const res = await client.post('/materials/orders', payload);
  return res.data;
}

export async function updateOrderStatus(orderId: number, status: string) {
  const res = await client.put(`/materials/orders/${orderId}/status`, { status });
  return res.data;
}

export async function getInventory(depotId?: number) {
  const params: Record<string, number> = {};
  if (depotId) params.depot_id = depotId;
  const res = await client.get('/materials/inventory', { params });
  return res.data;
}
