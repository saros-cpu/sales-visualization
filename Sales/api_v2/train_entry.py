from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from .data_scope import owner_scope_filter
from db import get_connection
import pymysql
from datetime import datetime


def _ensure_train_entry_columns(cur):
    cur.execute("SHOW COLUMNS FROM train_entry LIKE 'weigh_no'")
    if not cur.fetchone():
        cur.execute("ALTER TABLE train_entry ADD COLUMN weigh_no VARCHAR(100) NULL AFTER product_name")


def _weight_kg_from_payload(data):
    if data.get('weightTons') not in (None, ''):
        try:
            return float(data.get('weightTons')) * 1000
        except (TypeError, ValueError):
            return None
    return data.get('weightKg')


@bp_v2.route('/train-entry', methods=['POST'])
@jwt_required()
@permission_required('train_entry:create')
def create_train_entry():
    """新增单条火车数据"""
    data = request.get_json() or {}
    required = ['entryDate', 'productName', 'vehicleNo']
    if not all(k in data for k in required):
        return jsonify({'code': 4221, 'message': '参数不完整', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            _ensure_train_entry_columns(cur)
            cur.execute('''
                INSERT INTO train_entry
                    (entry_date, product_name, weigh_no, sender_name, receiver_name, vehicle_no,
                     weight_kg, remark, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                data['entryDate'],
                data['productName'],
                data.get('weighNo', ''),
                data.get('senderName', ''),
                data.get('receiverName', ''),
                data['vehicleNo'],
                _weight_kg_from_payload(data),
                data.get('remark', ''),
                int(get_jwt_identity()),
            ))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route('/train-entry/batch', methods=['POST'])
@jwt_required()
@permission_required('train_entry:create')
def batch_create_train_entry():
    """批量新增火车数据"""
    data = request.get_json() or {}
    records = data.get('records', [])
    if not records:
        return jsonify({'code': 4221, 'message': '没有待录入的记录', 'data': None}), 422

    operator_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            _ensure_train_entry_columns(cur)
            inserted = 0
            for rec in records:
                cur.execute('''
                    INSERT INTO train_entry
                        (entry_date, product_name, weigh_no, sender_name, receiver_name, vehicle_no,
                         weight_kg, remark, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ''', (
                    rec.get('entryDate'),
                    rec.get('productName'),
                    rec.get('weighNo', ''),
                    rec.get('senderName', ''),
                    rec.get('receiverName', ''),
                    rec.get('vehicleNo'),
                    _weight_kg_from_payload(rec),
                    rec.get('remark', ''),
                    operator_id,
                ))
                inserted += 1
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'inserted': inserted}})
    finally:
        conn.close()


@bp_v2.route('/train-entry/list', methods=['GET'])
@jwt_required()
@permission_required('train_entry:view')
def list_train_entries():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _ensure_train_entry_columns(cur)
            where = ['1=1']
            params = []
            if date_from:
                where.append('entry_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('entry_date <= %s')
                params.append(date_to)
            scope_clause, scope_params = owner_scope_filter(cur, int(get_jwt_identity()), 'train_entry', 'created_by')
            where.append(f'1=1{scope_clause}')
            params.extend(scope_params)

            cur.execute(f'SELECT COUNT(*) AS total FROM train_entry WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']

            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT id, entry_date, product_name, weigh_no, sender_name, receiver_name,
                       vehicle_no, weight_kg, remark, created_at, created_by
                FROM train_entry
                WHERE {" AND ".join(where)}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            ''', params + [page_size, offset])

            items = []
            for row in cur.fetchall():
                items.append({
                    'id': row['id'],
                    'entryDate': str(row['entry_date']),
                    'productName': row['product_name'],
                    'weighNo': row.get('weigh_no') or '',
                    'senderName': row['sender_name'] or '',
                    'receiverName': row['receiver_name'] or '',
                    'vehicleNo': row['vehicle_no'],
                    'weightKg': float(row['weight_kg']) if row['weight_kg'] else None,
                    'weightTons': round(float(row['weight_kg']) / 1000, 3) if row['weight_kg'] else None,
                    'remark': row['remark'],
                    'createdAt': str(row['created_at']),
                })
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/train-entry/<int:entry_id>', methods=['PUT'])
@jwt_required()
@permission_required('train_entry:update')
def update_train_entry(entry_id):
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            _ensure_train_entry_columns(cur)
            scope_clause, scope_params = owner_scope_filter(cur, int(get_jwt_identity()), 'train_entry', 'created_by')
            updates = []
            params = []
            field_map = {
                'entryDate': 'entry_date',
                'productName': 'product_name',
                'weighNo': 'weigh_no',
                'senderName': 'sender_name',
                'receiverName': 'receiver_name',
                'vehicleNo': 'vehicle_no',
                'remark': 'remark',
            }
            for json_key, db_col in field_map.items():
                if json_key in data:
                    updates.append(f'{db_col} = %s')
                    params.append(data[json_key])
            if 'weightKg' in data or 'weightTons' in data:
                updates.append('weight_kg = %s')
                params.append(_weight_kg_from_payload(data))

            if updates:
                params.append(entry_id)
                params.extend(scope_params)
                cur.execute(f'UPDATE train_entry SET {", ".join(updates)} WHERE id = %s{scope_clause}', params)
                conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/train-entry/<int:entry_id>', methods=['DELETE'])
@jwt_required()
@permission_required('train_entry:delete')
def delete_train_entry(entry_id):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            scope_clause, scope_params = owner_scope_filter(cur, int(get_jwt_identity()), 'train_entry', 'created_by')
            cur.execute(f'DELETE FROM train_entry WHERE id = %s{scope_clause}', [entry_id] + scope_params)
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()
