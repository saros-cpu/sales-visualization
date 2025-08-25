from flask import jsonify, request
from flask_jwt_extended import jwt_required

from api_v2 import bp_v2
from services.retail_alert_service import generate_retail_alert_insights, latest_retail_alert_insights
from .authz import permission_required


@bp_v2.route("/retail/alert-insights", methods=["GET"])
@jwt_required()
@permission_required("retail:view")
def get_retail_alert_insights():
    ym = request.args.get("ym") or None
    language = "ru" if (request.args.get("lang") or request.args.get("language") or "").lower().startswith("ru") else "zh"
    refresh = request.args.get("refresh") in {"1", "true", "yes"}
    data = generate_retail_alert_insights(ym, use_ai=True, language=language) if refresh else latest_retail_alert_insights(ym, language=language)
    return jsonify({"code": 0, "message": "success", "data": data})
