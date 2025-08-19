from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from .authz import permission_required
from db import get_connection
from text_utils import normalize_text
import pymysql


@bp_v2.route('/aliases/products', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_products():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT p.id, p.display_name, pa.alias_name
                FROM products p
                LEFT JOIN product_aliases pa ON p.id = pa.product_id
                WHERE p.is_active = 1
                ORDER BY p.display_name
            ''')
            rows = cur.fetchall()
            products = {}
            for r in rows:
                pid = r['id']
                if pid not in products:
                    products[pid] = {'id': pid, 'displayName': r['display_name'], 'aliases': []}
                if r['alias_name']:
                    products[pid]['aliases'].append(r['alias_name'])
            return jsonify({'code': 0, 'data': list(products.values())})
    finally:
        conn.close()


@bp_v2.route('/aliases/entities', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_entities():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, standard_name, alias_name, entity_type
                FROM entity_aliases
                ORDER BY standard_name
            ''')
            rows = cur.fetchall()
            entities = {}
            for r in rows:
                eid = r['id']
                key = f'{r["standard_name"]}__{eid}'
                if key not in entities:
                    entities[key] = {'id': eid, 'standardName': r['standard_name'], 'entityType': r['entity_type'], 'aliases': []}
                if r['alias_name']:
                    entities[key]['aliases'].append(r['alias_name'])
            return jsonify({'code': 0, 'data': list(entities.values())})
    finally:
        conn.close()


@bp_v2.route('/aliases/suggest', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_suggest():
    q = request.args.get('q', '').strip()
    atype = request.args.get('type', 'product')
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            if atype == 'product':
                cur.execute('''
                    SELECT DISTINCT pa.alias_name AS label
                    FROM product_aliases pa
                    WHERE pa.normalized_alias LIKE %s
                    LIMIT 20
                ''', (f'%{q}%',))
            else:
                cur.execute('''
                    SELECT DISTINCT ea.alias_name AS label
                    FROM entity_aliases ea
                    WHERE ea.normalized_alias LIKE %s
                    LIMIT 20
                ''', (f'%{q}%',))
            items = [{'value': r['label'], 'label': r['label']} for r in cur.fetchall()]
            return jsonify({'code': 0, 'data': items})
    finally:
        conn.close()


@bp_v2.route('/aliases/products/list', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_products_list():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT pa.id, pa.product_id, p.display_name, pa.alias_name
                FROM product_aliases pa
                JOIN products p ON p.id = pa.product_id
                ORDER BY p.display_name, pa.alias_name
            ''')
            rows = cur.fetchall()
            return jsonify({'code': 0, 'message': 'success', 'data': [
                {'id': r['id'], 'productId': r['product_id'], 'displayName': r['display_name'], 'aliasName': r['alias_name']}
                for r in rows
            ]})
    finally:
        conn.close()


@bp_v2.route('/aliases/entities/list', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_entities_list():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, entity_type, entity_code, standard_name, alias_name
                FROM entity_aliases
                ORDER BY entity_type, standard_name, alias_name
                LIMIT 1000
            ''')
            rows = cur.fetchall()
            return jsonify({'code': 0, 'message': 'success', 'data': [
                {'id': r['id'], 'entityType': r['entity_type'], 'entityCode': r['entity_code'],
                 'standardName': r['standard_name'], 'aliasName': r['alias_name']}
                for r in rows
            ]})
    finally:
        conn.close()


@bp_v2.route('/aliases/products', methods=['POST'])
@jwt_required()
@permission_required('aliases:create')
def create_product_alias():
    payload = request.get_json()
    product_id = payload.get('productId')
    alias_name = payload.get('aliasName', '').strip()
    if not product_id or not alias_name:
        return jsonify({'code': 1, 'message': 'productId and aliasName required'}), 400
    normalized = normalize_text(alias_name)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO product_aliases (product_id, alias_name, normalized_alias, source) "
                "VALUES (%s,%s,%s,'manual') "
                "ON DUPLICATE KEY UPDATE alias_name=VALUES(alias_name)",
                (product_id, alias_name, normalized),
            )
        conn.commit()
        return jsonify({'code': 0, 'message': 'success'})
    finally:
        conn.close()


@bp_v2.route('/aliases/products/<int:alias_id>', methods=['DELETE'])
@jwt_required()
@permission_required('aliases:delete')
def delete_product_alias(alias_id):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM product_aliases WHERE id=%s", (alias_id,))
        conn.commit()
        return jsonify({'code': 0, 'message': 'success'})
    finally:
        conn.close()


@bp_v2.route('/aliases/entities', methods=['POST'])
@jwt_required()
@permission_required('aliases:create')
def create_entity_alias():
    payload = request.get_json()
    entity_type = payload.get('entityType')
    entity_code = payload.get('entityCode', '')
    standard_name = payload.get('standardName', '').strip()
    alias_name = payload.get('aliasName', '').strip()
    if not entity_type or not standard_name or not alias_name:
        return jsonify({'code': 1, 'message': 'entityType, standardName and aliasName required'}), 400
    normalized = normalize_text(alias_name)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO entity_aliases (entity_type, entity_code, standard_name, alias_name, normalized_alias, source) "
                "VALUES (%s,%s,%s,%s,%s,'manual') "
                "ON DUPLICATE KEY UPDATE alias_name=VALUES(alias_name)",
                (entity_type, entity_code, standard_name, alias_name, normalized),
            )
        conn.commit()
        return jsonify({'code': 0, 'message': 'success'})
    finally:
        conn.close()


@bp_v2.route('/aliases/entities/<int:alias_id>', methods=['DELETE'])
@jwt_required()
@permission_required('aliases:delete')
def delete_entity_alias(alias_id):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM entity_aliases WHERE id=%s", (alias_id,))
        conn.commit()
        return jsonify({'code': 0, 'message': 'success'})
    finally:
        conn.close()
