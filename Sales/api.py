from __future__ import annotations

from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import wraps
import html
import importlib.util
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd
from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from pymysql.err import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from calculations import recalculate_wholesale_batch
from analysis_reports import register_analysis_report_routes
from config import LOGIN_REMEMBER_DAYS, NBKR_DAILY_XML_URL, SECRET_KEY
from db import get_connection
from import_helpers import (
    get_or_create_customer,
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
)
from scripts.import_contracts import import_contracts
from scripts.import_wholesale_excel import SHEET_DETAIL, import_wholesale
from summary_service import available_periods, period_bounds, summarize_combined, summarize_wholesale
from text_utils import clean_str, normalize_station_name, normalize_text, parse_date, parse_decimal
from wholesale_service import exchange_rates, summarize_wholesale_page
from retail_internal import open_oilstation


from shared_utils import (
    has_users, session_user, wants_json, login_redirect,
    enrich_retail_station_statuses,
)
from routes_assistant import register_assistant_routes
from routes_data import register_data_routes
from routes_admin import register_admin_routes
from routes_update import register_update_routes

app = Flask(__name__, static_folder=".", static_url_path="")
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SALES_COOKIE_SECURE", "").lower() in {"1", "true", "yes"},
    PERMANENT_SESSION_LIFETIME=timedelta(days=LOGIN_REMEMBER_DAYS),
)
# --- V2 API 配置（桌面端 JWT） ---
app.config['JWT_SECRET_KEY'] = os.getenv('SALES_JWT_SECRET', SECRET_KEY)
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=2)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=7)
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'
jwt = JWTManager(app)

# CORS：手动处理跨域请求（Electron 加载本地文件时 origin 为 null 或 file://）
import re
_CORS_ORIGIN_RE = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^file://|^app://\.|^null$')

@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin', '')
    if _CORS_ORIGIN_RE.match(origin) or 'localhost' in origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
    return response

@app.before_request
def handle_options_preflight():
    if request.method == 'OPTIONS':
        resp = app.make_default_options_response()
        return add_cors_headers(resp)

APP_BUILD = "2026-05-11-retail-resource-report-v2"
PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = PROJECT_ROOT.parent / "OilStation"
SHARED_ASSETS_ROOT = PROJECT_ROOT.parent / "assets"
FRONTEND_DIST = PROJECT_ROOT.parent / "frontend" / "dist"
UPLOAD_ROOT = PROJECT_ROOT / "uploads"

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

PUBLIC_PATHS = {
    "/login",
    "/map",
    "/api/auth/status",
    "/api/auth/login",
    "/api/health",
}

PUBLIC_PAGE_PREFIXES = ()

PUBLIC_API_PATHS = set()

PUBLIC_API_PREFIXES = (
    "/api/v2/",
    "/api/download/",
    "/api/export/analysis/sales/download/",
)

@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    if request.path == "/map":
        response.headers["X-Frame-Options"] = "ALLOWALL"
    else:
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
    return response


@app.before_request
def require_session():
    path = request.path
    if path in PUBLIC_PATHS or path.startswith("/assets/"):
        return None
    if path in PUBLIC_API_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_API_PREFIXES):
        return None
    if any(path == prefix or path.startswith(prefix + "/") for prefix in PUBLIC_PAGE_PREFIXES):
        return None
    if path.endswith(".css") or path.endswith(".js") or path.endswith(".json"):
        return None
    # 允许有效 JWT Token 通过（Electron 桌面端访问零售 API）
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
        verify_jwt_in_request(optional=True)
        if get_jwt_identity() is not None:
            return None
    except Exception:
        pass
    conn = get_connection()
    try:
        cur = conn.cursor()
        if not has_users(cur):
            if wants_json():
                return jsonify({"error": "bootstrap_required"}), 401
            return redirect("/login")
    finally:
        conn.close()
    if session_user():
        return None
    if wants_json():
        return jsonify({"error": "login_required"}), 401
    return login_redirect()

# ── DEPRECATED: HTML-serving routes ──
# These are now served by Nginx (React SPA).  Keep until Nginx fully verified.
# After confirming Nginx production, remove these routes — Flask should only
# ── React SPA routes ──
# Serve React frontend for all main page routes
@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_DIST), "index.html")


@app.route("/login")
def login_page():
    return send_from_directory(str(FRONTEND_DIST), "index.html")


@app.route("/admin")
def admin_page():
    return send_from_directory(str(FRONTEND_DIST), "index.html")


@app.route("/wholesale")
@app.route("/wholesale/")
@app.route("/wholesale/<section>")
def wholesale_page(section=None):
    return send_from_directory(str(FRONTEND_DIST), "index.html")


@app.route("/retail")
@app.route("/retail/")
@app.route("/retail/<path:page>")
def retail_page(page=None):
    return send_from_directory(str(FRONTEND_DIST), "index.html")


@app.route("/api/retail/pages")
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


@app.route("/retail-app/")
@app.route("/retail-app/")
@app.route("/retail-app/<path:filename>")
def retail_app_file(filename=""):
    if not filename or filename.startswith("api/"):
        if filename.startswith("api/"):
            return proxy_oilstation_api(filename[4:])
        return redirect("/retail")
    ext = Path(filename).suffix.lower()
    if ext in {".html", ".htm"}:
        return send_from_directory(str(FRONTEND_DIST), "index.html")
    response = send_from_directory(OILSTATION_ROOT, filename)
    if ext in {".css", ".js", ".json", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff", ".woff2"}:
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


@app.route("/api/<path:api_path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def retail_api_proxy(api_path):
    return proxy_oilstation_api(api_path)


@app.route("/assets/<path:filename>")
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


# ── React SPA static assets ──
@app.route("/_next/<path:filename>")
def react_static(filename):
    response = send_from_directory(str(FRONTEND_DIST / "_next"), filename)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# ── Root-level static files used by React SPA (echarts, etc.) ──
@app.route("/echarts.min.js")
def echarts_js():
    response = send_from_directory(str(OILSTATION_ROOT), "echarts.min.js")
    response.headers["Cache-Control"] = "public, max-age=604800"
    return response


# ── 3D 地图页面 ──
@app.route("/map")
def map_page():
    map_html = SHARED_ASSETS_ROOT / "kgz-map" / "full-map.html"
    if map_html.exists():
        return send_from_directory(str(map_html.parent), "full-map.html")
    return jsonify({"error": "map_not_found"}), 404


# ── SPA catch-all ──
# Any route not matched above serves the React SPA index.html
@app.route("/<path:path>")
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


@app.route("/api/download/<filename>")
def download_desktop(filename: str):
    allowed = {"SalesDesktop Setup 3.1.1.exe", "SalesDesktop Setup 3.1.1.exe.blockmap", "latest.yml"}
    if filename not in allowed:
        return jsonify({"error": "not_found"}), 404
    filepath = PROJECT_ROOT.parent / "SalesDesktop" / filename
    if not filepath.is_file():
        return jsonify({"error": "file_not_ready"}), 404
    return send_from_directory(str(filepath.parent), filepath.name, as_attachment=True)


@app.route("/api/health")
def health():
    return jsonify({"ok": True, "project": "销售数据可视化"})


# Register route modules
register_data_routes(app)
register_admin_routes(app)
register_assistant_routes(app)
register_analysis_report_routes(app)
register_update_routes(app)

# Register v2 API blueprint（桌面端）
from api_v2 import register_v2_blueprints
register_v2_blueprints(app)

