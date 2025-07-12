import os
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from loguru import logger

from db import get_connection
from export_excel import EXPORT_DIR, MONTH_NAMES_CN
from endpoints.v1.retail.export.service.workbook import _latest_report_workbook
from endpoints.v1.retail.export.service.generator import generate_monthly_excel
from datetime import datetime, timedelta

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
