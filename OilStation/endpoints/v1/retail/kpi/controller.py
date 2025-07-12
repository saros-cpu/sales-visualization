from datetime import datetime

from flask import Blueprint, jsonify, request

from endpoints.v1.retail.kpi.service import (
    cache_allowed,
    get_current_kpi,
    get_yearly_kpi,
)

kpi_api = Blueprint("retail_kpi", __name__, url_prefix="/api")


@kpi_api.route("/kpi")
def api_kpi():
    result = get_current_kpi()
    return jsonify(result)


@kpi_api.route("/kpi/yearly")
def api_kpi_yearly():
    year = request.args.get("year", type=int) or datetime.now().year
    include_inventory = str(request.args.get("inventory", "1")).lower() not in {"0", "false", "no"}
    result = get_yearly_kpi(year, include_inventory)
    return jsonify(result)


def register_kpi_routes(app):
    app.register_blueprint(kpi_api)
