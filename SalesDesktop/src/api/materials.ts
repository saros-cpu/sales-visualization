import client from './client';

export interface MaterialCategory {
  id: number; category_code: string; name_zh: string; name_ru: string;
  sort_order: number; is_active: boolean;
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
  id: number; order_no: string; material_id: number; material_name: string;
  from_depot_id: number; from_depot_name: string;
  to_depot_id: number; to_depot_name: string;
  requested_qty: number; transport_mode: string;
  vehicle_no: string; driver_name: string;
  status: string; remark: string; created_at: string;
}

export interface InventoryItem {
  id: number; material_id: number; material_name: string; unit: string;
  depot_id: number; depot_name: string; depot_name_ru: string;
  quantity: number; last_inbound_at: string; updated_at: string;
}

export async function getCategories() {
  const res = await client.get('/materials/categories');
  return res.data;
}

export async function getMaterials() {
  const res = await client.get('/materials');
  return res.data;
}

export async function createMaterial(data: {
  materialCode: string; categoryId: number; nameZh: string;
  nameRu?: string; specification?: string; unit?: string; unitPrice?: number;
}) {
  const res = await client.post('/materials', data);
  return res.data;
}

export async function getInboundList(params: { page?: number; page_size?: number }) {
  const res = await client.get('/materials/inbound', { params });
  return res.data;
}

export async function createInbound(data: {
  inboundDate: string; materialId: number; quantity: number;
  depotId?: number; supplierName?: string; unitPrice?: number;
  totalAmount?: number; invoiceNo?: string; remark?: string;
}) {
  const res = await client.post('/materials/inbound', data);
  return res.data;
}

export async function getTransferOrders(params: { status?: string; page?: number; page_size?: number }) {
  const res = await client.get('/materials/orders', { params });
  return res.data;
}

export async function createTransferOrder(data: {
  orderNo: string; materialId: number; fromDepotId: number; toDepotId: number;
  requestedQty: number; transportMode?: string; vehicleNo?: string;
  driverName?: string; remark?: string;
}) {
  const res = await client.post('/materials/orders', data);
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
