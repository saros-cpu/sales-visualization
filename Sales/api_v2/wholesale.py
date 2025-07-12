from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from db import get_connection
import pymysql


@bp_v2.route('/wholesale/details', methods=['GET'])
@jwt_required()
def wholesale_details():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    classification = request.args.get('classification')
    product_name = request.args.get('product_name')
    entity_name = request.args.get('entity_name')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['1=1']
            params = []
            if date_from:
                where.append('business_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('business_date <= %s')
                params.append(date_to)
            if classification:
                where.append('classification = %s')
                params.append(classification)
            if product_name:
                where.append('raw_product_name LIKE %s')
                params.append(f'%{product_name}%')
            if entity_name:
                where.append('(sender_name LIKE %s OR standard_entity_name LIKE %s)')
                params.extend([f'%{entity_name}%', f'%{entity_name}%'])

            cur.execute(f'SELECT COUNT(*) AS total FROM wholesale_detail_records WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']

            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT id, business_date, raw_product_name, vehicle_no,
                       sender_name, standard_entity_name, entity_type, entity_code,
                       classification, weight_tons, weigh_source, transport_mode,
                       audit_status, remark, created_at
                FROM wholesale_detail_records
                WHERE {" AND ".join(where)}
                ORDER BY business_date DESC, id DESC
                LIMIT %s OFFSET %s
            ''', params + [page_size, offset])

            items = []
            for row in cur.fetchall():
                items.append({
                    'id': row['id'],
                    'businessDate': str(row['business_date']),
                    'productName': row['raw_product_name'],
                    'vehicleNo': row['vehicle_no'],
                    'senderName': row['sender_name'],
                    'entityName': row['standard_entity_name'],
                    'entityCode': row['entity_code'],
                    'entityType': row['entity_type'],
                    'classification': row['classification'],
                    'weightTons': float(row['weight_tons']) if row['weight_tons'] else None,
                    'weighSource': row['weigh_source'],
                    'transportMode': row['transport_mode'],
                    'auditStatus': row['audit_status'],
                    'remark': row['remark'],
                    'createdAt': str(row['created_at']),
                })
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/wholesale/export-detail', methods=['GET'])
@jwt_required()
def wholesale_export_detail():
    classification = request.args.get('classification', 'export_wholesale')
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['classification = %s']
            params = [classification]
            if date_from:
                where.append('business_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('business_date <= %s')
                params.append(date_to)

            cur.execute(f'''
                SELECT raw_product_name, standard_entity_name,
                       SUM(weight_tons) AS total_tons,
                       COUNT(*) AS record_count
                FROM wholesale_detail_records
                WHERE {" AND ".join(where)}
                GROUP BY raw_product_name, standard_entity_name
                ORDER BY total_tons DESC
            ''', params)

            items = []
            for row in cur.fetchall():
                items.append({
                    'productName': row['raw_product_name'],
                    'entityName': row['standard_entity_name'],
                    'totalTons': float(row['total_tons']),
                    'recordCount': row['record_count'],
                })
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
