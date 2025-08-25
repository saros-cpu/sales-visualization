"""称重数据服务：合并视图、自动分类、修正叠加表"""

from datetime import date
from typing import Optional
import pymysql
from db import get_connection
from import_helpers import (
    classify_wholesale_movement,
    is_internal_entity_name,
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
)


# kj_weighing 中文列名 → 英文名映射
KJ_COLUMN_MAP = {
    'vehicle_no': '车号',
    'sender_name': '发货单位',
    'receiver_name': '收货单位',
    'raw_product_name': '货名',
}

CORRECTABLE_FIELDS = list(KJ_COLUMN_MAP.keys())


def ensure_weighing_review_schema(cur) -> None:
    cur.execute('''
        CREATE TABLE IF NOT EXISTS weighing_review_status (
            weighing_source VARCHAR(64) NOT NULL,
            weighing_id VARCHAR(64) NOT NULL,
            audit_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            classification VARCHAR(64) NULL,
            remark VARCHAR(255) NULL,
            operator_id BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (weighing_source, weighing_id),
            KEY idx_review_status (audit_status),
            KEY idx_review_classification (classification)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ''')


def auto_classify(sender_name: str, receiver_name: str) -> str:
    receiver = (receiver_name or '').strip().lower()

    def is_own_station(name: str) -> bool:
        keywords = ['азс', '加油站', 'апз', 'заправочная']
        return any(k in name for k in keywords)

    is_sender_company = is_internal_entity_name(sender_name)
    is_receiver_company = is_internal_entity_name(receiver_name)
    is_receiver_station = is_own_station(receiver)

    # 规则1: Example/CUSTOMER-S-АББР/油库 → 非自有设施 = 外销 (export_wholesale)
    if is_sender_company and not is_receiver_company and not is_receiver_station:
        return 'export_wholesale'
    # 规则2: Example/CUSTOMER-S-АББР/油库 → 自有设施 = 外运 (transfer，不是物资调拨)
    elif is_sender_company and (is_receiver_company or is_receiver_station):
        return 'transfer'
    # 规则3: 非Example/CUSTOMER-S-АББР/油库 → Example/CUSTOMER-S-АББР = 采购 (procurement)
    elif not is_sender_company and is_receiver_company:
        return 'procurement'
    # 规则4: 非Example/CUSTOMER-S-АББР/油库 → 非Example/CUSTOMER-S-АББР = 代加工 (processing)
    else:
        return 'processing'


def _correction_joins(table_alias: str, weighing_source: str, id_column: str = 'id') -> str:
    joins = []
    for field in CORRECTABLE_FIELDS:
        alias = f'wc_{field}'
        joins.append(
            f'LEFT JOIN weighing_corrections {alias} '
            f'ON {alias}.weighing_source = \'{weighing_source}\' '
            f'AND {alias}.weighing_id = {table_alias}.{id_column} '
            f'AND {alias}.field_name = \'{field}\''
        )
    return '\n'.join(joins)


def _correction_cols_kj(table_alias: str) -> str:
    """kj_weighing 含 COALESCE 的 SELECT 列（中文列名 + 统一 collation）"""
    cols = []
    for field in CORRECTABLE_FIELDS:
        alias = f'wc_{field}'
        cn_col = KJ_COLUMN_MAP[field]
        cols.append(f'COALESCE({alias}.new_value COLLATE utf8mb4_unicode_ci, {table_alias}.{cn_col}) AS {field}')
    return ', '.join(cols)


def _correction_cols_lpg(table_alias: str) -> str:
    """lpg_weighing 含 COALESCE 的 SELECT 列（英文列名 + 统一 collation）"""
    cols = []
    for field in CORRECTABLE_FIELDS:
        alias = f'wc_{field}'
        cols.append(f'COALESCE({alias}.new_value COLLATE utf8mb4_unicode_ci, {table_alias}.{field} COLLATE utf8mb4_unicode_ci) AS {field}')
    return ', '.join(cols)


def get_weighing_list(date_from: date, date_to: date,
                       vehicle_no: Optional[str] = None,
                       status: Optional[str] = None,
                       classification: Optional[str] = None,
                       product_name: Optional[str] = None,
                       entity_name: Optional[str] = None,
                       source: Optional[str] = None,
                       allowed_entity_names: Optional[list[str]] = None,
                       page: int = 1, page_size: int = 50) -> dict:
    conn = get_connection()
    try:
        params = [date_from, date_to]
        params_lpg = [date_from, date_to]
        if vehicle_no:
            params.append(f'%{vehicle_no}%')
            params_lpg.append(f'%{vehicle_no}%')

        # kj_weighing 子查询
        kj_select = ', '.join([
            'CAST(kw.序号 AS CHAR) AS id',
            'kw.编号 AS weigh_serial_no',
            _correction_cols_kj('kw'),
            'CAST(kw.毛重 AS DECIMAL(12,3)) AS gross_weight',
            'CAST(kw.皮重 AS DECIMAL(12,3)) AS tare_weight',
            'CAST(COALESCE(NULLIF(kw.实重, 0), NULLIF(kw.净重, 0), NULLIF(kw.毛重 - kw.皮重, 0)) AS DECIMAL(12,3)) AS net_weight',
            'DATE(kw.毛重日期) AS business_date',
            'kw.备注 AS remark',
        ])
        kj_joins = _correction_joins('kw', 'kj_weighing', '序号')
        kj_where = ['DATE(kw.毛重日期) BETWEEN %s AND %s', '(kw.作废 IS NULL OR kw.作废 = 0)']
        if vehicle_no:
            kj_where.append('kw.车号 LIKE %s')

        kj_sql = f'''SELECT 'storagedistrict' AS source, {kj_select}
FROM kj_weighing kw
{kj_joins}
WHERE {' AND '.join(kj_where)}'''

        # lpg_weighing 子查询
        lpg_select = ', '.join([
            'CAST(lpg.id AS CHAR) AS id',
            'lpg.weigh_serial_no COLLATE utf8mb4_unicode_ci AS weigh_serial_no',
            _correction_cols_lpg('lpg'),
            'lpg.gross_weight',
            'lpg.tare_weight',
            'lpg.net_weight',
            'lpg.business_date',
            'lpg.remark COLLATE utf8mb4_unicode_ci AS remark',
        ])
        lpg_joins = _correction_joins('lpg', 'lpg')
        lpg_where = ['lpg.business_date BETWEEN %s AND %s']
        if vehicle_no:
            lpg_where.append('lpg.vehicle_no LIKE %s')

        lpg_sql = f'''SELECT 'lpg' AS source, {lpg_select}
FROM lpg_weighing lpg
{lpg_joins}
WHERE {' AND '.join(lpg_where)}'''

        all_params = params + params_lpg

        union_sql = f'''SELECT * FROM (
    {kj_sql}
    UNION ALL
    {lpg_sql}
) AS combined ORDER BY business_date DESC, id DESC'''

        with conn.cursor(pymysql.cursors.DictCursor) as cur, conn.cursor() as lookup_cur:
            ensure_weighing_review_schema(cur)
            cur.execute('''
                SELECT weighing_source, weighing_id, audit_status, classification, remark
                FROM weighing_review_status
            ''')
            review_map = {
                (row['weighing_source'], str(row['weighing_id'])): row
                for row in cur.fetchall()
            }
            entity_lookup = load_entity_lookup(lookup_cur)
            product_lookup = load_product_lookup(lookup_cur)
            cur.execute(union_sql, all_params)
            all_items = []
            for row in cur.fetchall():
                sender = row.get('sender_name') or ''
                receiver = row.get('receiver_name') or ''
                raw_product = row.get('raw_product_name') or ''
                entity = lookup_entity(entity_lookup, receiver)
                product = lookup_product(product_lookup, raw_product)
                try:
                    item_classification = classify_wholesale_movement(
                        lookup_cur,
                        entity_lookup,
                        receiver,
                        sender_name=sender,
                        current='unknown',
                    )
                except Exception:
                    item_classification = auto_classify(sender, receiver)
                if not item_classification or item_classification == 'unknown':
                    item_classification = auto_classify(sender, receiver)
                review = review_map.get((row['source'], str(row['id'])))
                if review and review.get('classification'):
                    item_classification = review['classification']
                net_weight = float(row['net_weight'] or 0)
                item = {
                    'source': row['source'],
                    'id': row['id'],
                    'weighSerialNo': row.get('weigh_serial_no'),
                    'businessDate': str(row['business_date']) if row.get('business_date') else None,
                    'vehicleNo': row['vehicle_no'],
                    'senderName': sender,
                    'receiverName': receiver,
                    'rawProductName': row['raw_product_name'],
                    'standardProductName': product.get('display_name') if product else None,
                    'standardEntityName': entity.get('standard_name') if entity else None,
                    'entityType': entity.get('entity_type') if entity else 'unknown',
                    'entityCode': entity.get('entity_code') if entity else None,
                    'grossWeight': float(row['gross_weight']) if row['gross_weight'] else None,
                    'tareWeight': float(row['tare_weight']) if row['tare_weight'] else None,
                    'netWeight': net_weight,
                    'classification': item_classification,
                    'status': review['audit_status'] if review else 'pending',
                    'remark': row['remark'],
                    'reviewRemark': review.get('remark') if review else None,
                }
                if source and item['source'] != source:
                    continue
                if classification and item['classification'] != classification:
                    continue
                if product_name:
                    product_text = f"{item.get('rawProductName') or ''} {item.get('standardProductName') or ''}".lower()
                    if product_name.lower() not in product_text:
                        continue
                if entity_name:
                    entity_text = " ".join([
                        item.get('senderName') or '',
                        item.get('receiverName') or '',
                        item.get('standardEntityName') or '',
                    ]).lower()
                    if entity_name.lower() not in entity_text:
                        continue
                if allowed_entity_names is not None:
                    allowed_terms = [str(name).lower() for name in allowed_entity_names if name]
                    entity_text = " ".join([
                        item.get('senderName') or '',
                        item.get('receiverName') or '',
                        item.get('standardEntityName') or '',
                    ]).lower()
                    if not allowed_terms or not any(term in entity_text for term in allowed_terms):
                        continue
                if status and item['status'] != status:
                    continue
                all_items.append(item)

        total = len(all_items)
        total_weight = sum(float(item.get('netWeight') or 0) for item in all_items)
        offset = (page - 1) * page_size
        items = all_items[offset:offset + page_size]
        return {'items': items, 'total': total, 'totalWeight': round(total_weight, 3), 'page': page, 'page_size': page_size}
    finally:
        conn.close()


def verify_weighing(weighing_source: str, weighing_id: int,
                    field_name: str, old_value: str, new_value: str,
                    operator_id: int, remark: str = '') -> bool:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO weighing_corrections
                    (weighing_source, weighing_id, field_name, old_value, new_value, operator_id, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    new_value = VALUES(new_value),
                    operator_id = VALUES(operator_id),
                    remark = VALUES(remark),
                    updated_at = NOW()
            ''', (weighing_source, weighing_id, field_name, old_value, new_value, operator_id, remark))

            cur.execute('''
                INSERT INTO weighing_audit_log
                    (weighing_source, weighing_id, field_name, old_value, new_value, operator_id, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (weighing_source, weighing_id, field_name, old_value, new_value, operator_id, remark))

            conn.commit()
        return True
    finally:
        conn.close()


def batch_review_weighing(records: list[dict], action: str,
                          operator_id: int, classification: str | None = None,
                          remark: str = '') -> dict:
    valid_actions = {'approve', 'reject', 'classify'}
    if action not in valid_actions:
        raise ValueError('Unsupported batch action')
    if action == 'classify' and not classification:
        raise ValueError('classification is required')

    status_value = None
    if action == 'approve':
        status_value = 'approved'
    elif action == 'reject':
        status_value = 'rejected'

    conn = get_connection()
    try:
        success_count = 0
        errors = []
        with conn.cursor() as cur:
            ensure_weighing_review_schema(cur)
            for record in records:
                try:
                    source = str(record.get('source') or '').strip()
                    weighing_id = str(record.get('id') or '').strip()
                    if not source or not weighing_id:
                        raise ValueError('source and id are required')
                    next_classification = classification if action == 'classify' else record.get('classification')
                    if status_value:
                        cur.execute('''
                            INSERT INTO weighing_review_status
                                (weighing_source, weighing_id, audit_status, classification, remark, operator_id)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                audit_status = VALUES(audit_status),
                                classification = COALESCE(VALUES(classification), classification),
                                remark = VALUES(remark),
                                operator_id = VALUES(operator_id),
                                updated_at = NOW()
                        ''', (source, weighing_id, status_value, next_classification, remark, operator_id))
                    else:
                        cur.execute('''
                            INSERT INTO weighing_review_status
                                (weighing_source, weighing_id, audit_status, classification, remark, operator_id)
                            VALUES (%s, %s, 'pending', %s, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                classification = VALUES(classification),
                                remark = VALUES(remark),
                                operator_id = VALUES(operator_id),
                                updated_at = NOW()
                        ''', (source, weighing_id, next_classification, remark, operator_id))
                    success_count += 1
                except Exception as exc:
                    errors.append({'id': record.get('id'), 'source': record.get('source'), 'error': str(exc)})
        conn.commit()
        return {'successCount': success_count, 'errorCount': len(errors), 'errors': errors}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
