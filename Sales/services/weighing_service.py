"""称重数据服务：合并视图、自动分类、修正叠加表"""

from datetime import date
from typing import Optional
import pymysql
from db import get_connection


# kj_weighing 中文列名 → 英文名映射
KJ_COLUMN_MAP = {
    'vehicle_no': '车号',
    'sender_name': '发货单位',
    'receiver_name': '收货单位',
    'raw_product_name': '货名',
}

CORRECTABLE_FIELDS = list(KJ_COLUMN_MAP.keys())


def auto_classify(sender_name: str, receiver_name: str) -> str:
    sender = (sender_name or '').strip().lower()
    receiver = (receiver_name or '').strip().lower()

    def is_company(name: str) -> bool:
        keywords = ['Example', 'кпк', '公司本部', 'STN-61', '南方CTY-22', '北方REG-08',
                    'главный склад', 'южный', 'северный']
        return any(k in name for k in keywords)

    def is_own_station(name: str) -> bool:
        keywords = ['азс', '加油站', 'апз', 'заправочная']
        return any(k in name for k in keywords)

    is_sender_company = is_company(sender)
    is_receiver_company = is_company(receiver)
    is_receiver_station = is_own_station(receiver)

    if is_sender_company and not is_receiver_company and not is_receiver_station:
        return 'export_wholesale'
    elif is_sender_company and (is_receiver_company or is_receiver_station):
        return 'external_transport'
    elif not is_sender_company and is_receiver_company:
        return 'procurement'
    elif not is_sender_company and not is_receiver_company:
        return 'toll_processing'
    else:
        return 'unknown'


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
                       source: Optional[str] = None,
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
            'CAST(kw.净重 AS DECIMAL(12,3)) AS net_weight',
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

        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(f'SELECT COUNT(*) AS total FROM ({union_sql}) AS c', all_params)
            total = cur.fetchone()['total']

            # 全量总重量（跨所有页）
            cur.execute(f'SELECT COALESCE(SUM(net_weight), 0) AS total_weight FROM ({union_sql}) AS c', all_params)
            total_weight = float(cur.fetchone()['total_weight'])

            offset = (page - 1) * page_size
            paginated_sql = f'{union_sql} LIMIT %s OFFSET %s'
            all_params.extend([page_size, offset])

            cur.execute(paginated_sql, all_params)
            items = []
            for row in cur.fetchall():
                sender = row.get('sender_name') or ''
                receiver = row.get('receiver_name') or ''
                items.append({
                    'source': row['source'],
                    'id': row['id'],
                    'weighSerialNo': row.get('weigh_serial_no'),
                    'businessDate': str(row['business_date']) if row.get('business_date') else None,
                    'vehicleNo': row['vehicle_no'],
                    'senderName': sender,
                    'receiverName': receiver,
                    'rawProductName': row['raw_product_name'],
                    'grossWeight': float(row['gross_weight']) if row['gross_weight'] else None,
                    'tareWeight': float(row['tare_weight']) if row['tare_weight'] else None,
                    'netWeight': float(row['net_weight']),
                    'classification': auto_classify(sender, receiver),
                    'status': 'pending',
                    'remark': row['remark'],
                })

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
