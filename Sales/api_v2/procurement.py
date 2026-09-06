from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from .data_scope import custom_resource_filter
from db import get_connection
from import_helpers import load_product_lookup, load_entity_lookup, lookup_product, normalize_text


def _resolve_standard_name(lookup, *candidates):
    """按别名归一化解析标准(中俄双语)名称。

    - standard_entity_name 为空时回退到 raw_entity_name（部分采购记录
      standard_entity_name 未落库，但 raw_entity_name 已是正确对方单位）。
    - 注意 entity_aliases 中存在 normalized_alias 为 '' 的脏数据(映射到
      X-43)，归一化结果为空串时不可查表，否则会误命中。
    """
    for name in candidates:
        norm = normalize_text(name or '')
        if not norm:
            continue
        entry = lookup.get(norm)
        if entry:
            return entry['standard_name']
    for name in candidates:
        if name:
            return name
    return ''
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
                       d.standard_entity_name, d.raw_entity_name, d.weight_tons, d.weigh_source, d.remark,
                       d.transport_mode, d.batch_id
                FROM wholesale_detail_records d
                WHERE {" AND ".join(where)}
                ORDER BY d.business_date DESC, d.id DESC
                LIMIT %s OFFSET %s
            ''', params + [page_size, offset])

            with conn.cursor() as lookup_cur:
                product_lookup = load_product_lookup(lookup_cur)
                entity_lookup = load_entity_lookup(lookup_cur)
            items = []
            for row in cur.fetchall():
                raw_product_name = row['raw_product_name']
                product = lookup_product(product_lookup, raw_product_name or '')
                standard_product_name = product.get('display_name') if product else None
                sender_raw = row['sender_name']
                entity_raw = row['standard_entity_name']
                entity_raw_alt = row.get('raw_entity_name')
                sender_display = _resolve_standard_name(entity_lookup, sender_raw)
                entity_display = _resolve_standard_name(entity_lookup, entity_raw, entity_raw_alt)
                source_label = '报表上传' if row.get('batch_id') else (row['weigh_source'] or '称重来源')
                items.append({
                    'id': row['id'],
                    'businessDate': str(row['business_date']),
                    'productName': standard_product_name or raw_product_name,
                    'rawProductName': raw_product_name,
                    'standardProductName': standard_product_name,
                    'senderName': sender_display,
                    'senderRawName': sender_raw,
                    'entityName': entity_display,
                    'entityRawName': entity_raw or entity_raw_alt or '',
                    'weightTons': float(row['weight_tons']) if row['weight_tons'] else None,
                    'weighSource': source_label,
                    'remark': '火车' if row.get('transport_mode') == 'train' else ('汽车' if row.get('transport_mode') == 'truck' else (row['remark'] or '')),
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
