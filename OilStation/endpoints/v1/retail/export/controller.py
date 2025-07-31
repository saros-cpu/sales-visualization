import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from loguru import logger

from db import get_connection
from export_excel import EXPORT_DIR, MONTH_NAMES_CN
from endpoints.v1.retail.export.service.workbook import _latest_report_workbook
from endpoints.v1.retail.export.service.generator import generate_monthly_excel
from datetime import datetime, timedelta

from constants import SHOP_KEY_MAP
from endpoints.v1.retail.analytics.controller import RESOURCE_NAMES

export_api = Blueprint("export_api_v2", __name__)


def register_export_routes(app):
    app.register_blueprint(export_api)


@export_api.route('/api/export/monthly/<year_month>')
def api_export_monthly_excel(year_month):
    force_refresh = str(request.args.get("refresh") or "").lower() in {"1", "true", "yes"}
    conn = get_connection()
    try:
        result = generate_monthly_excel(conn, year_month, force_refresh=force_refresh)
        return jsonify(result)
    finally:
        conn.close()


@export_api.route('/api/export/monthly/<year_month>/download')
def api_export_download(year_month):
    cached_workbook = _latest_report_workbook(year_month)
    if cached_workbook and cached_workbook.exists():
        return send_file(cached_workbook, as_attachment=True, download_name=cached_workbook.name)

    y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
    month_cn = MONTH_NAMES_CN.get(m, f'{m}月')
    yesterday = datetime.now() - timedelta(days=1)
    gen_date = yesterday.strftime('%d.%m')
    filename = f'加油站{month_cn}日销表{gen_date}.xlsx'
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'File not found, please generate first'}), 404

    display_name = f'加油站{month_cn}日销表{gen_date}.xlsx'
    return send_file(filepath, as_attachment=True, download_name=display_name)


@export_api.route('/api/export/self-use/<year_month>')
def api_export_self_use(year_month):
    from io import BytesIO
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    parts = year_month.split('-')
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        return jsonify({'error': 'invalid year_month'}), 400

    conn = get_connection()
    try:
        cur = conn.cursor()
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start = f'{year_month}-01'
        ym_end = f'{y + 1}-01-01' if m == 12 else f'{y}-{m + 1:02d}-01'

        cur.execute("""
            SELECT s.ShopKey, s.ResourceKey, s.Volume, s.ShopCost,
                   DATE(s.TransactionDatetime) as trx_date,
                   CONVERT(p.Name USING utf8mb4) as plate_number
            FROM selling s
            LEFT JOIN person p ON s.PersonKey = p.PersonKey
            WHERE s.DerivedPaymentTypeKey = 2
              AND s.TransactionDatetime >= %s AND s.TransactionDatetime < %s
            ORDER BY s.TransactionDatetime DESC
        """, (ym_start, ym_end))

        rows = cur.fetchall()

        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = '自用油'

        headers = ['日期', '站点', '油品', '车牌号', '数量(L)', '金额(сом)']
        header_font = Font(bold=True, size=11)
        header_fill = PatternFill(start_color='CC0000', end_color='CC0000', fill_type='solid')
        header_font_white = Font(bold=True, size=11, color='FFFFFF')
        thin_border = Border(
            left=Side(style='thin'), right=Side(style='thin'),
            top=Side(style='thin'), bottom=Side(style='thin')
        )

        for col_idx, h in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=h)
            cell.font = header_font_white
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal='center')
            cell.border = thin_border

        for i, r in enumerate(rows, 2):
            sk = int(r[0]) if r[0] else 0
            rk = int(r[1]) if r[1] else 0
            info = SHOP_KEY_MAP.get(sk, {'name': f'Station-{sk}'})
            values = [
                str(r[4]) if r[4] else '',
                info['name'],
                RESOURCE_NAMES.get(rk, f'Other-{rk}'),
                r[5] if r[5] else '',
                float(r[2] or 0),
                float(r[3] or 0),
            ]
            for col_idx, v in enumerate(values, 1):
                cell = ws.cell(row=i, column=col_idx, value=v)
                cell.border = thin_border
                if col_idx in (5, 6):
                    cell.number_format = '#,##0.00'

        ws.column_dimensions['A'].width = 14
        ws.column_dimensions['B'].width = 22
        ws.column_dimensions['C'].width = 12
        ws.column_dimensions['D'].width = 28
        ws.column_dimensions['E'].width = 14
        ws.column_dimensions['F'].width = 16

        bio = BytesIO()
        wb.save(bio)
        bio.seek(0)

        return send_file(bio, as_attachment=True, download_name=f'自用油_{year_month}.xlsx',
                         mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    finally:
        conn.close()
