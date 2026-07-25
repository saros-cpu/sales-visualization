from flask import request, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from api_v2 import bp_v2
from .authz import permission_required
from calculations import recalculate_wholesale_batch
from db import get_connection
from import_helpers import classify_wholesale_movement, get_or_create_customer, load_entity_lookup
from text_utils import normalize_text
import pymysql
import re

CUSTOMER_TYPES = {'local_wholesale', 'export_wholesale', 'unknown'}
CUSTOMER_LIST_FILTERS = CUSTOMER_TYPES | {'classified'}
INTERNAL_USE_ENTITY_CODE = 'internal_use'
INTERNAL_USE_STANDARD_NAME = '内部用油'
NUMERIC_NOISE_RE = re.compile(r'^[0-9]+(?:[.,][0-9]+)?$')


def _row_value(row, key, index):
    return row.get(key) if isinstance(row, dict) else row[index]


def _normalize_customer_type(value):
    return value if value in CUSTOMER_TYPES else 'unknown'


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
    known = {_row_value(r, 'normalized_alias', 0) for r in cur.fetchall() if _row_value(r, 'normalized_alias', 0)}
    cur.execute('SELECT display_name FROM products WHERE is_active = 1')
    known.update(normalize_text(_row_value(r, 'display_name', 0)) for r in cur.fetchall() if _row_value(r, 'display_name', 0))
    return known


def _known_entity_names(cur):
    cur.execute('SELECT normalized_alias, standard_name, alias_name FROM entity_aliases')
    known = set()
    for row in cur.fetchall():
        normalized_alias = _row_value(row, 'normalized_alias', 0)
        standard_name = _row_value(row, 'standard_name', 1)
        alias_name = _row_value(row, 'alias_name', 2)
        if normalized_alias:
            known.add(normalized_alias)
        if standard_name:
            known.add(normalize_text(standard_name))
        if alias_name:
            known.add(normalize_text(alias_name))
    cur.execute('SELECT normalized_name FROM customers')
    known.update(_row_value(r, 'normalized_name', 0) for r in cur.fetchall() if _row_value(r, 'normalized_name', 0))
    return known


def _known_non_customer_entity_names(cur):
    cur.execute('''
        SELECT normalized_alias, standard_name, alias_name
        FROM entity_aliases
        WHERE entity_type IN ('retail_station', 'own_depot')
    ''')
    known = set()
    for row in cur.fetchall():
        normalized_alias = _row_value(row, 'normalized_alias', 0)
        standard_name = _row_value(row, 'standard_name', 1)
        alias_name = _row_value(row, 'alias_name', 2)
        if normalized_alias:
            known.add(normalized_alias)
        if standard_name:
            known.add(normalize_text(standard_name))
        if alias_name:
            known.add(normalize_text(alias_name))
    return known


def _known_merged_customer_alias_names(cur):
    cur.execute('''
        SELECT ea.normalized_alias, ea.standard_name, ea.entity_code,
               c.normalized_name AS target_normalized
        FROM entity_aliases ea
        LEFT JOIN customers c ON c.id = CAST(ea.entity_code AS UNSIGNED)
        WHERE ea.entity_type = 'wholesale_customer'
          AND ea.entity_code REGEXP '^[0-9]+$'
    ''')
    merged = set()
    for row in cur.fetchall():
        normalized_alias = _row_value(row, 'normalized_alias', 0)
        target_normalized = _row_value(row, 'target_normalized', 3)
        if normalized_alias and target_normalized and normalized_alias != target_normalized:
            merged.add(normalized_alias)
    return merged


def _is_numeric_noise(value):
    text = re.sub(r'\s+', '', str(value or '').strip())
    if not NUMERIC_NOISE_RE.fullmatch(text):
        return False
    return '.' in text or ',' in text or len(text) > 3


def _candidate_items(rows, known_names, limit=100, excluded_names=None, skip_numeric_noise=False):
    items = []
    seen = set()
    excluded_names = excluded_names or set()
    for row in rows:
        raw_name = (row.get('raw_name') or '').strip()
        normalized = normalize_text(raw_name)
        if (
            not raw_name
            or not normalized
            or normalized in known_names
            or normalized in excluded_names
            or normalized in seen
            or (skip_numeric_noise and _is_numeric_noise(raw_name))
        ):
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


def _customer_item(row):
    return {
        'id': row['id'],
        'name': row['standard_name'],
        'normalizedName': row['normalized_name'],
        'customerType': _normalize_customer_type(row['customer_type']),
        'contractCount': int(row.get('contract_count') or 0),
        'detailCount': int(row.get('detail_count') or 0),
        'detailTons': round(float(row.get('detail_tons') or 0), 3),
        'createdAt': row['created_at'].isoformat() if row.get('created_at') else None,
        'updatedAt': row['updated_at'].isoformat() if row.get('updated_at') else None,
    }


def _merge_customer_reference_stats(cur, rows):
    stats = {int(row['id']): {'contract_count': 0, 'detail_count': 0, 'detail_tons': 0} for row in rows}
    if not stats:
        return

    ids = list(stats.keys())
    placeholders = ','.join(['%s'] * len(ids))
    cur.execute(
        f'''
        SELECT customer_id, COUNT(*) AS contract_count
        FROM contracts
        WHERE customer_id IN ({placeholders})
        GROUP BY customer_id
        ''',
        ids,
    )
    for row in cur.fetchall():
        customer_id = int(row.get('customer_id') or 0)
        if customer_id in stats:
            stats[customer_id]['contract_count'] = int(row.get('contract_count') or 0)

    name_to_id = {}
    for row in rows:
        customer_id = int(row['id'])
        for name in (row.get('standard_name'), row.get('normalized_name')):
            normalized = normalize_text(name)
            if normalized and normalized not in name_to_id:
                name_to_id[normalized] = customer_id

    cur.execute(
        '''
        SELECT entity_code, standard_entity_name, raw_entity_name,
               COUNT(*) AS detail_count,
               COALESCE(SUM(weight_tons), 0) AS detail_tons
        FROM wholesale_detail_records
        WHERE entity_type = 'wholesale_customer'
        GROUP BY entity_code, standard_entity_name, raw_entity_name
        '''
    )
    for row in cur.fetchall():
        customer_id = None
        entity_code = str(row.get('entity_code') or '').strip()
        if entity_code.isdigit() and int(entity_code) in stats:
            customer_id = int(entity_code)
        if customer_id is None:
            for name in (row.get('standard_entity_name'), row.get('raw_entity_name')):
                customer_id = name_to_id.get(normalize_text(name))
                if customer_id is not None:
                    break
        if customer_id is None:
            continue
        stats[customer_id]['detail_count'] += int(row.get('detail_count') or 0)
        stats[customer_id]['detail_tons'] += float(row.get('detail_tons') or 0)

    for row in rows:
        row_stats = stats.get(int(row['id']), {})
        row['contract_count'] = row_stats.get('contract_count', 0)
        row['detail_count'] = row_stats.get('detail_count', 0)
        row['detail_tons'] = row_stats.get('detail_tons', 0)


def _reference_classification(entity_type, entity_code=None, customer_type=None):
    if entity_type == 'wholesale_customer':
        return customer_type if customer_type in ('local_wholesale', 'export_wholesale') else 'unknown'
    if entity_type == 'own_depot' and str(entity_code or '').strip() == INTERNAL_USE_ENTITY_CODE:
        return 'other'
    if entity_type in ('retail_station', 'own_depot'):
        return 'transfer'
    return 'unknown'


def _match_status_for_classification(classification, product_id=None):
    if classification in ('transfer', 'processing', 'procurement', 'other'):
        return 'matched' if product_id else 'unmatched'
    if classification == 'unknown':
        return 'needs_review'
    return 'unmatched'


def _sync_entity_reference(
    cur,
    entity_type,
    entity_code,
    standard_name,
    alias_name,
    customer_type=None,
    extra_names=None,
    extra_entity_codes=None,
):
    names = []
    for name in (alias_name, standard_name, *(extra_names or ())):
        name = (name or '').strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return {'detailUpdated': 0, 'classificationUpdated': 0, 'contractUpdated': 0, 'recalculatedBatches': 0}

    placeholders = ','.join(['%s'] * len(names))
    filters = [f"(raw_entity_name IN ({placeholders}) OR standard_entity_name IN ({placeholders}))"]
    filter_params = [*names, *names]
    codes = [str(code) for code in (extra_entity_codes or ()) if str(code or '').strip()]
    if codes:
        code_placeholders = ','.join(['%s'] * len(codes))
        filters.append(f"(entity_type = %s AND entity_code IN ({code_placeholders}))")
        filter_params.extend([entity_type, *codes])
    reference_filter = '(' + ' OR '.join(filters) + ')'
    cur.execute(
        f'''
        SELECT id
        FROM wholesale_detail_records
        WHERE {reference_filter}
        ''',
        filter_params,
    )
    reference_ids = [_row_value(row, 'id', 0) for row in cur.fetchall()]
    if not reference_ids:
        contract_updated = 0
        if entity_type == 'wholesale_customer' and str(entity_code or '').isdigit():
            sales_type = customer_type if customer_type in ('local_wholesale', 'export_wholesale') else 'unknown'
            cur.execute(
                f'''
                UPDATE contracts
                SET customer_id = %s,
                    sales_type = %s
                WHERE customer_id IS NULL
                  AND raw_customer_name IN ({placeholders})
                ''',
                [int(entity_code), sales_type, *names],
            )
            contract_updated = cur.rowcount
        return {
            'detailUpdated': 0,
            'classificationUpdated': 0,
            'contractUpdated': contract_updated,
            'recalculatedBatches': 0,
        }
    id_placeholders = ','.join(['%s'] * len(reference_ids))
    cur.execute(
        f'''
        UPDATE wholesale_detail_records
        SET entity_type = %s,
            entity_code = %s,
            standard_entity_name = %s
        WHERE id IN ({id_placeholders})
        ''',
        [entity_type, entity_code or None, standard_name, *reference_ids],
    )
    detail_updated = cur.rowcount
    entity_lookup = load_entity_lookup(cur)
    cur.execute(
        f'''
        SELECT id, batch_id, raw_entity_name, sender_name, classification, product_id
        FROM wholesale_detail_records
        WHERE id IN ({id_placeholders})
        ''',
        reference_ids,
    )
    rows = cur.fetchall()
    classification_updated = 0
    affected_ids = []
    affected_batches = set()
    classification_cache = {}
    for row in rows:
        detail_id = _row_value(row, 'id', 0)
        batch_id = _row_value(row, 'batch_id', 1)
        raw_name = _row_value(row, 'raw_entity_name', 2)
        sender_name = _row_value(row, 'sender_name', 3)
        old_classification = _row_value(row, 'classification', 4)
        product_id = _row_value(row, 'product_id', 5)
        classification_key = (raw_name or '', sender_name or '')
        classification = classification_cache.get(classification_key)
        if classification is None:
            classification = classify_wholesale_movement(
                cur,
                entity_lookup,
                raw_name,
                sender_name=sender_name,
                current=old_classification,
            )
            classification_cache[classification_key] = classification
        match_status = _match_status_for_classification(classification, product_id)
        cur.execute(
            '''
            UPDATE wholesale_detail_records
            SET classification = %s,
                contract_id = NULL,
                match_status = %s
            WHERE id = %s
            ''',
            (classification, match_status, detail_id),
        )
        classification_updated += cur.rowcount
        affected_ids.append(detail_id)
        if batch_id is not None:
            affected_batches.add(batch_id)

    if affected_ids:
        cur.execute(f'DELETE FROM calculation_results WHERE detail_id IN ({id_placeholders})', affected_ids)
        cur.execute(
            f'''
            DELETE qi
            FROM data_quality_issues qi
            JOIN wholesale_detail_records d
              ON d.id = qi.related_id
             AND qi.related_table = 'wholesale_detail_records'
            WHERE d.id IN ({id_placeholders})
              AND qi.issue_type IN ('contract_unmatched', 'unknown_entity')
            ''',
            affected_ids,
        )

    for batch_id in sorted(affected_batches):
        recalculate_wholesale_batch(cur, batch_id)
    contract_updated = 0
    if entity_type == 'wholesale_customer' and str(entity_code or '').isdigit():
        sales_type = customer_type if customer_type in ('local_wholesale', 'export_wholesale') else 'unknown'
        cur.execute(
            f'''
            UPDATE contracts
            SET customer_id = %s,
                sales_type = %s
            WHERE customer_id IS NULL
              AND raw_customer_name IN ({placeholders})
            ''',
            [int(entity_code), sales_type, *names],
        )
        contract_updated = cur.rowcount
    return {
        'detailUpdated': detail_updated,
        'classificationUpdated': classification_updated,
        'contractUpdated': contract_updated,
        'recalculatedBatches': len(affected_batches),
    }


@bp_v2.route('/aliases/customers', methods=['GET'])
@jwt_required()
@permission_required('aliases:view')
def alias_customers():
    customer_type = (request.args.get('customerType') or '').strip()
    keyword = (request.args.get('keyword') or '').strip()
    filters = []
    params = []
    if customer_type in CUSTOMER_LIST_FILTERS:
        if customer_type == 'classified':
            filters.append("c.customer_type IN ('local_wholesale', 'export_wholesale')")
        elif customer_type == 'unknown':
            filters.append("c.customer_type NOT IN ('local_wholesale', 'export_wholesale')")
        else:
            filters.append('c.customer_type = %s')
            params.append(customer_type)
    if keyword:
        filters.append('(c.standard_name LIKE %s OR c.normalized_name LIKE %s)')
        like = f'%{keyword}%'
        params.extend([like, like])
    where = 'WHERE ' + ' AND '.join(filters) if filters else ''

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            product_names = _known_product_names(cur)
            non_customer_names = _known_non_customer_entity_names(cur)
            merged_customer_alias_names = _known_merged_customer_alias_names(cur)
            cur.execute(
                f"""
                SELECT
                    c.id,
                    c.standard_name,
                    c.normalized_name,
                    c.customer_type,
                    c.created_at,
                    c.updated_at
                FROM customers c
                {where}
                ORDER BY
                    CASE WHEN c.customer_type IN ('local_wholesale', 'export_wholesale') THEN 0 ELSE 1 END,
                    c.updated_at DESC,
                    c.created_at DESC,
                    c.standard_name
                LIMIT 1000
                """,
                tuple(params),
            )
            rows = [
                dict(row)
                for row in cur.fetchall()
                if normalize_text(row.get('standard_name')) not in product_names
                and row.get('normalized_name') not in product_names
                and normalize_text(row.get('standard_name')) not in non_customer_names
                and row.get('normalized_name') not in non_customer_names
                and normalize_text(row.get('standard_name')) not in merged_customer_alias_names
                and row.get('normalized_name') not in merged_customer_alias_names
            ]
            _merge_customer_reference_stats(cur, rows)
            return jsonify({
                'code': 0,
                'message': 'success',
                'data': [_customer_item(row) for row in rows],
            })
    finally:
        conn.close()


@bp_v2.route('/aliases/customers', methods=['POST'])
@jwt_required()
@permission_required('aliases:create')
def save_alias_customer():
    payload = request.get_json(silent=True) or {}
    name = (payload.get('name') or '').strip()
    customer_type = payload.get('customerType') if payload.get('customerType') in CUSTOMER_TYPES else 'unknown'
    if not name:
        return jsonify({'code': 4221, 'message': 'customer_name_required', 'data': None}), 422

    normalized = normalize_text(name)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if normalized in _known_product_names(cur):
                return jsonify({'code': 4222, 'message': 'customer_name_is_product', 'data': None}), 422
            customer_id = get_or_create_customer(cur, name, customer_type)
            cur.execute(
                """
                UPDATE customers
                SET standard_name = %s,
                    customer_type = %s
                WHERE id = %s
                """,
                (name, customer_type, customer_id),
            )
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES ('wholesale_customer', %s, %s, %s, %s, 100, 'customer_maintenance')
                ON DUPLICATE KEY UPDATE
                    entity_type = 'wholesale_customer',
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = GREATEST(confidence, VALUES(confidence)),
                    source = VALUES(source)
                """,
                (str(customer_id), name, name, normalized),
            )
            recalculation = {
                'entityReferences': _sync_entity_reference(
                    cur,
                    'wholesale_customer',
                    str(customer_id),
                    name,
                    name,
                    customer_type,
                ),
            }
        conn.commit()
        return jsonify({
            'code': 0,
            'message': 'success',
            'data': {'id': customer_id, 'recalculation': recalculation},
        })
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@bp_v2.route('/aliases/customers/merge', methods=['POST'])
@jwt_required()
@permission_required('aliases:create')
def merge_alias_customer():
    payload = request.get_json(silent=True) or {}
    source_customer_id = payload.get('sourceCustomerId')
    target_customer_id = payload.get('targetCustomerId')
    alias_name = (payload.get('aliasName') or '').strip()
    if not str(source_customer_id or '').isdigit() or not str(target_customer_id or '').isdigit():
        return jsonify({'code': 4221, 'message': 'sourceCustomerId and targetCustomerId required', 'data': None}), 422
    source_customer_id = int(source_customer_id)
    target_customer_id = int(target_customer_id)
    if source_customer_id == target_customer_id:
        return jsonify({'code': 4222, 'message': 'source and target customer cannot be the same', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                'SELECT id, standard_name, normalized_name, customer_type FROM customers WHERE id IN (%s, %s)',
                (source_customer_id, target_customer_id),
            )
            customers = {int(row['id']): row for row in cur.fetchall()}
            source = customers.get(source_customer_id)
            target = customers.get(target_customer_id)
            if not source or not target:
                return jsonify({'code': 4223, 'message': 'customer not found', 'data': None}), 404

            alias_name = alias_name or source['standard_name']
            normalized = normalize_text(alias_name)
            if not normalized:
                return jsonify({'code': 4224, 'message': 'aliasName required', 'data': None}), 422
            if normalized in _known_product_names(cur):
                return jsonify({'code': 4225, 'message': 'customer_name_is_product', 'data': None}), 422

            target_name = target['standard_name']
            target_type = _normalize_customer_type(target['customer_type'])
            target_code = str(target_customer_id)
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES ('wholesale_customer', %s, %s, %s, %s, 100, 'customer_merge')
                ON DUPLICATE KEY UPDATE
                    entity_type = 'wholesale_customer',
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = GREATEST(confidence, VALUES(confidence)),
                    source = VALUES(source)
                """,
                (target_code, target_name, alias_name, normalized),
            )

            names = []
            for name in (alias_name, source['standard_name'], target_name):
                value = (name or '').strip()
                if value and value not in names:
                    names.append(value)
            placeholders = ','.join(['%s'] * len(names))
            sync_result = _sync_entity_reference(
                cur,
                'wholesale_customer',
                target_code,
                target_name,
                alias_name,
                target_type,
                extra_names=(source['standard_name'],),
                extra_entity_codes=(source_customer_id,),
            )

            sales_type = target_type if target_type in ('local_wholesale', 'export_wholesale') else 'unknown'
            cur.execute(
                f"""
                UPDATE contracts
                SET customer_id = %s,
                    sales_type = %s
                WHERE customer_id = %s
                   OR raw_customer_name IN ({placeholders})
                """,
                [target_customer_id, sales_type, source_customer_id, *names],
            )
            contract_updated = cur.rowcount
        conn.commit()
        return jsonify({
            'code': 0,
            'message': 'success',
            'data': {
                'sourceCustomerId': source_customer_id,
                'targetCustomerId': target_customer_id,
                'aliasName': alias_name,
                    'recalculation': {
                        'entityReferences': {
                            **sync_result,
                            'contractUpdated': sync_result.get('contractUpdated', 0) + contract_updated,
                        },
                    },
                },
            })
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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
                    'products': _candidate_items(product_rows, product_known, skip_numeric_noise=True),
                    'entities': _candidate_items(entity_rows, entity_known, excluded_names=product_known, skip_numeric_noise=True),
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
                WHERE entity_type IN ('retail_station', 'own_depot')
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
            customer_type = None
            if entity_type == 'wholesale_customer' and str(entity_code or '').isdigit():
                cur.execute('SELECT customer_type FROM customers WHERE id = %s', (int(entity_code),))
                row = cur.fetchone()
                if row:
                    customer_type = _row_value(row, 'customer_type', 0)
            cur.execute(
                "INSERT INTO entity_aliases (entity_type, entity_code, standard_name, alias_name, normalized_alias, source) "
                "VALUES (%s,%s,%s,%s,%s,'manual') "
                "ON DUPLICATE KEY UPDATE "
                "entity_type=VALUES(entity_type), "
                "entity_code=VALUES(entity_code), "
                "standard_name=VALUES(standard_name), "
                "alias_name=VALUES(alias_name), "
                "source=VALUES(source)",
                (entity_type, entity_code, standard_name, alias_name, normalized),
            )
            recalculation = {
                'entityReferences': _sync_entity_reference(
                    cur,
                    entity_type,
                    entity_code,
                    standard_name,
                    alias_name,
                    customer_type,
                ),
            }
        conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': {'recalculation': recalculation}})
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
