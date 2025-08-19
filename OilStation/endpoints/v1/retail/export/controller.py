import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from loguru import logger

from db import get_connection
from export_excel import EXPORT_DIR, MONTH_NAMES_CN
from endpoints.v1.retail.export.service.workbook import _latest_report_workbook
from endpoints.v1.retail.export.service.generator import generate_monthly_excel
from datetime import datetime, timedelta

from endpoints.v1.retail.analytics.controller import _build_self_use_month_response

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
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    parts = year_month.split('-')
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        return jsonify({'error': 'invalid year_month'}), 400

    snapshot = _build_self_use_month_response(year_month)
    if not snapshot:
        return jsonify({'error': 'self-use snapshot not found'}), 404

    wb = Workbook()
    ws = wb.active
    ws.title = '自用油'

    headers = ['日期', '站点', '油品', '车牌号', '数量(L)', '金额(сом)']
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

    for i, rec in enumerate(snapshot.get('records', []), 2):
        values = [
            rec.get('date', ''),
            rec.get('stationName', ''),
            rec.get('productName', ''),
            rec.get('plateNumber', ''),
            float(rec.get('volume') or 0),
            float(rec.get('amount') or 0),
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


@export_api.route('/api/export/self-use')
def api_export_self_use_range():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    if not date_from or not date_to:
        return jsonify({'error': 'date_from and date_to are required'}), 400

    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from collections import defaultdict

    try:
        d = datetime.strptime(date_from, '%Y-%m-%d')
        end_dt = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
    except ValueError:
        return jsonify({'error': 'invalid date format, expected YYYY-MM-DD'}), 400

    months = []
    while d < end_dt:
        months.append(d.strftime('%Y-%m'))
        if d.month == 12:
            d = d.replace(year=d.year + 1, month=1, day=1)
        else:
            d = d.replace(month=d.month + 1, day=1)

    records = []
    for ym in months:
        snap = _build_self_use_month_response(ym)
        if not snap:
            continue
        for rec in snap.get('records', []):
            if date_from <= rec['date'] <= date_to:
                records.append(rec)

    header_fill = PatternFill(start_color='CC0000', end_color='CC0000', fill_type='solid')
    header_font = Font(bold=True, size=11, color='FFFFFF')
    center_align = Alignment(horizontal='center', vertical='center')
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    wb = Workbook()

    # Sheet 1: 自用油 (detail)
    ws = wb.active
    ws.title = '自用油'

    headers = ['日期', '时间', '站点', '油品', '车牌号', '数量(L)']
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border

    for i, rec in enumerate(records, 2):
        values = [
            rec['date'],
            rec['time'],
            rec['stationName'],
            rec['productName'],
            rec['plateNumber'],
            rec['volume'],
        ]
        for col_idx, v in enumerate(values, 1):
            cell = ws.cell(row=i, column=col_idx, value=v)
            cell.alignment = center_align
            cell.border = thin_border
            if col_idx == 6:
                cell.number_format = '#,##0.00'

    PLATE_WIDTH = 48

    for col_cells in ws.columns:
        col_letter = col_cells[0].column_letter
        if col_letter == 'E':
            ws.column_dimensions[col_letter].width = PLATE_WIDTH
            continue
        lengths = []
        for cell in col_cells:
            if cell.value is None:
                continue
            s = str(cell.value)
            lengths.append(sum(2 if ord(c) > 127 else 1 for c in s))
        if lengths:
            ws.column_dimensions[col_letter].width = min(max(max(lengths) + 2, 8), 40)

    # Sheet 2: 总表
    COMPANY_IDS = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 35, 40, 43, 44, 45, 46, 55, 56}

    company = defaultdict(float)
    employee = defaultdict(float)

    for rec in records:
        pk = int(rec.get('personKey') or 0)
        key = (rec['plateNumber'], rec['productName'])
        if pk in COMPANY_IDS:
            company[key] += rec['volume']
        else:
            employee[key] += rec['volume']

    company_sorted = sorted(company.items())
    employee_sorted = sorted(employee.items())

    ws2 = wb.create_sheet('总表')

    ws2.merge_cells('A1:C1')
    ws2.merge_cells('E1:G1')

    cell = ws2.cell(row=1, column=1, value='公司车辆')
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = center_align
    cell.border = thin_border
    for c in (2, 3):
        ws2.cell(row=1, column=c).border = thin_border
        ws2.cell(row=1, column=c).fill = header_fill

    cell = ws2.cell(row=1, column=5, value='员工车辆')
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = center_align
    cell.border = thin_border
    for c in (6, 7):
        ws2.cell(row=1, column=c).border = thin_border
        ws2.cell(row=1, column=c).fill = header_fill

    col_headers = {1: '车牌号', 2: '油品', 3: '加油量(L)', 5: '车牌号', 6: '油品', 7: '加油量(L)'}
    for col, h in col_headers.items():
        cell = ws2.cell(row=2, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border

    max_rows = max(len(company_sorted), len(employee_sorted))
    for idx in range(max_rows):
        row = idx + 3
        if idx < len(company_sorted):
            (plate, product), vol = company_sorted[idx]
            for c, v in [(1, plate), (2, product), (3, round(vol, 2))]:
                cell = ws2.cell(row=row, column=c, value=v)
                cell.alignment = center_align
                cell.border = thin_border
                if c == 3:
                    cell.number_format = '#,##0.00'
        if idx < len(employee_sorted):
            (plate, product), vol = employee_sorted[idx]
            for c, v in [(5, plate), (6, product), (7, round(vol, 2))]:
                cell = ws2.cell(row=row, column=c, value=v)
                cell.alignment = center_align
                cell.border = thin_border
                if c == 7:
                    cell.number_format = '#,##0.00'

    subtotal_row = max_rows + 3
    bold_font = Font(bold=True, size=11)
    for col, val in [(1, '小计'), (3, round(sum(v for _, v in company_sorted), 2)),
                     (5, '小计'), (7, round(sum(v for _, v in employee_sorted), 2))]:
        cell = ws2.cell(row=subtotal_row, column=col, value=val)
        cell.font = bold_font
        cell.alignment = center_align
        cell.border = thin_border
        if col in (3, 7):
            cell.number_format = '#,##0.00'

    for col_cells in ws2.columns:
        first = col_cells[0]
        if not hasattr(first, 'column_letter'):
            continue
        col_letter = first.column_letter
        if col_letter in ('A', 'E'):
            ws2.column_dimensions[col_letter].width = PLATE_WIDTH
        elif col_letter in ('B', 'F'):
            ws2.column_dimensions[col_letter].width = 12
        elif col_letter == 'C':
            ws2.column_dimensions[col_letter].width = 14
        elif col_letter == 'D':
            ws2.column_dimensions[col_letter].width = 3
        elif col_letter == 'G':
            ws2.column_dimensions[col_letter].width = 14

    bio = BytesIO()
    wb.save(bio)
    bio.seek(0)

    return send_file(bio, as_attachment=True,
                     download_name=f'自用油_{date_from}_to_{date_to}.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
