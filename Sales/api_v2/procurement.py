from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from .data_scope import custom_resource_filter
from db import get_connection
from import_helpers import load_product_lookup, lookup_product
import pymysql
from datetime import datetime


@bp_v2.route('/procurement/details', methods=['GET'])
@jwt_required()
@permission_required('procurement:view')
def procurement_details():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ["classification = 'procurement'"]
            params = []
            if date_from:
                where.append('business_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('business_date <= %s')
                params.append(date_to)
            scope_clause, scope_params = custom_resource_filter(
                cur,
                int(get_jwt_identity()),
                'procurement',
                {'customer': {'labels': ['sender_name', 'standard_entity_name']}},
            )
            where.append(f'1=1{scope_clause}')
            params.extend(scope_params)

            cur.execute(f'SELECT COUNT(*) AS total FROM wholesale_detail_records WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']

            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT id, business_date, raw_product_name, sender_name,
                       standard_entity_name, weight_tons, weigh_source, remark
                FROM wholesale_detail_records
                WHERE {" AND ".join(where)}
                ORDER BY business_date DESC, id DESC
                LIMIT %s OFFSET %s
            ''', params + [page_size, offset])

            with conn.cursor() as lookup_cur:
                product_lookup = load_product_lookup(lookup_cur)
            items = []
            for row in cur.fetchall():
                raw_product_name = row['raw_product_name']
                product = lookup_product(product_lookup, raw_product_name or '')
                standard_product_name = product.get('display_name') if product else None
                items.append({
                    'id': row['id'],
                    'businessDate': str(row['business_date']),
                    'productName': standard_product_name or raw_product_name,
                    'rawProductName': raw_product_name,
                    'standardProductName': standard_product_name,
                    'senderName': row['sender_name'],
                    'entityName': row['standard_entity_name'],
                    'weightTons': float(row['weight_tons']) if row['weight_tons'] else None,
                    'weighSource': row['weigh_source'],
                    'remark': row['remark'],
                })
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total, 'page': page, 'page_size': page_size}})
    finally:
        conn.close()


@bp_v2.route('/suppliers', methods=['GET'])
@jwt_required()
@permission_required('procurement:view')
def supplier_list():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT DISTINCT standard_entity_name AS name, entity_code AS code, entity_type
                FROM wholesale_detail_records
                WHERE classification = 'procurement'
                ORDER BY standard_entity_name
            ''')
            items = [dict(r) for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
