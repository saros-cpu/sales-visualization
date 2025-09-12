from flask import jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from db import get_connection
import pymysql
from datetime import date, timedelta
from .authz import permission_required


def _safe_query(cur, sql, params=None):
    """安全的查询，表不存在时返回 0 或空"""
    try:
        cur.execute(sql, params or ())
        return cur.fetchone()
    except pymysql.err.ProgrammingError:
        return None


@bp_v2.route('/dashboard/overview', methods=['GET'])
@jwt_required()
@permission_required('dashboard:view')
def overview():
    today = date.today()
    year_start = today.replace(month=1, day=1)

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            kpi = {}

            row = _safe_query(cur, '''
                SELECT COALESCE(SUM(weight_tons), 0) AS wholesale_tons
                FROM wholesale_detail_records
                WHERE business_date >= %s AND business_date <= %s
            ''', (year_start, today))
            kpi['yearlyWholesaleTons'] = round(float(row['wholesale_tons']), 3) if row else 0

            row = _safe_query(cur, '''
                SELECT COUNT(*) AS active_contracts
                FROM contracts
                WHERE effective_start <= %s AND effective_end >= %s
            ''', (today, today))
            kpi['activeContracts'] = row['active_contracts'] if row else 0

            row = _safe_query(cur, '''
                SELECT COALESCE(SUM(weight_tons), 0) AS procurement_tons
                FROM wholesale_detail_records
                WHERE classification = 'procurement' AND business_date >= %s AND business_date <= %s
            ''', (year_start, today))
            kpi['yearlyProcurementTons'] = round(float(row['procurement_tons']), 3) if row else 0

            return jsonify({'code': 0, 'message': 'success', 'data': kpi})
    finally:
        conn.close()


@bp_v2.route('/dashboard/market-watch', methods=['GET'])
@jwt_required()
@permission_required('dashboard:view')
def market_watch():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, market_region, market_type, title, summary,
                       price_text, source_name, source_url, observed_at
                FROM market_watch_items
                WHERE is_active = TRUE
                  AND market_region IN ('Russia', 'Uzbekistan', 'Global')
                ORDER BY observed_at DESC, priority ASC, id DESC
                LIMIT 30
            ''')
            rows = cur.fetchall()
            items = []
            for r in rows:
                items.append({
                    'id': r['id'],
                    'region': r['market_region'],
                    'type': r['market_type'],
                    'title': r['title'],
                    'summary': r['summary'],
                    'priceText': r['price_text'] or '',
                    'sourceName': r['source_name'] or '',
                    'sourceUrl': r['source_url'] or '',
                    'observedAt': r['observed_at'].isoformat() if r['observed_at'] else None,
                })
            return jsonify({'code': 0, 'data': {'items': items, 'updatedAt': items[0]['observedAt'] if items else None}})
    finally:
        conn.close()
