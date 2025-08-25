from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from api_v2 import bp_v2
from .authz import permission_required
from db import get_connection
from text_utils import normalize_text
import pymysql


def _ensure_alias_ignore_schema(cur):
    cur.execute('''
        CREATE TABLE IF NOT EXISTS alias_ignored_names (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            kind ENUM('product','entity') NOT NULL,
            raw_name VARCHAR(255) NOT NULL,
            normalized_name VARCHAR(255) NOT NULL,
            operator_id BIGINT NULL,
            remark VARCHAR(255) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_alias_ignore_kind_norm (kind, normalized_name),
            KEY idx_alias_ignore_kind (kind)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ''')


def _ignored_alias_names(cur, kind):
    _ensure_alias_ignore_schema(cur)
    cur.execute('SELECT normalized_name FROM alias_ignored_names WHERE kind = %s', (kind,))
    return {row['normalized_name'] for row in cur.fetchall() if row.get('normalized_name')}


def _known_product_names(cur):
    cur.execute('SELECT normalized_alias FROM product_aliases')
    known = {r['normalized_alias'] for r in cur.fetchall() if r.get('normalized_alias')}
    cur.execute('SELECT display_name FROM products WHERE is_active = 1')
    known.update(normalize_text(r['display_name']) for r in cur.fetchall() if r.get('display_name'))
    return known


def _known_entity_names(cur):
    cur.execute('SELECT normalized_alias, standard_name FROM entity_aliases')
    known = set()
    for row in cur.fetchall():
        if row.get('normalized_alias'):
            known.add(row['normalized_alias'])
        if row.get('standard_name'):
            known.add(normalize_text(row['standard_name']))
    cur.execute('SELECT normalized_name FROM customers')
    known.update(r['normalized_name'] for r in cur.fetchall() if r.get('normalized_name'))
    return known


def _candidate_items(rows, known_names, limit=100):
    items = []
    seen = set()
    for row in rows:
        raw_name = (row.get('raw_name') or '').strip()
        normalized = normalize_text(raw_name)
        if not raw_name or not normalized or normalized in known_names or normalized in seen:
            continue
        seen.add(normalized)
        latest_date = row.get('latest_date')
        if hasattr(latest_date, 'isoformat'):
            latest_date = latest_date.isoformat()
        sources = [item for item in (row.get('sources') or '').split(',') if item]
        items.append({
            'rawName': raw_name,
            'count': int(row.get('row_count') or 0),
            'latestDate': latest_date,
            'sources': sources,
        })
        if len(items) >= limit:
            break
    return items


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


@bp_v2.route('/aliases/unmatched', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_unmatched():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            product_known = _known_product_names(cur)
            entity_known = _known_entity_names(cur)
            product_known.update(_ignored_alias_names(cur, 'product'))
            entity_known.update(_ignored_alias_names(cur, 'entity'))

            cur.execute('''
                SELECT raw_name, SUM(row_count) AS row_count, MAX(latest_date) AS latest_date,
                       GROUP_CONCAT(DISTINCT source ORDER BY source SEPARATOR ',') AS sources
                FROM (
                    SELECT raw_product_name AS raw_name, COUNT(*) AS row_count,
                           MAX(business_date) AS latest_date, 'weighing' AS source
                    FROM wholesale_detail_records
                    WHERE raw_product_name IS NOT NULL
                      AND TRIM(raw_product_name) <> ''
                      AND product_id IS NULL
                    GROUP BY raw_product_name
                    UNION ALL
                    SELECT raw_product_name AS raw_name, COUNT(*) AS row_count,
                           NULL AS latest_date, 'summary' AS source
                    FROM wholesale_summary_records
                    WHERE raw_product_name IS NOT NULL
                      AND TRIM(raw_product_name) <> ''
                      AND product_id IS NULL
                    GROUP BY raw_product_name
                    UNION ALL
                    SELECT raw_product_name AS raw_name, COUNT(*) AS row_count,
                           MAX(COALESCE(signed_date, effective_start, effective_end)) AS latest_date,
                           'contract' AS source
                    FROM contracts
                    WHERE raw_product_name IS NOT NULL
                      AND TRIM(raw_product_name) <> ''
                      AND product_id IS NULL
                    GROUP BY raw_product_name
                ) candidates
                GROUP BY raw_name
                ORDER BY row_count DESC, latest_date DESC
                LIMIT 1000
            ''')
            product_rows = cur.fetchall()

            cur.execute('''
                SELECT raw_name, SUM(row_count) AS row_count, MAX(latest_date) AS latest_date,
                       GROUP_CONCAT(DISTINCT source ORDER BY source SEPARATOR ',') AS sources
                FROM (
                    SELECT raw_entity_name AS raw_name, COUNT(*) AS row_count,
                           MAX(business_date) AS latest_date, 'weighing' AS source
                    FROM wholesale_detail_records
                    WHERE raw_entity_name IS NOT NULL
                      AND TRIM(raw_entity_name) <> ''
                      AND (
                          entity_type = 'unknown'
                          OR standard_entity_name IS NULL
                          OR TRIM(standard_entity_name) = ''
                      )
                    GROUP BY raw_entity_name
                    UNION ALL
                    SELECT raw_customer_name AS raw_name, COUNT(*) AS row_count,
                           MAX(COALESCE(signed_date, effective_start, effective_end)) AS latest_date,
                           'contract' AS source
                    FROM contracts
                    WHERE raw_customer_name IS NOT NULL
                      AND TRIM(raw_customer_name) <> ''
                      AND customer_id IS NULL
                    GROUP BY raw_customer_name
                ) candidates
                GROUP BY raw_name
                ORDER BY row_count DESC, latest_date DESC
                LIMIT 1000
            ''')
            entity_rows = cur.fetchall()

            return jsonify({
                'code': 0,
                'data': {
                    'products': _candidate_items(product_rows, product_known),
                    'entities': _candidate_items(entity_rows, entity_known),
                },
            })
    finally:
        conn.close()


@bp_v2.route('/aliases/unmatched/ignore', methods=['POST'])
@jwt_required()
@permission_required('aliases:create')
def ignore_unmatched_aliases():
    payload = request.get_json() or {}
    items = payload.get('items') or []
    remark = (payload.get('remark') or '').strip()
    if not items:
        return jsonify({'code': 4221, 'message': 'No selected aliases', 'data': None}), 422
    conn = get_connection()
    try:
        inserted = 0
        skipped = 0
        operator_id = int(get_jwt_identity())
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _ensure_alias_ignore_schema(cur)
            for item in items:
                kind = item.get('kind')
                raw_name = (item.get('rawName') or '').strip()
                normalized = normalize_text(raw_name)
                if kind not in ('product', 'entity') or not normalized:
                    skipped += 1
                    continue
                cur.execute('''
                    INSERT IGNORE INTO alias_ignored_names
                        (kind, raw_name, normalized_name, operator_id, remark)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (kind, raw_name, normalized, operator_id, remark))
                if cur.rowcount:
                    inserted += 1
                else:
                    skipped += 1
        conn.commit()
        return jsonify({
            'code': 0,
            'message': 'success',
            'data': {'ignoredCount': inserted, 'skippedCount': skipped},
        })
    except Exception:
        conn.rollback()
        raise
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
