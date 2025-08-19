from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from .authz import permission_required
from .data_scope import custom_resource_filter, custom_resource_values
from db import get_connection
import pymysql
from datetime import date, datetime, timedelta
from services.weighing_service import get_weighing_list


@bp_v2.route('/wholesale/details', methods=['GET'])
@jwt_required()
@permission_required('wholesale:view')
def wholesale_details():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    classification = request.args.get('classification')
    product_name = request.args.get('product_name')
    entity_name = request.args.get('entity_name')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))

    today = date.today()
    start = datetime.strptime(date_from, '%Y-%m-%d').date() if date_from else today - timedelta(days=7)
    end = datetime.strptime(date_to, '%Y-%m-%d').date() if date_to else today
    allowed_entity_names = None
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            scope_values = custom_resource_values(cur, int(get_jwt_identity()), 'wholesale', 'customer')
            allowed_entity_names = scope_values['labels'] if scope_values is not None else None
            conn.commit()
    finally:
        conn.close()

    result = get_weighing_list(
        date_from=start,
        date_to=end,
        classification=classification,
        product_name=product_name,
        entity_name=entity_name,
        allowed_entity_names=allowed_entity_names,
        page=page,
        page_size=page_size,
    )
    items = []
    for row in result['items']:
        weight_kg = float(row.get('netWeight') or 0)
        items.append({
            'id': f"{row.get('source')}-{row.get('id')}",
            'sourceId': row.get('id'),
            'businessDate': row.get('businessDate'),
            'productName': row.get('rawProductName'),
            'rawProductName': row.get('rawProductName'),
            'standardProductName': row.get('standardProductName'),
            'vehicleNo': row.get('vehicleNo'),
            'weighSerialNo': row.get('weighSerialNo'),
            'senderName': row.get('senderName'),
            'entityName': row.get('receiverName'),
            'rawEntityName': row.get('receiverName'),
            'standardEntityName': row.get('standardEntityName'),
            'entityCode': row.get('entityCode'),
            'entityType': row.get('entityType'),
            'classification': row.get('classification'),
            'weightKg': weight_kg,
            'weightTons': round(weight_kg / 1000, 6),
            'matchStatus': row.get('status') or 'pending',
            'weighSource': row.get('source'),
            'transportMode': 'truck',
            'auditStatus': row.get('status') or 'pending',
            'remark': row.get('remark'),
            'createdAt': None,
        })
    return jsonify({
        'code': 0,
        'message': 'success',
        'data': {
            'items': items,
            'total': result['total'],
            'totalWeight': result['totalWeight'],
            'page': page,
            'page_size': page_size,
        },
    })


@bp_v2.route('/wholesale/export-detail', methods=['GET'])
@jwt_required()
@permission_required('wholesale:export')
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
            scope_clause, scope_params = custom_resource_filter(
                cur,
                int(get_jwt_identity()),
                'wholesale',
                {'customer': {'labels': ['sender_name', 'raw_entity_name', 'standard_entity_name']}},
            )
            where.append(f'1=1{scope_clause}')
            params.extend(scope_params)

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
