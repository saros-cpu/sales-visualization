from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from db import get_connection
import pymysql


@bp_v2.route('/transfer/loss', methods=['GET'])
@jwt_required()
def transfer_loss():
    year = request.args.get('year')
    quarter = request.args.get('quarter')

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            where = ['1=1']
            params = []
            if year:
                where.append('YEAR(report_date) = %s')
                params.append(year)
            if quarter:
                where.append('QUARTER(report_date) = %s')
                params.append(quarter)

            # 从零售季度盘库数据查询
            sql = f'''
                SELECT station_name, system_qty, actual_qty,
                       (system_qty - actual_qty) AS loss_qty,
                       CASE WHEN system_qty > 0 
                           THEN ROUND((system_qty - actual_qty) / system_qty * 100, 2) 
                           ELSE 0 END AS loss_rate,
                       report_date
                FROM retail_inventory_check
                WHERE {" AND ".join(where)}
                ORDER BY report_date DESC, station_name
            '''
            try:
                cur.execute(sql, params)
                items = [dict(r) for r in cur.fetchall()]
            except pymysql.err.ProgrammingError:
                # retail_inventory_check 表可能不存在，返回空
                items = []

            return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        conn.close()
