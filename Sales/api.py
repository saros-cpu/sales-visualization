from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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
from services.inventory_alert_service import build_low_inventory_alerts, attach_wallpaper_sellable_days


from shared_utils import (
    has_users, session_user, wants_json, login_redirect,
    user_requires_password_change,
    enrich_retail_station_statuses,
    active_station_statuses,
)
from routes_assistant import register_assistant_routes
from routes_data import register_data_routes
from routes_admin import register_admin_routes
from routes_assets import register_assets_routes
from routes_wallpaper import register_wallpaper_routes
from routes_retail_legacy import register_retail_legacy_routes
from routes_download import register_download_routes
from routes_health import register_health_routes


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


app = Flask(__name__, static_folder=".", static_url_path="")
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=_env_bool("SALES_COOKIE_SECURE", default=True),
    PERMANENT_SESSION_LIFETIME=timedelta(days=LOGIN_REMEMBER_DAYS),
)
# --- V2 API 配置（桌面端 JWT） ---
app.config['JWT_SECRET_KEY'] = os.getenv('SALES_JWT_SECRET', SECRET_KEY)
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=2)
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=7)
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'
# SALES_AUTH_COOKIE_MODE: off | dual | cookie —— Web 端 JWT 迁 HttpOnly Cookie 开关
# （auth_cookie.apply_auth_config 会按开关调整 JWT_TOKEN_LOCATION 等；Desktop 5.6.0 走 header 不受影响）
from auth_cookie import apply_auth_config
apply_auth_config(app)
jwt = JWTManager(app)
from api_v2.token_revocation import is_token_revoked_payload


@jwt.token_in_blocklist_loader
def is_jwt_revoked(_jwt_header, jwt_payload):
    return is_token_revoked_payload(jwt_payload)

# CORS：手动处理跨域请求（Electron 加载本地文件时 origin 为 null 或 file://）
def _env_flag(name):
    return _env_bool(name)


_CORS_LOOPBACK_ORIGIN_RE = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$')
_DEFAULT_CORS_ALLOWED_ORIGINS = {
    "http://198.51.100.10",
    "http://sales.example.com",
    "https://sales.example.com",
    "app://salesdesktop",
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


def _legacy_electron_cors_origin(origin):
    return _env_flag("SALES_LEGACY_ELECTRON_CORS") and (
        origin == "null" or origin.startswith("file://") or origin.startswith("app://")
    )


@app.after_request
def add_cors_headers(response):
    origin = _normalize_cors_origin(request.headers.get('Origin'))
    if origin and (
        origin in _CORS_ALLOWED_ORIGINS
        or _CORS_LOOPBACK_ORIGIN_RE.match(origin)
        or _legacy_electron_cors_origin(origin)
    ):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Credentials'] = 'true'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, X-Wallpaper-Token'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
    return response

@app.before_request
def handle_options_preflight():
    if request.method == 'OPTIONS':
        resp = app.make_default_options_response()
        return add_cors_headers(resp)

APP_BUILD = "2026-08-16-salesdesktop-v5.6.0"
PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = PROJECT_ROOT.parent / "OilStation"
SHARED_ASSETS_ROOT = PROJECT_ROOT.parent / "assets"
FRONTEND_DIST = PROJECT_ROOT.parent / "frontend" / "dist"


PUBLIC_PATHS = {
    "/login",
    "/map",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/bootstrap",
    "/api/auth/change-password",
    "/api/health",
}

PUBLIC_PAGE_PREFIXES = ()

PUBLIC_API_PATHS = {
    "/api/data-assistant/query",
}

PUBLIC_API_PREFIXES = (
    "/api/wallpaper/",
    "/api/v2/",
    "/api/download/",
)

PASSWORD_CHANGE_ALLOWED_PATHS = {
    "/change-password",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/bootstrap",
    "/api/auth/change-password",
}

ADMIN_ONLY_API_PREFIXES = (
    "/api/export/profit",
    "/api/export/profit-year",
)

EXTERNAL_API_PERMISSION_PREFIXES = (
    ("/api/export/exchange-rates", "exchange:view"),
    ("/api/export/analysis/wholesale", "wholesale:export"),
    ("/api/export/wholesale", "wholesale:export"),
    ("/api/export/analysis/sales/download", ("retail:export", "wholesale:export")),
    ("/api/export/analysis/sales", "retail:export"),
    ("/api/export/analysis/monthly", "retail:export"),
    ("/api/export/analysis/yearly", "retail:export"),
    ("/api/export/daily-briefing", "retail:export"),
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


def _external_api_permission(path: str) -> str | tuple[str, ...] | None:
    if not path.startswith("/api/"):
        return None
    for prefix, permission_code in EXTERNAL_API_PERMISSION_PREFIXES:
        if path == prefix or path.startswith(f"{prefix}/"):
            return permission_code
    return None


def _enforce_external_api_permission(path: str, user_id, role: str | None):
    if any(path == prefix or path.startswith(f"{prefix}/") for prefix in ADMIN_ONLY_API_PREFIXES):
        if role != "admin":
            return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403
        return None
    permission_codes = _external_api_permission(path)
    if not permission_codes or role == "admin":
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
            codes = permission_codes if isinstance(permission_codes, tuple) else (permission_codes,)
            allowed = any(has_permission(cur, numeric_user_id, code, role) for code in codes)
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
            error_response = _enforce_external_api_permission(path, identity, (get_jwt() or {}).get("role"))
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
        error_response = _enforce_external_api_permission(path, user.get("id"), user.get("role"))
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






























































# ── 自 api.py 拆分出的路由模块（纯搬移，行为零变化）──
register_assets_routes(app)
register_retail_legacy_routes(app)
register_wallpaper_routes(app)
register_download_routes(app)
register_health_routes(app)

register_data_routes(app)
register_admin_routes(app)
register_assistant_routes(app)
register_analysis_report_routes(app)

# Register v2 API blueprint（桌面端）
from api_v2 import register_v2_blueprints
register_v2_blueprints(app)
