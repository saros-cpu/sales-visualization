from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from db import get_connection
import pymysql
from datetime import datetime


@bp_v2.route('/contracts', methods=['GET'])
@jwt_required()
def contract_list():
    company = request.args.get('company', '')
    sort_by = request.args.get('sort_by', 'contractNo')
    sort_dir = request.args.get('sort_dir', 'desc')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))
    offset = (page - 1) * page_size

    order_expr = 'c.contract_no'
    if sort_by == 'contractNo':
        order_expr = 'CAST(SUBSTRING_INDEX(c.contract_no, \'-\', -1) AS UNSIGNED)'
    elif sort_by == 'signedDate':
        order_expr = 'c.signed_date'
    elif sort_by == 'quantityTons':
        order_expr = 'c.contract_quantity_tons'
    elif sort_by == 'executedTons':
        order_expr = 'executed_tons'
    order_dir = 'DESC' if sort_dir.lower() == 'desc' else 'ASC'

    where_clause = ''
    params = []
    if company:
        terms = company.split(',')
        like_clauses = []
        for term in terms:
            term = term.strip()
            if term:
                like_clauses.append('(c.raw_customer_name LIKE %s OR c.raw_customer_name LIKE %s)')
                params.extend([f'%{term}%', f'%{term.upper()}%'])
        if like_clauses:
            where_clause = ' AND (' + ' OR '.join(like_clauses)
        for term in terms:
            term = term.strip()
            if term:
                if term in ('Example', 'EX'):
                    like_clauses.append('c.contract_no LIKE %s')
                    params.append('EXHT%')
                elif term in ('油气公司', 'CUSTOMER-S-АББР'):
                    like_clauses.append('c.contract_no LIKE %s')
                    params.append('CUSTOMER-S-АББР%')
        if like_clauses:
            where_clause = ' AND (' + ' OR '.join(like_clauses) + ')'

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            order_expr = 'c.contract_no'
            if sort_by == 'contractNo':
                order_expr = 'CAST(SUBSTRING_INDEX(c.contract_no, \'-\', -1) AS UNSIGNED)'
            elif sort_by == 'signedDate':
                order_expr = 'c.signed_date'
            elif sort_by == 'quantityTons':
                order_expr = 'c.contract_quantity_tons'
            elif sort_by == 'executedTons':
                order_expr = 'executed_tons'
            order_dir = 'DESC' if sort_dir.lower() == 'desc' else 'ASC'

            cur.execute(f'''SELECT COUNT(DISTINCT c.id) FROM contracts c LEFT JOIN contract_monthly_volumes cm ON c.id = cm.contract_id WHERE 1=1{where_clause}''', params)
            total = cur.fetchone()['COUNT(DISTINCT c.id)']

            cur.execute(f'''
                SELECT c.id, c.contract_no, c.appendix_no, c.signed_date,
                       c.effective_start, c.effective_end, c.raw_customer_name,
                       c.raw_product_name, c.sales_type, c.contract_quantity_tons,
                       c.contract_amount_original, c.currency_code,
                       COALESCE(SUM(cm.volume_tons), 0) AS executed_tons
                FROM contracts c
                LEFT JOIN contract_monthly_volumes cm ON c.id = cm.contract_id
                WHERE 1=1{where_clause}
                GROUP BY c.id
                ORDER BY {order_expr} {order_dir}
                LIMIT {page_size} OFFSET {offset}
            ''', params)
            items = []
            for row in cur.fetchall():
                items.append({
                    'id': row['id'],
                    'contractNo': row['contract_no'],
                    'appendixNo': row['appendix_no'],
                    'signedDate': str(row['signed_date']),
                    'effectiveStart': str(row['effective_start']),
                    'effectiveEnd': str(row['effective_end']),
                    'customerName': row['raw_customer_name'],
                    'productName': row['raw_product_name'],
                    'salesType': row['sales_type'],
                    'quantityTons': float(row['contract_quantity_tons']) if row['contract_quantity_tons'] else None,
                    'amountOriginal': float(row['contract_amount_original']) if row['contract_amount_original'] else None,
                    'currency': row['currency_code'],
                    'executedTons': float(row['executed_tons']),
                })
            return jsonify({'code': 0, 'message': 'success', 'data': {'items': items, 'total': total}})
    finally:
        conn.close()


@bp_v2.route('/contracts', methods=['POST'])
@jwt_required()
def create_contract():
    data = request.get_json() or {}
    required = ['contractNo', 'customerName', 'productName']
    if not all(k in data for k in required):
        return jsonify({'code': 4221, 'message': '参数不完整', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO contracts
                    (contract_no, appendix_no, signed_date, effective_start, effective_end,
                     raw_customer_name, raw_product_name, sales_type, contract_quantity_tons,
                     contract_amount_original, currency_code, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ''', (
                data.get('contractNo'),
                data.get('appendixNo'),
                data.get('signedDate'),
                data.get('effectiveStart'),
                data.get('effectiveEnd'),
                data.get('customerName'),
                data.get('productName'),
                data.get('salesType'),
                data.get('quantityTons'),
                data.get('amountOriginal'),
                data.get('currency'),
                data.get('remark'),
            ))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route('/contracts/<int:contract_id>', methods=['PUT'])
@jwt_required()
def update_contract(contract_id):
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            updates = []
            params = []
            field_map = {
                'contractNo': 'contract_no',
                'appendixNo': 'appendix_no',
                'signedDate': 'signed_date',
                'effectiveStart': 'effective_start',
                'effectiveEnd': 'effective_end',
                'customerName': 'raw_customer_name',
                'productName': 'raw_product_name',
                'salesType': 'sales_type',
                'quantityTons': 'contract_quantity_tons',
                'amountOriginal': 'contract_amount_original',
                'currency': 'currency_code',
                'remark': 'remark',
            }
            for json_key, db_col in field_map.items():
                if json_key in data:
                    updates.append(f'{db_col} = %s')
                    params.append(data[json_key])
            if updates:
                params.append(contract_id)
                cur.execute(f'UPDATE contracts SET {", ".join(updates)} WHERE id = %s', params)
                conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/contracts/<int:contract_id>/execution', methods=['GET'])
@jwt_required()
def contract_execution(contract_id):
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT c.*, cm.year_month, cm.volume_tons AS executed_tons
                FROM contracts c
                LEFT JOIN contract_monthly_volumes cm ON c.id = cm.contract_id
                WHERE c.id = %s
                ORDER BY cm.year_month
            ''', (contract_id,))
            rows = cur.fetchall()
            if not rows:
                return jsonify({'code': 4004, 'message': '合同不存在', 'data': None}), 404

            contract = dict(rows[0])
            monthly = []
            for row in rows:
                if row.get('year_month'):
                    monthly.append({
                        'yearMonth': str(row['year_month']),
                        'executedTons': float(row['executed_tons']),
                    })

            result = {
                'id': contract['id'],
                'contractNo': contract['contract_no'],
                'customerName': contract['raw_customer_name'],
                'productName': contract['raw_product_name'],
                'quantityTons': float(contract['contract_quantity_tons']) if contract['contract_quantity_tons'] else None,
                'effectiveStart': str(contract['effective_start']),
                'effectiveEnd': str(contract['effective_end']),
                'monthly': monthly,
            }
            return jsonify({'code': 0, 'message': 'success', 'data': result})
    finally:
        conn.close()


@bp_v2.route('/contracts/<int:contract_id>/auto-volume', methods=['GET'])
@jwt_required()
def contract_auto_volume(contract_id):
    """根据称重数据自动统计月拉运量"""
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT DATE_FORMAT(w.business_date, '%%Y-%%m') AS year_month,
                       SUM(w.net_weight / 1000) AS volume_tons
                FROM wholesale_detail_records w
                WHERE w.contract_id = %s
                GROUP BY year_month
                ORDER BY year_month
            ''', (contract_id,))
            monthly = [{'yearMonth': r['year_month'], 'volumeTons': round(float(r['volume_tons']), 3)} for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': monthly})
    finally:
        conn.close()
