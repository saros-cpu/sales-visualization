from __future__ import annotations

from pathlib import Path

from flask import Response, jsonify, redirect, request, send_from_directory

from retail_internal import open_oilstation
from shared_utils import enrich_retail_station_statuses

_PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = _PROJECT_ROOT.parent / "OilStation"
FRONTEND_DIST = _PROJECT_ROOT.parent / "frontend" / "dist"

"""旧版零售代理路由（retail-app / api 代理，自 api.py 纯搬移拆分）。"""

RETAIL_API_PREFIXES = (
    "years",
    "months",
    "kpi",
    "dashboard",
    "resources",
    "monthly",
    "station",
    "station-map-details",
    "stations",
    "daily",
    "regions",
    "retail",
    "export",
    "integration",
    "assistant",
)

def api_retail_pages():
    base = "/retail"
    return jsonify({
        "baseUrl": base,
        "pages": [
            {"key": "dashboard", "label": "零售主页", "url": f"{base}"},
            {"key": "monthly", "label": "月度", "url": f"{base}/monthly"},
            {"key": "region", "label": "区域", "url": f"{base}/region"},
            {"key": "station", "label": "站点", "url": f"{base}/station"},
            {"key": "resource", "label": "油品", "url": f"{base}/resource"},
            {"key": "report", "label": "报表", "url": f"{base}/report"},
            {"key": "alert", "label": "预警", "url": f"{base}/alert"},
        ],
    })

def retail_app_file(filename=""):
    if not filename or filename.startswith("api/"):
        if filename.startswith("api/"):
            return proxy_oilstation_api(filename[4:])
        return redirect("/retail")
    ext = Path(filename).suffix.lower()
    if ext in {".html", ".htm"}:
        return send_from_directory(str(FRONTEND_DIST), "index.html")
    _OILSTATION_ALLOWED_EXT = {".css", ".js", ".json", ".geojson", ".png", ".jpg",
                               ".jpeg", ".webp", ".svg", ".woff", ".woff2", ".map"}
    if ext not in _OILSTATION_ALLOWED_EXT:
        return jsonify({"error": "not_found"}), 404
    response = send_from_directory(OILSTATION_ROOT, filename)
    if ext in _OILSTATION_ALLOWED_EXT:
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response

def proxy_oilstation_api(api_path):
    # v2 API paths are handled by the v2 blueprint — don't proxy them
    if api_path.split("/", 1)[0] == "v2":
        return jsonify({"error": "not_found"}), 404
    if api_path.split("/", 1)[0] not in RETAIL_API_PREFIXES:
        return jsonify({"error": "not_found"}), 404

    headers = {}
    if request.content_type:
        headers["Content-Type"] = request.content_type
    if request.headers.get("Accept"):
        headers["Accept"] = request.headers["Accept"]

    data = None if request.method in {"GET", "HEAD"} else request.get_data()
    response = open_oilstation(
        f"/api/{api_path}",
        method=request.method,
        query_string=request.query_string.decode("utf-8", errors="ignore"),
        data=data,
        headers=headers,
    )

    content_type = response.headers.get("Content-Type", "")
    if response.status_code < 400 and "application/json" in content_type and request.method == "GET":
        top = api_path.split("/", 1)[0]
        if top in {"dashboard", "monthly", "station", "stations", "regions"}:
            payload = response.get_json(silent=True)
            if payload is not None:
                payload = enrich_retail_station_statuses(payload)
                return jsonify(payload), response.status_code

    proxied = Response(
        response.get_data(),
        status=response.status_code,
        content_type=response.headers.get("Content-Type", "application/octet-stream"),
    )
    for header in ("Content-Disposition", "Cache-Control"):
        value = response.headers.get(header)
        if value:
            proxied.headers[header] = value
    return proxied

def retail_api_proxy(api_path):
    return proxy_oilstation_api(api_path)


def register_retail_legacy_routes(app):
    app.add_url_rule("/api/retail/pages", "api_retail_pages", api_retail_pages)
    app.add_url_rule("/retail-app/", "retail_app_file", retail_app_file)
    app.add_url_rule("/retail-app/", "retail_app_file", retail_app_file)
    app.add_url_rule("/retail-app/<path:filename>", "retail_app_file", retail_app_file)
    app.add_url_rule("/api/<path:api_path>", "retail_api_proxy", retail_api_proxy, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
