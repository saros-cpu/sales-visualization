from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from .data_scope import custom_resource_filter
from db import get_connection
from import_helpers import load_product_lookup, lookup_product
from wholesale_source_policy import detail_source_policy_clause, detail_source_policy_params
import pymysql
from datetime import datetime


@bp_v2.route('/procurement/details', methods=['GET'])
@jwt_required()
@permission_required('procurement:view')
def procurement_details():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    product_name = (request.args.get('product_name') or request.args.get('productName') or '').strip()
    product_id = (request.args.get('product_id') or request.args.get('productId') or '').strip()
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ["d.classification = 'procurement'", detail_source_policy_clause("d")]
            params = list(detail_source_policy_params())
            if date_from:
                where.append('d.business_date >= %s')
                params.append(date_from)
            if date_to:
                where.append('d.business_date <= %s')
                params.append(date_to)
            if product_id.isdigit():
                where.append('d.product_id = %s')
                params.append(int(product_id))
            elif product_name:
                where.append('''
                    (
                        d.product_id = (
                            SELECT id
                            FROM products
                            WHERE display_name = %s OR product_code = %s
                            LIMIT 1
                        )
                        OR d.raw_product_name = %s
                        OR d.raw_product_name IN (
                            SELECT pa.alias_name
                            FROM product_aliases pa
                            JOIN products p ON p.id = pa.product_id
                            WHERE p.display_name = %s OR p.product_code = %s
                        )
                    )
                ''')
                params.extend([product_name, product_name, product_name, product_name, product_name])
            scope_clause, scope_params = custom_resource_filter(
                cur,
                int(get_jwt_identity()),
                'procurement',
                {'customer': {'labels': ['d.sender_name', 'd.standard_entity_name']}},
            )
            where.append(f'1=1{scope_clause}')
            params.extend(scope_params)

            cur.execute(f'SELECT COUNT(*) AS total FROM wholesale_detail_records d WHERE {" AND ".join(where)}', params)
            total = cur.fetchone()['total']

            offset = (page - 1) * page_size
            cur.execute(f'''
                SELECT d.id, d.business_date, d.raw_product_name, d.sender_name,
                       d.standard_entity_name, d.weight_tons, d.weigh_source, d.remark
                FROM wholesale_detail_records d
                WHERE {" AND ".join(where)}
                ORDER BY d.business_date DESC, d.id DESC
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


@bp_v2.route('/procurement/products', methods=['GET'])
@jwt_required()
@permission_required('procurement:view')
def procurement_products():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ["d.classification = 'procurement'", detail_source_policy_clause("d")]
            params = list(detail_source_policy_params())
            scope_clause, scope_params = custom_resource_filter(
                cur,
                int(get_jwt_identity()),
                'procurement',
                {'customer': {'labels': ['d.sender_name', 'd.standard_entity_name']}},
            )
            where.append(f'1=1{scope_clause}')
            params.extend(scope_params)
            cur.execute(f'''
                SELECT
                    COALESCE(NULLIF(p.display_name, ''), d.raw_product_name) AS name,
                    MIN(d.product_id) AS product_id,
                    COUNT(*) AS rows
                FROM wholesale_detail_records d
                LEFT JOIN products p ON p.id = d.product_id
                WHERE {" AND ".join(where)}
                  AND COALESCE(NULLIF(p.display_name, ''), d.raw_product_name) IS NOT NULL
                  AND COALESCE(NULLIF(p.display_name, ''), d.raw_product_name) <> ''
                GROUP BY COALESCE(NULLIF(p.display_name, ''), d.raw_product_name)
                ORDER BY name
            ''', params)
            items = [
                {
                    'value': row['name'],
                    'label': row['name'],
                    'productId': row['product_id'],
                    'rows': row['rows'],
                }
                for row in cur.fetchall()
            ]
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()


@bp_v2.route('/suppliers', methods=['GET'])
@jwt_required()
@permission_required('procurement:view')
def supplier_list():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(f'''
                SELECT DISTINCT d.standard_entity_name AS name, d.entity_code AS code, d.entity_type
                FROM wholesale_detail_records d
                WHERE d.classification = 'procurement'
                  AND {detail_source_policy_clause("d")}
                ORDER BY d.standard_entity_name
            ''', detail_source_policy_params())
            items = [dict(r) for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
