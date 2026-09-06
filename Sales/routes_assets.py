from __future__ import annotations

from pathlib import Path

from flask import jsonify, send_from_directory

_PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = _PROJECT_ROOT.parent / "OilStation"
SHARED_ASSETS_ROOT = _PROJECT_ROOT.parent / "assets"
FRONTEND_DIST = _PROJECT_ROOT.parent / "frontend" / "dist"

"""SPA 页面与静态资源路由（自 api.py 纯搬移拆分，行为零变化）。"""

def index():
    return send_from_directory(str(FRONTEND_DIST), "index.html")

def login_page():
    return send_from_directory(str(FRONTEND_DIST), "index.html")

def admin_page():
    return send_from_directory(str(FRONTEND_DIST), "index.html")

def wholesale_page(section=None):
    return send_from_directory(str(FRONTEND_DIST), "index.html")

def retail_page(page=None):
    return send_from_directory(str(FRONTEND_DIST), "index.html")

def shared_asset(filename):
    allowed = {"echarts.min.js", "kgz_merged.json"}
    if filename.startswith("kgz-map/"):
        response = send_from_directory(SHARED_ASSETS_ROOT, filename)
        response.headers["Cache-Control"] = "public, max-age=604800"
        return response
    if filename not in allowed:
        return jsonify({"error": "not_found"}), 404
    response = send_from_directory(OILSTATION_ROOT, filename)
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response

def kgz_map_legacy_asset(filename):
    response = send_from_directory(SHARED_ASSETS_ROOT / "kgz-map", filename)
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response


# ── React SPA static assets ──

def react_static(filename):
    response = send_from_directory(str(FRONTEND_DIST / "_next"), filename)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# ── Root-level static files used by React SPA (echarts, etc.) ──

def echarts_js():
    response = send_from_directory(str(OILSTATION_ROOT), "echarts.min.js")
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response


# ── 3D 地图页面 ──

def map_page():
    map_html = SHARED_ASSETS_ROOT / "kgz-map" / "full-map.html"
    if map_html.exists():
        return send_from_directory(str(map_html.parent), "full-map.html")
    return jsonify({"error": "map_not_found"}), 404


# ── SPA catch-all ──
# Any route not matched above serves the React SPA index.html

def spa_catchall(path):
    # Don't catch API or file routes
    if path.startswith("api/") or path.startswith("retail-app/"):
        return jsonify({"error": "not_found"}), 404
    # Try serving from OilStation for legacy static assets
    oilstation_file = OILSTATION_ROOT / path
    if oilstation_file.is_file():
        response = send_from_directory(str(OILSTATION_ROOT), path)
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response
    index_path = FRONTEND_DIST / "index.html"
    if index_path.exists():
        return send_from_directory(str(FRONTEND_DIST), "index.html")
    return jsonify({"error": "frontend not built"}), 503


def register_assets_routes(app):
    app.add_url_rule("/", "index", index)
    app.add_url_rule("/login", "login_page", login_page)
    app.add_url_rule("/admin", "admin_page", admin_page)
    app.add_url_rule("/wholesale", "wholesale_page", wholesale_page)
    app.add_url_rule("/wholesale/", "wholesale_page", wholesale_page)
    app.add_url_rule("/wholesale/<section>", "wholesale_page", wholesale_page)
    app.add_url_rule("/retail", "retail_page", retail_page)
    app.add_url_rule("/retail/", "retail_page", retail_page)
    app.add_url_rule("/retail/<path:page>", "retail_page", retail_page)
    app.add_url_rule("/assets/<path:filename>", "shared_asset", shared_asset)
    app.add_url_rule("/kgz-map/<path:filename>", "kgz_map_legacy_asset", kgz_map_legacy_asset)
    app.add_url_rule("/_next/<path:filename>", "react_static", react_static)
    app.add_url_rule("/echarts.min.js", "echarts_js", echarts_js)
    app.add_url_rule("/map", "map_page", map_page)
    app.add_url_rule("/<path:path>", "spa_catchall", spa_catchall)
