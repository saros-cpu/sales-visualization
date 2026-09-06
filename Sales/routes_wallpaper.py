from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import importlib.util
import hmac
import logging
import os
from pathlib import Path

from flask import jsonify, request

from db import get_connection
from retail_internal import open_oilstation
from services.inventory_alert_service import attach_wallpaper_sellable_days, build_low_inventory_alerts
from shared_utils import active_station_statuses

_PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = _PROJECT_ROOT.parent / "OilStation"


def _env_bool(name, default=False):
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_flag(name):
    return _env_bool(name)


"""壁纸端 /api/wallpaper/map 路由与私有辅助（自 api.py 纯搬移拆分）。"""

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
                    station["daysRemaining"] = alerts[0].get("daysRemaining")
        except Exception:
            logging.exception("wallpaper inventory alerts unavailable")
        # Wallpaper inventory panel: estimate sellable days per tank using the
        # station-level 7-day average daily sales. Attaches daysRemaining onto
        # each inventoryByResource row (independent of alert thresholds).
        try:
            attach_wallpaper_sellable_days(stations)
        except Exception:
            logging.exception("wallpaper sellable days unavailable")
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


def register_wallpaper_routes(app):
    app.add_url_rule("/api/wallpaper/map", "api_wallpaper_map", api_wallpaper_map)
