from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from db import get_connection
import pymysql
from datetime import datetime


@bp_v2.route('/train-entry', methods=['POST'])
@jwt_required()
def create_train_entry():
    """新增单条火车数据"""
    data = request.get_json() or {}
    required = ['entryDate', 'productName', 'vehicleNo', 'supplierCustomer']
    if not all(k in data for k in required):
        return jsonify({'code': 4221, 'message': '参数不完整', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO train_entry
                    (entry_date, product_name, sender_name, receiver_name, vehicle_no,
                     weight_kg, remark, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                data['entryDate'],
                data['productName'],
                data.get('senderName', ''),
                data.get('receiverName', ''),
                data['vehicleNo'],
                data.get('weightKg'),
                data.get('remark', ''),
                int(get_jwt_identity()),
            ))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route('/train-entry/batch', methods=['POST'])
@jwt_required()
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
            inserted = 0
            for rec in records:
                cur.execute('''
                    INSERT INTO train_entry
                        (entry_date, product_name, sender_name, receiver_name, vehicle_no,
                         weight_kg, remark, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ''', (
                    rec.get('entryDate'),
                    rec.get('productName'),
                    rec.get('senderName', ''),
                    rec.get('receiverName', ''),
                    rec.get('vehicleNo'),
                    rec.get('weightKg'),
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
def list_train_entries():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['1=1']
            params = []
            if date_from:
                where.append('entry_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('entry_date <= %s')
                params.append(date_to)

            cur.execute(f'SELECT COUNT(*) AS total FROM train_entry WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']

            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT id, entry_date, product_name, sender_name, receiver_name,
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
                    'senderName': row['sender_name'] or '',
                    'receiverName': row['receiver_name'] or '',
                    'vehicleNo': row['vehicle_no'],
                    'weightKg': float(row['weight_kg']) if row['weight_kg'] else None,
                    'remark': row['remark'],
                    'createdAt': str(row['created_at']),
                })
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/train-entry/<int:entry_id>', methods=['PUT'])
@jwt_required()
def update_train_entry(entry_id):
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            updates = []
            params = []
            field_map = {
                'entryDate': 'entry_date',
                'productName': 'product_name',
                'senderName': 'sender_name',
                'receiverName': 'receiver_name',
                'vehicleNo': 'vehicle_no',
                'weightKg': 'weight_kg',
                'remark': 'remark',
            }
            for json_key, db_col in field_map.items():
                if json_key in data:
                    updates.append(f'{db_col} = %s')
                    params.append(data[json_key])

            if updates:
                params.append(entry_id)
                cur.execute(f'UPDATE train_entry SET {", ".join(updates)} WHERE id = %s', params)
                conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/train-entry/<int:entry_id>', methods=['DELETE'])
@jwt_required()
def delete_train_entry(entry_id):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM train_entry WHERE id = %s', (entry_id,))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()
