import os

from flask import Blueprint, jsonify, send_file

from export_excel import EXPORT_DIR
from endpoints.v1.retail.analysis_report.service.common import _month_dataset, _year_dataset
from endpoints.v1.retail.analysis_report.service.docx import _write_reports

analysis_report_api = Blueprint("analysis_report_api_v2", __name__)


def register_analysis_report_routes(app):
    app.register_blueprint(analysis_report_api)


@analysis_report_api.route("/api/export/analysis/monthly/<year_month>")
def api_export_monthly_analysis(year_month):
    data = _month_dataset(year_month)
    files = _write_reports(data)
    return jsonify({"status": "ok", "kind": "monthly", "title": data["title"], **files})


@analysis_report_api.route("/api/export/analysis/yearly/<int:year>")
def api_export_yearly_analysis(year):
    data = _year_dataset(year)
    files = _write_reports(data)
    return jsonify({"status": "ok", "kind": "yearly", "title": data["title"], **files})


@analysis_report_api.route("/api/export/analysis/download/<path:filename>")
def api_download_analysis_report(filename):
    safe_name = os.path.basename(filename)
    path = os.path.join(EXPORT_DIR, safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "report not found"}), 404
    return send_file(path, as_attachment=True, download_name=safe_name)


@analysis_report_api.route("/api/export/analysis/view/<path:filename>")
def api_view_analysis_report(filename):
    safe_name = os.path.basename(filename)
    path = os.path.join(EXPORT_DIR, safe_name)
    if not os.path.exists(path):
        return jsonify({"error": "report not found"}), 404
    return send_file(path)
