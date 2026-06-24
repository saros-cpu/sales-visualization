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
from services.inventory_alert_service import build_low_inventory_alerts


from shared_utils import (
    has_users, session_user, wants_json, login_redirect,
    user_requires_password_change,
    enrich_retail_station_statuses,
    active_station_statuses,
)
from routes_assistant import register_assistant_routes
from routes_data import register_data_routes
from routes_admin import register_admin_routes


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
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'
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


def _wallpaper_oilstation_json(path, query_string=None):
    response = open_oilstation(path, query_string=query_string)
    if response.status_code >= 400:
        raise RuntimeError(response.get_data(as_text=True) or f"{path} failed")
    payload = response.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def _wallpaper_float(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _wallpaper_round_half_up(value, places=2):
    try:
        decimal_value = Decimal(str(value or 0))
        quantizer = Decimal("1").scaleb(-places)
        return float(decimal_value.quantize(quantizer, rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return 0.0


def _wallpaper_rate_float(value):
    try:
        if value is None:
            return None
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _wallpaper_display_end(start_value, exclusive_end_value):
    start_text = str(start_value or "").strip()[:10]
    end_text = str(exclusive_end_value or "").strip()[:10]
    if not end_text:
        return ""
    try:
        start_day = date.fromisoformat(start_text) if start_text else None
        end_day = date.fromisoformat(end_text)
    except ValueError:
        return end_text
    if start_day and end_day > start_day:
        return (end_day - timedelta(days=1)).isoformat()
    return end_day.isoformat()


def _wallpaper_avg_cny_rate(start_value, exclusive_end_value):
    try:
        start_day = date.fromisoformat(str(start_value or "")[:10])
        end_day = date.fromisoformat(str(exclusive_end_value or "")[:10])
    except ValueError:
        return None
    if end_day <= start_day:
        return None

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT cny_kgs
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
              AND cny_kgs IS NOT NULL
            """,
            (start_day, end_day),
        )
        values = []
        for (cny_kgs,) in cur.fetchall():
            try:
                value = Decimal(str(cny_kgs))
            except (InvalidOperation, TypeError, ValueError):
                continue
            if value > 0:
                values.append(value)
    finally:
        conn.close()

    if not values:
        return None
    avg = (sum(values) / Decimal(len(values))).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return float(avg)


def _wallpaper_amount_cny_by_average(amount, start_value, exclusive_end_value):
    avg_cny = _wallpaper_avg_cny_rate(start_value, exclusive_end_value)
    if not avg_cny:
        return None, None
    amount_cny = _wallpaper_round_half_up(Decimal(str(amount or 0)) / Decimal(str(avg_cny)), 2)
    return amount_cny, avg_cny


def _wallpaper_sales_summary():
    now = datetime.now()
    year = now.year
    year_payload = _wallpaper_oilstation_json(
        "/api/kpi/yearly",
        {"year": year, "inventory": 0},
    )
    month_payload = _wallpaper_oilstation_json("/api/kpi")

    year_summary = year_payload.get("summary") or {}
    month_summary = month_payload.get("summary") or {}
    month_label = str(month_payload.get("month") or year_summary.get("activeMonth") or f"{year}-{now.month:02d}")
    month_start = str(month_summary.get("queryStart") or f"{month_label}-01")[:10]
    month_end_exclusive = str(
        month_summary.get("queryEndExclusive")
        or month_summary.get("queryEnd")
        or ""
    )[:10]
    year_start = str(year_summary.get("queryStart") or f"{year}-01-01")[:10]
    year_end_exclusive = str(
        year_summary.get("queryEndExclusive")
        or year_summary.get("queryEnd")
        or ""
    )[:10]

    year_amount = _wallpaper_float(year_summary.get("totalSales") or year_summary.get("totalAmount"))
    month_amount = _wallpaper_float(month_summary.get("totalSales") or month_summary.get("totalAmount"))
    year_amount_cny, year_avg_cny = _wallpaper_amount_cny_by_average(year_amount, year_start, year_end_exclusive)
    month_amount_cny, month_avg_cny = _wallpaper_amount_cny_by_average(month_amount, month_start, month_end_exclusive)

    return {
        "year": int(year_payload.get("year") or year),
        "yearStart": year_start,
        "yearEnd": _wallpaper_display_end(year_start, year_end_exclusive),
        "yearEndExclusive": year_end_exclusive,
        "yearVolumeLiters": _wallpaper_float(year_summary.get("totalLiters") or year_summary.get("totalVolume")),
        "yearTons": _wallpaper_float(year_summary.get("totalTons") or year_summary.get("tons")),
        "yearAmount": year_amount,
        "yearAmountCny": year_amount_cny,
        "yearAvgCnyKgs": year_avg_cny,
        "month": month_label,
        "monthStart": month_start,
        "monthEnd": _wallpaper_display_end(month_start, month_end_exclusive),
        "monthEndExclusive": month_end_exclusive,
        "monthVolumeLiters": _wallpaper_float(month_summary.get("totalLiters") or month_summary.get("totalVolume")),
        "monthTons": _wallpaper_float(month_summary.get("totalTons") or month_summary.get("tons")),
        "monthAmount": month_amount,
        "monthAmountCny": month_amount_cny,
        "monthAvgCnyKgs": month_avg_cny,
    }


def _wallpaper_exchange_summary():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT rate_date, usd_kgs, cny_kgs, source, is_manual
            FROM exchange_rates
            WHERE rate_date <= CURDATE()
              AND (usd_kgs IS NOT NULL OR cny_kgs IS NOT NULL)
            ORDER BY rate_date DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        if not row:
            return {"available": False}
        rate_date, usd_kgs, cny_kgs, source, is_manual = row
        return {
            "available": True,
            "date": rate_date.isoformat() if rate_date else None,
            "usdKgs": _wallpaper_rate_float(usd_kgs),
            "cnyKgs": _wallpaper_rate_float(cny_kgs),
            "source": source or "",
            "isManual": bool(is_manual),
            "isToday": rate_date == date.today() if rate_date else False,
        }
    finally:
        conn.close()


def _wallpaper_full_access():
    trusted_ips = {
        item.strip()
        for item in os.getenv("SALES_WALLPAPER_TRUSTED_IPS", "").split(",")
        if item.strip()
    }
    request_ip = (
        request.headers.get("X-Real-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",", 1)[0]
        or request.remote_addr
        or ""
    ).strip()
    if request_ip and request_ip in trusted_ips:
        return True

    expected = os.getenv("SALES_WALLPAPER_TOKEN", "").strip()
    if not expected:
        return False
    provided = (request.headers.get("X-Wallpaper-Token") or "").strip()
    if not provided and _env_flag("SALES_WALLPAPER_ALLOW_QUERY_TOKEN"):
        provided = (request.args.get("token") or "").strip()
    return hmac.compare_digest(provided, expected)


def _wallpaper_status_label(status="", status_type="", status_label="", closed_reason="", status_note=""):
    raw_label = str(status_label or "").strip()
    status_text = str(status or "").strip()
    type_text = str(status_type or "").strip()
    reason = str(closed_reason or status_note or "").strip()
    combined = f"{raw_label} {status_text} {type_text} {reason}".lower()

    if "装修" in raw_label or "装修" in reason or any(
        word in combined for word in ("renovation", "maintenance", "construction", "decorat")
    ):
        return "装修"
    if "停业" in raw_label or "停业" in reason or any(
        word in combined for word in ("closed", "stopped", "suspended", "inactive")
    ):
        return "停业"
    if raw_label in {"在营", "正常", "正常营业"}:
        return "在营"
    if raw_label in {"关注", "预警"}:
        return "关注"
    if raw_label == "异常":
        return "异常"

    key = (type_text or status_text or raw_label).lower()
    if key in {"normal", "open", "active", "operating", "online"}:
        return "在营"
    if key in {"warning", "warn", "attention"}:
        return "关注"
    if raw_label and raw_label.lower() not in {"normal", "closed", "warning", "warn"}:
        return raw_label
    if key and key != "normal":
        return "异常"
    return "在营"


def _wallpaper_default_station_status(shop_key, constants_module):
    closed_stations = getattr(constants_module, "CLOSED_STATIONS", {}) or {}
    force_normal = getattr(constants_module, "FORCE_NORMAL_STATIONS", set()) or set()
    if shop_key in closed_stations and shop_key not in force_normal:
        closed_reason = closed_stations.get(shop_key) or ""
        return {
            "status": "closed",
            "statusType": "closed",
            "statusLabel": _wallpaper_status_label("closed", "closed", closed_reason=closed_reason),
            "closedReason": closed_reason,
            "affectsSales": True,
            "affectsInventory": shop_key in (getattr(constants_module, "MAP_ZERO_INVENTORY_STATIONS", set()) or set()),
            "suppressAlerts": shop_key in (getattr(constants_module, "MAP_ZERO_INVENTORY_STATIONS", set()) or set()),
            "statusNote": closed_reason,
            "expectedResumeAt": None,
        }
    return _wallpaper_normal_station_status()


def _wallpaper_normal_station_status():
    return {
        "status": "normal",
        "statusType": "normal",
        "statusLabel": "在营",
        "closedReason": "",
        "affectsSales": False,
        "affectsInventory": False,
        "suppressAlerts": False,
        "statusNote": "",
        "expectedResumeAt": None,
    }


def _wallpaper_zero_inventory_detail(detail, shop_key, constants_module):
    zero_keys = set(getattr(constants_module, "MAP_ZERO_INVENTORY_STATIONS", set()) or set())
    if shop_key not in zero_keys:
        return detail or {}
    closed_stations = getattr(constants_module, "CLOSED_STATIONS", {}) or {}
    mapped = dict(detail or {})
    rows = []
    for row in mapped.get("inventoryByResource") or []:
        if not isinstance(row, dict):
            continue
        capacity = float(row.get("capacity") or 0)
        item = dict(row)
        item["inventory"] = 0.0
        if "fillPercent" in item or capacity > 0:
            item["fillPercent"] = 0.0
            item["fillStatus"] = "critical" if capacity > 0 else "unknown"
        rows.append(item)
    capacity = float(mapped.get("inventoryCapacity") or 0)
    mapped["inventory"] = 0.0
    mapped["inventoryByResource"] = rows
    mapped["inventoryZeroedByMapRule"] = True
    mapped["inventoryZeroReason"] = closed_stations.get(shop_key) or "停业，库存清零"
    if capacity > 0:
        mapped["inventoryFillPercent"] = 0.0
        mapped["inventoryFillStatus"] = "critical"
    elif "inventoryFillStatus" in mapped:
        mapped["inventoryFillStatus"] = mapped.get("inventoryFillStatus") or "unknown"
    return mapped


@app.route("/api/wallpaper/map")
def api_wallpaper_map():
    constants_module = _wallpaper_oilstation_constants()
    include_sensitive = _wallpaper_full_access()
    details_payload = _wallpaper_station_details() if include_sensitive else {}
    sales_summary = None
    exchange_summary = None
    if include_sensitive:
        try:
            sales_summary = _wallpaper_sales_summary()
        except Exception:
            logging.exception("wallpaper sales summary unavailable")
        try:
            exchange_summary = _wallpaper_exchange_summary()
        except Exception:
            logging.exception("wallpaper exchange summary unavailable")
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
        if shop_key in (getattr(constants_module, "FORCE_NORMAL_STATIONS", set()) or set()):
            status = _wallpaper_normal_station_status()
        detail = _wallpaper_zero_inventory_detail(detail_by_shop.get(shop_key) or {}, shop_key, constants_module)
        status_label = _wallpaper_status_label(
            status.get("status", "normal"),
            status.get("statusType", "normal"),
            status.get("statusLabel", ""),
            status.get("closedReason", ""),
            status.get("statusNote", ""),
        )
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
            "statusLabel": status_label,
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
                "inventoryCapacity": detail.get("inventoryCapacity"),
                "inventoryFillPercent": detail.get("inventoryFillPercent"),
                "inventoryFillStatus": detail.get("inventoryFillStatus") or "unknown",
                "inventoryZeroedByMapRule": bool(detail.get("inventoryZeroedByMapRule")),
                "inventoryZeroReason": detail.get("inventoryZeroReason") or "",
                "inventoryAsOf": detail.get("inventoryAsOf") or "",
                "snapshotGeneratedAt": detail.get("snapshotGeneratedAt") or details_payload.get("snapshotGeneratedAt") or "",
            })
        stations.append(station)

    depots = []
    for name, info in sorted((getattr(constants_module, "DEPOT_COORDS", {}) or {}).items()):
        status = info.get("status") or "normal"
        status_type = info.get("statusType") or status
        closed_reason = info.get("closedReason", "")
        depots.append({
            "name": name,
            "short": info.get("short", ""),
            "region": info.get("region", ""),
            "lng": info.get("lng"),
            "lat": info.get("lat"),
            "type": info.get("type", "depot"),
            "size": 0.2,
            "status": status,
            "statusType": status_type,
            "statusLabel": _wallpaper_status_label(
                status,
                status_type,
                info.get("statusLabel", ""),
                closed_reason,
            ),
            "closedReason": closed_reason,
        })

    active_station_count = sum(1 for item in stations if item.get("status") == "normal")
    closed_station_count = sum(1 for item in stations if item.get("status") == "closed")
    warning_station_count = sum(1 for item in stations if item.get("status") not in {"normal", "closed"})
    inventory_total = round(sum(float(item.get("inventory") or 0) for item in stations), 2) if include_sensitive else None
    inventory_alerts = {"items": [], "summary": {"alertCount": 0, "criticalCount": 0, "warningCount": 0}}
    if include_sensitive:
        try:
            inventory_alerts = build_low_inventory_alerts(stations)
            alerts_by_shop = {}
            for item in inventory_alerts.get("items", []):
                if item.get("shopKey") is None:
                    continue
                alerts_by_shop.setdefault(int(item.get("shopKey")), []).append(item)
            for station in stations:
                alerts = alerts_by_shop.get(int(station.get("shopKey") or 0)) or []
                if alerts:
                    station["inventoryAlert"] = alerts[0]
                    station["inventoryAlerts"] = alerts
        except Exception:
            logging.exception("wallpaper inventory alerts unavailable")
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
            "inventoryAlertCount": inventory_alerts.get("summary", {}).get("alertCount", 0) if include_sensitive else None,
            "inventoryCriticalCount": inventory_alerts.get("summary", {}).get("criticalCount", 0) if include_sensitive else None,
            "inventoryWarningCount": inventory_alerts.get("summary", {}).get("warningCount", 0) if include_sensitive else None,
        },
    }
    if include_sensitive and sales_summary:
        payload["salesSummary"] = sales_summary
    if include_sensitive and exchange_summary:
        payload["exchangeSummary"] = exchange_summary
    if include_sensitive:
        payload["inventoryAlerts"] = inventory_alerts.get("items", [])
        payload["inventoryAlertSummary"] = inventory_alerts.get("summary", {})
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
