from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from db import get_connection
import pymysql
from datetime import datetime


# ── 物资分类 ──

@bp_v2.route('/materials/categories', methods=['GET'])
@jwt_required()
def list_categories():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('SELECT id, category_code, name_zh, name_ru, sort_order, is_active FROM material_categories ORDER BY sort_order')
            return jsonify({'code': 0, 'message': 'success', 'data': [dict(r) for r in cur.fetchall()]})
    finally:
        conn.close()


# ── 物资字典 ──

@bp_v2.route('/materials', methods=['GET'])
@jwt_required()
def list_materials():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT m.id, m.material_code, m.category_id, c.name_zh AS category_name,
                       m.name_zh, m.name_ru, m.specification, m.unit, m.unit_price, m.is_active
                FROM materials m
                LEFT JOIN material_categories c ON m.category_id = c.id
                ORDER BY c.sort_order, m.name_zh
            ''')
            return jsonify({'code': 0, 'message': 'success', 'data': [dict(r) for r in cur.fetchall()]})
    finally:
        conn.close()


@bp_v2.route('/materials', methods=['POST'])
@jwt_required()
def create_material():
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO materials (material_code, category_id, name_zh, name_ru, specification, unit, unit_price)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (data['materialCode'], data['categoryId'], data['nameZh'], data.get('nameRu', ''), data.get('specification'), data.get('unit', '个'), data.get('unitPrice', 0)))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


# ── 物资入库 ──

@bp_v2.route('/materials/inbound', methods=['GET'])
@jwt_required()
def list_inbound():
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('SELECT COUNT(*) AS total FROM material_inbound')
            total = cur.fetchone()['total']
            offset = (page - 1) * page_size
            cur.execute('''
                SELECT i.id, i.inbound_date, i.material_id, m.name_zh AS material_name,
                       i.depot_id, d.name_zh AS depot_name, i.supplier_name,
                       i.quantity, i.unit_price, i.total_amount, i.invoice_no, i.remark, i.created_at
                FROM material_inbound i
                LEFT JOIN materials m ON i.material_id = m.id
                LEFT JOIN depots d ON i.depot_id = d.id
                ORDER BY i.created_at DESC LIMIT %s OFFSET %s
            ''', (page_size, offset))
            items = [dict(r) for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/materials/inbound', methods=['POST'])
@jwt_required()
def create_inbound():
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO material_inbound (inbound_date, material_id, depot_id, supplier_name,
                    quantity, unit_price, total_amount, invoice_no, remark, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (data['inboundDate'], data['materialId'], data.get('depotId', 1),
                  data.get('supplierName'), data['quantity'], data.get('unitPrice'),
                  data.get('totalAmount'), data.get('invoiceNo'), data.get('remark'),
                  int(get_jwt_identity())))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


# ── 调拨单 ──

@bp_v2.route('/materials/orders', methods=['GET'])
@jwt_required()
def list_orders():
    status = request.args.get('status')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['1=1']
            params = []
            if status:
                where.append('o.status = %s')
                params.append(status)
            cur.execute(f'SELECT COUNT(*) AS total FROM material_transfer_orders o WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']
            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT o.id, o.order_no, o.material_id, m.name_zh AS material_name,
                       o.from_depot_id, fd.name_zh AS from_depot_name,
                       o.to_depot_id, td.name_zh AS to_depot_name,
                       o.requested_qty, o.transport_mode, o.vehicle_no, o.driver_name,
                       o.status, o.remark, o.created_at
                FROM material_transfer_orders o
                LEFT JOIN materials m ON o.material_id = m.id
                LEFT JOIN depots fd ON o.from_depot_id = fd.id
                LEFT JOIN depots td ON o.to_depot_id = td.id
                WHERE {" AND ".join(where)}
                ORDER BY o.created_at DESC LIMIT %s OFFSET %s
            ''', params + [page_size, offset])
            items = [dict(r) for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/materials/orders', methods=['POST'])
@jwt_required()
def create_order():
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO material_transfer_orders
                    (order_no, material_id, from_depot_id, to_depot_id, requested_qty,
                     transport_mode, vehicle_no, driver_name, remark, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (data['orderNo'], data['materialId'], data['fromDepotId'], data['toDepotId'],
                  data['requestedQty'], data.get('transportMode', 'truck'),
                  data.get('vehicleNo'), data.get('driverName'), data.get('remark'),
                  int(get_jwt_identity())))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route('/materials/orders/<int:order_id>/status', methods=['PUT'])
@jwt_required()
def update_order_status(order_id):
    data = request.get_json() or {}
    status = data.get('status')
    if not status:
        return jsonify({'code': 4221, 'message': '缺少 status', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT status FROM material_transfer_orders WHERE id = %s', (order_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({'code': 4004, 'message': '调拨单不存在', 'data': None}), 404
            old_status = row[0]

            cur.execute('UPDATE material_transfer_orders SET status = %s WHERE id = %s', (status, order_id))
            cur.execute('''
                INSERT INTO material_transfer_logs (transfer_id, action, from_status, to_status, operator_id)
                VALUES (%s, %s, %s, %s, %s)
            ''', (order_id, f'status_change', old_status, status, int(get_jwt_identity())))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


# ── 库存查询 ──

@bp_v2.route('/materials/inventory', methods=['GET'])
@jwt_required()
def get_inventory():
    depot_id = request.args.get('depot_id')
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['1=1']
            params = []
            if depot_id:
                where.append('i.depot_id = %s')
                params.append(depot_id)
            cur.execute(f'''
                SELECT i.id, i.material_id, m.name_zh AS material_name, m.unit,
                       i.depot_id, d.name_zh AS depot_name, d.name_ru AS depot_name_ru,
                       i.quantity, i.last_inbound_at, i.updated_at
                FROM material_inventory i
                LEFT JOIN materials m ON i.material_id = m.id
                LEFT JOIN depots d ON i.depot_id = d.id
                WHERE {" AND ".join(where)}
                ORDER BY d.name_zh, m.name_zh
            ''', params)
            items = [dict(r) for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
