from __future__ import annotations

from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import wraps
import hmac
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
import pymysql
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
    user_requires_password_change,
    enrich_retail_station_statuses,
    active_station_statuses,
)
from routes_assistant import register_assistant_routes
from routes_data import register_data_routes
from routes_admin import register_admin_routes

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
_CORS_ORIGIN_RE = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^file://|^app://|^null$')
_DEFAULT_CORS_ALLOWED_ORIGINS = {
    "http://198.51.100.10",
    "http://sales.example.com",
    "https://sales.example.com",
}
_CORS_ALLOWED_ORIGINS = _DEFAULT_CORS_ALLOWED_ORIGINS | {
    item.strip().rstrip("/")
    for item in os.getenv("SALES_CORS_ORIGINS", "").split(",")
    if item.strip()
}

def _normalize_cors_origin(value):
    origin = (value or "").strip()
    if not origin:
        return ""
    if origin == "null" or origin.startswith("file://") or origin.startswith("app://"):
        return origin
    return origin.rstrip("/")

@app.after_request
def add_cors_headers(response):
    origin = _normalize_cors_origin(request.headers.get('Origin'))
    if origin and (origin in _CORS_ALLOWED_ORIGINS or _CORS_ORIGIN_RE.match(origin)):
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

APP_BUILD = "2026-07-22-salesdesktop-v3.8.21"
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
    "/api/wallpaper/",
    "/api/v2/",
    "/api/download/",
    "/api/export/analysis/sales/download/",
)

PASSWORD_CHANGE_ALLOWED_PATHS = {
    "/change-password",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/bootstrap",
    "/api/auth/change-password",
}

LEGACY_API_PERMISSION_PREFIXES = (
    ("/api/export/exchange-rates", "exchange:view"),
    ("/api/export/analysis/wholesale", "wholesale:export"),
    ("/api/export/wholesale", "wholesale:export"),
    ("/api/export/analysis/sales", "retail:export"),
    ("/api/export/analysis/monthly", "retail:export"),
    ("/api/export/analysis/yearly", "retail:export"),
    ("/api/export/retail/range", "retail:export"),
    ("/api/export/monthly", "retail:export"),
    ("/api/export/self-use", "retail:export"),
    ("/api/review/correct", "weighing:verify"),
    ("/api/review", "weighing:view"),
    ("/api/wholesale/weigh-details", "weighing:view"),
    ("/api/wholesale", "wholesale:view"),
    ("/api/home/exchange-current", "exchange:view"),
    ("/api/home/market-watch", "exchange:view"),
    ("/api/exchange-rates", "exchange:view"),
    ("/api/dashboard", "retail:view"),
    ("/api/monthly", "retail:view"),
    ("/api/station", "retail:view"),
    ("/api/stations", "retail:view"),
    ("/api/daily", "retail:view"),
    ("/api/regions", "retail:view"),
    ("/api/resources", "retail:view"),
    ("/api/kpi", "retail:view"),
    ("/api/years", "retail:view"),
    ("/api/months", "retail:view"),
    ("/api/retail", "retail:view"),
    ("/api/summary", "retail:view"),
    ("/api/periods", "retail:view"),
)


def _legacy_api_permission(path: str) -> str | None:
    if not path.startswith("/api/"):
        return None
    for prefix, permission_code in LEGACY_API_PERMISSION_PREFIXES:
        if path == prefix or path.startswith(f"{prefix}/"):
            return permission_code
    return None


def _enforce_legacy_api_permission(path: str, user_id, role: str | None):
    permission_code = _legacy_api_permission(path)
    if not permission_code or role == "admin":
        return None
    if not user_id:
        return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403
    try:
        numeric_user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403
    conn = get_connection()
    try:
        from api_v2.permission_service import has_permission

        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            allowed = has_permission(cur, numeric_user_id, permission_code, role)
            conn.commit()
        if allowed:
            return None
    finally:
        conn.close()
    return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403


def _password_change_required_response():
    if wants_json():
        return jsonify({
            "code": 4091,
            "error": "password_change_required",
            "message": "password_change_required",
            "data": {"mustChangePassword": True},
        }), 403
    return redirect("/change-password")


def _is_password_change_allowed(path: str):
    return path in PASSWORD_CHANGE_ALLOWED_PATHS


def _mark_session_password_state(user: dict, must_change: bool):
    if bool(user.get("mustChangePassword")) != must_change:
        session["user"] = {**user, "mustChangePassword": must_change}

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
    if path in PUBLIC_PATHS or path.startswith("/assets/") or path.startswith("/kgz-map/"):
        return None
    if path in PUBLIC_API_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_API_PREFIXES):
        return None
    if any(path == prefix or path.startswith(prefix + "/") for prefix in PUBLIC_PAGE_PREFIXES):
        return None
    if path.endswith(".css") or path.endswith(".js") or path.endswith(".json"):
        return None
    # 允许有效 JWT Token 通过（Electron 桌面端访问零售 API）
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
        if identity is not None:
            if not _is_password_change_allowed(path):
                conn = get_connection()
                try:
                    with conn.cursor() as cur:
                        if user_requires_password_change(cur, identity):
                            return _password_change_required_response()
                finally:
                    conn.close()
            error_response = _enforce_legacy_api_permission(path, identity, (get_jwt() or {}).get("role"))
            if error_response:
                return error_response
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
    user = session_user()
    if user:
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                must_change_password = user_requires_password_change(cur, user.get("id"))
        finally:
            conn.close()
        _mark_session_password_state(user, must_change_password)
        if must_change_password and not _is_password_change_allowed(path):
            return _password_change_required_response()
        error_response = _enforce_legacy_api_permission(path, user.get("id"), user.get("role"))
        if error_response:
            return error_response
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


_WALLPAPER_CONSTANTS_MODULE = None


def _wallpaper_oilstation_constants():
    global _WALLPAPER_CONSTANTS_MODULE
    if _WALLPAPER_CONSTANTS_MODULE is not None:
        return _WALLPAPER_CONSTANTS_MODULE
    spec = importlib.util.spec_from_file_location(
        "sales_wallpaper_oilstation_constants",
        OILSTATION_ROOT / "constants.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    _WALLPAPER_CONSTANTS_MODULE = module
    return module


def _wallpaper_active_statuses():
    conn = get_connection()
    try:
        cur = conn.cursor()
        return active_station_statuses(cur)
    finally:
        conn.close()


def _wallpaper_station_details():
    try:
        response = open_oilstation("/api/station-map-details")
        if response.status_code >= 400:
            return {}
        payload = response.get_json(silent=True)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        logging.exception("wallpaper station details unavailable")
        return {}


def _wallpaper_full_access():
    expected = os.getenv("SALES_WALLPAPER_TOKEN", "").strip()
    if not expected:
        return False
    provided = (
        request.headers.get("X-Wallpaper-Token")
        or request.args.get("token")
        or ""
    ).strip()
    return hmac.compare_digest(provided, expected)


def _wallpaper_default_station_status(shop_key, constants_module):
    closed_stations = getattr(constants_module, "CLOSED_STATIONS", {}) or {}
    force_normal = getattr(constants_module, "FORCE_NORMAL_STATIONS", set()) or set()
    if shop_key in closed_stations and shop_key not in force_normal:
        return {
            "status": "closed",
            "statusType": "closed",
            "statusLabel": "closed",
            "closedReason": closed_stations.get(shop_key) or "",
            "affectsSales": True,
            "affectsInventory": False,
            "suppressAlerts": False,
            "statusNote": closed_stations.get(shop_key) or "",
            "expectedResumeAt": None,
        }
    return {
        "status": "normal",
        "statusType": "normal",
        "statusLabel": "normal",
        "closedReason": "",
        "affectsSales": False,
        "affectsInventory": False,
        "suppressAlerts": False,
        "statusNote": "",
        "expectedResumeAt": None,
    }


@app.route("/api/wallpaper/map")
def api_wallpaper_map():
    constants_module = _wallpaper_oilstation_constants()
    include_sensitive = _wallpaper_full_access()
    details_payload = _wallpaper_station_details() if include_sensitive else {}
    detail_items = details_payload.get("items") if isinstance(details_payload, dict) else []
    detail_by_shop = {
        int(item.get("shopKey")): item
        for item in detail_items or []
        if isinstance(item, dict) and item.get("shopKey") is not None
    }
    try:
        statuses = _wallpaper_active_statuses()
    except Exception:
        logging.exception("wallpaper station statuses unavailable")
        statuses = {}

    stations = []
    shop_coords = getattr(constants_module, "SHOP_COORDS", {}) or {}
    shop_catalog = getattr(constants_module, "SHOP_KEY_MAP", {}) or {}
    for raw_shop_key, info in sorted(shop_catalog.items(), key=lambda item: int(item[0])):
        shop_key = int(raw_shop_key)
        coords = shop_coords.get(shop_key) or {}
        status = statuses.get(shop_key) or _wallpaper_default_station_status(shop_key, constants_module)
        detail = detail_by_shop.get(shop_key) or {}
        station = {
            "shopKey": shop_key,
            "name": info.get("name", ""),
            "short": info.get("short", ""),
            "region": info.get("region", ""),
            "lng": coords.get("lng"),
            "lat": coords.get("lat"),
            "type": "station",
            "size": 0.28,
            "status": status.get("status", "normal"),
            "statusType": status.get("statusType", "normal"),
            "statusLabel": status.get("statusLabel", ""),
            "closedReason": status.get("closedReason", ""),
            "statusNote": status.get("statusNote", ""),
            "expectedResumeAt": status.get("expectedResumeAt"),
            "affectsSales": bool(status.get("affectsSales")),
            "affectsInventory": bool(status.get("affectsInventory")),
            "suppressAlerts": bool(status.get("suppressAlerts")),
        }
        if include_sensitive:
            station.update({
                "inventory": float(detail.get("inventory") or 0),
                "inventoryByResource": detail.get("inventoryByResource") or [],
                "prices": detail.get("prices") or [],
                "inventoryAsOf": detail.get("inventoryAsOf") or "",
                "snapshotGeneratedAt": detail.get("snapshotGeneratedAt") or details_payload.get("snapshotGeneratedAt") or "",
            })
        stations.append(station)

    depots = []
    for name, info in sorted((getattr(constants_module, "DEPOT_COORDS", {}) or {}).items()):
        status = info.get("status") or "normal"
        depots.append({
            "name": name,
            "short": info.get("short", ""),
            "region": info.get("region", ""),
            "lng": info.get("lng"),
            "lat": info.get("lat"),
            "type": "depot",
            "size": 0.55,
            "status": status,
            "statusType": status,
            "statusLabel": status,
            "closedReason": info.get("closedReason", ""),
        })

    active_station_count = sum(1 for item in stations if item.get("status") == "normal")
    closed_station_count = sum(1 for item in stations if item.get("status") == "closed")
    warning_station_count = sum(1 for item in stations if item.get("status") not in {"normal", "closed"})
    inventory_total = round(sum(float(item.get("inventory") or 0) for item in stations), 2) if include_sensitive else None
    payload = {
        "source": "wallpaper_public_map",
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "snapshotGeneratedAt": details_payload.get("snapshotGeneratedAt") or details_payload.get("updatedAt") or "",
        "sensitiveData": include_sensitive,
        "stations": stations,
        "depots": depots,
        "summary": {
            "stationCount": len(stations),
            "activeStationCount": active_station_count,
            "closedStationCount": closed_station_count,
            "warningStationCount": warning_station_count,
            "depotCount": len(depots),
            "activeDepotCount": sum(1 for item in depots if item.get("status") == "normal"),
            "inventoryLiters": inventory_total,
        },
    }
    return jsonify({"code": 0, "data": payload})


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


@app.route("/kgz-map/<path:filename>")
def kgz_map_legacy_asset(filename):
    response = send_from_directory(SHARED_ASSETS_ROOT / "kgz-map", filename)
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
    allowed_installer = re.fullmatch(r"SalesDesktop Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?", filename)
    if filename != "latest.yml" and not allowed_installer:
        return jsonify({"error": "not_found"}), 404
    desktop_root = PROJECT_ROOT.parent / "SalesDesktop"
    candidates = [
        desktop_root / "download" / filename,
        desktop_root / filename,
        desktop_root / "release_build" / filename,
    ]
    filepath = next((item for item in candidates if item.is_file()), None)
    if filepath is None:
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

# Register v2 API blueprint（桌面端）
from api_v2 import register_v2_blueprints
register_v2_blueprints(app)
