import os
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request
from openpyxl import load_workbook
import pymysql

from business_time import (
    business_date_expr,
    business_period_condition_with_pruning,
    business_period_params,
    shift_business_date_expr,
    shift_join,
)
from cache_store import get_cached, set_cached
from constants import (
    CLOSED_STATIONS,
    DEPOT_COORDS,
    FORCE_NORMAL_STATIONS,
    SHOP_COORDS,
    SHOP_KEY_MAP,
)
from db import get_connection
from export_excel import RESOURCE_DENSITY, SK4_RSK_MAP, SK6_RSK_MAP, SK28_RSK_MAP, SK29_RSK_MAP, STATION_RK_CORRECTIONS

from endpoints.v1.retail.common.query import calc_yoy_mom, get_query_date_range, query_month_summary
from endpoints.v1.retail.analytics.service.shared import *

PROJECT_ROOT = Path(__file__).resolve().parents[4]
OILSTATION_ROOT = Path(__file__).resolve().parents[3]

def cache_allowed():
    return request.args.get("refresh") not in {"1", "true", "yes"}


def _comparison_month(year: int, month: int, offset: int) -> str:
    value = year * 12 + (month - 1) + offset
    return f"{value // 12}-{value % 12 + 1:02d}"


def _snapshot_region_values(year_month: str) -> dict:
    payload = get_cached(f"regions:{year_month}") or get_cached(f"monthly:{year_month}") or {}
    return payload.get("regions") or {}


def _attach_region_snapshot_comparisons(year_month: str, payload: dict) -> bool:
    regions = payload.get("regions") or {}
    if not regions:
        return False
    try:
        year, month = [int(part) for part in year_month.split("-")]
    except (TypeError, ValueError):
        return False

    previous = _snapshot_region_values(_comparison_month(year, month, -1))
    last_year = _snapshot_region_values(_comparison_month(year, month, -12))
    changed = False
    for name, current in regions.items():
        for label, reference in (("mom", previous), ("yoy", last_year)):
            previous_item = reference.get(name) or {}
            previous_amount = float(previous_item.get("amount") or 0)
            previous_volume = float(previous_item.get("volume") or 0)
            current_amount = float(current.get("amount") or 0)
            current_volume = float(current.get("volume") or 0)
            sales = round((current_amount - previous_amount) / previous_amount * 100, 1) if previous_amount else 0
            volume = round((current_volume - previous_volume) / previous_volume * 100, 1) if previous_volume else 0
            if current.get(f"{label}Sales") != sales or current.get(f"{label}Volume") != volume:
                current[f"{label}Sales"] = sales
                current[f"{label}Volume"] = volume
                changed = True
    return changed


STATION_MAP_DETAILS_TTL = 600
STATION_MAP_DETAILS_CACHE_KEY = "station_map_details:latest"


def _load_env_file(path):
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _sales_db_config():
    _load_env_file(PROJECT_ROOT / "Sales" / ".env")
    _load_env_file(PROJECT_ROOT / "OilStation" / ".env")
    database = os.getenv("SALES_DB_NAME", os.getenv("DB_NAME", "sales_visualization"))
    if database == "ocw":
        database = "sales_visualization"
    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "reader"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": database,
        "charset": os.getenv("DB_CHARSET", "utf8mb4"),
        "use_unicode": True,
        "autocommit": True,
    }


def _parse_day(value):
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def _load_cny_rates(start, end):
    rates = {}
    try:
        start_day = _parse_day(start)
        end_day = _parse_day(end)
    except (TypeError, ValueError):
        return rates
    if end_day <= start_day:
        return rates
    try:
        conn = pymysql.connect(**_sales_db_config())
    except Exception:
        return rates
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT rate_date, cny_kgs
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
              AND cny_kgs IS NOT NULL
            """,
            (start_day, end_day),
        )
        for rate_date, cny_kgs in cur.fetchall():
            rates[_parse_day(rate_date).isoformat()] = float(cny_kgs)
    finally:
        conn.close()
    return rates


def _load_density_history():
    densities = {}
    try:
        conn = pymysql.connect(**_sales_db_config())
    except Exception:
        return densities
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT p.retail_resource_key, d.effective_date, d.density
            FROM product_density_history d
            JOIN products p ON p.id = d.product_id
            WHERE p.retail_resource_key IS NOT NULL
            ORDER BY p.retail_resource_key, d.effective_date
            """
        )
        for resource_key, effective_date, density in cur.fetchall():
            densities.setdefault(canonical_resource_key(resource_key), []).append(
                (_parse_day(effective_date), float(density))
            )
    except Exception:
        return {}
    finally:
        conn.close()
    return densities


def _density_for(density_history, resource_key, day):
    rk = canonical_resource_key(resource_key)
    selected = None
    for effective_date, density in density_history.get(rk, []):
        if effective_date <= day:
            selected = density
        else:
            break
    if selected is not None:
        return selected
    return RESOURCE_DENSITY.get(rk, 0)


def _monthly_cny_from_daily(daily_rows, start, end):
    rates = _load_cny_rates(start, end)
    total_cny = 0.0
    missing = []
    rate_values = []
    for item in daily_rows or []:
        amount = float(item.get("amount") or 0)
        if not amount:
            continue
        day = str(item.get("date") or "")[:10]
        rate = rates.get(day)
        if rate:
            total_cny += amount / rate
            rate_values.append(rate)
        else:
            missing.append(day)
    return {
        "totalSalesCny": round(total_cny, 2),
        "exchangeMissingDates": sorted(set(missing)),
        "exchangeComplete": not missing,
        "avgCnyKgs": round(sum(rate_values) / len(rate_values), 4) if rate_values else None,
    }


def _total_tons_from_daily_resource(daily_resource_rows):
    density_history = _load_density_history()
    total = 0.0
    missing = []
    for item in daily_resource_rows or []:
        mass = retail_mass_from_item(item)
        if mass is not None:
            total += mass / 1000
            continue
        volume = float(item.get("volume") or 0)
        if not volume:
            continue
        try:
            business_day = _parse_day(item.get("date"))
        except (TypeError, ValueError):
            continue
        density = _density_for(density_history, item.get("resourceKey") or item.get("key"), business_day)
        if not density:
            missing.append(f"{item.get('resourceKey')}:{business_day.isoformat()}")
            continue
        total += volume * density / 1000
    return {
        "totalTons": round(total, 3),
        "densityMissingKeys": sorted(set(missing)),
        "densityComplete": not missing,
    }


def _total_tons_from_resource_summary(resources, business_day=None):
    density_history = _load_density_history()
    if business_day is None:
        business_day = date.today()
    total = 0.0
    missing = []
    for item in resources or []:
        mass = retail_mass_from_item(item)
        if mass is not None:
            total += mass / 1000
            continue
        volume = float(item.get("volume") or 0)
        if not volume:
            continue
        density = _density_for(density_history, item.get("resourceKey") or item.get("key"), business_day)
        if not density:
            missing.append(str(item.get("resourceKey") or item.get("key") or "unknown"))
            continue
        total += volume * density / 1000
    return {
        "totalTons": round(total, 3),
        "densityMissingKeys": sorted(set(missing)),
        "densityComplete": not missing,
    }


def _attach_monthly_finance_metrics(payload, daily_resource_rows=None):
    summary = payload.get("summary") or {}
    daily = payload.get("daily") or []
    start = summary.get("queryStart") or payload.get("queryStart") or f"{payload.get('month')}-01"
    end = summary.get("queryEnd") or payload.get("queryEndExclusive")
    if not end and daily:
        last_day = max(str(item.get("date"))[:10] for item in daily)
        end = (datetime.strptime(last_day, "%Y-%m-%d").date() + timedelta(days=1)).isoformat()
    if start and end:
        summary.update(_monthly_cny_from_daily(daily, start, end))
    if daily_resource_rows:
        summary.update(_total_tons_from_daily_resource(daily_resource_rows))
    elif "totalTons" not in summary:
        try:
            business_day = _parse_day(start)
        except (TypeError, ValueError):
            business_day = None
        summary.update(_total_tons_from_resource_summary(payload.get("byResource") or [], business_day))
    payload["summary"] = summary
    return payload
def _latest_report_workbook_for_map():
    index_path = OILSTATION_ROOT / "exports" / ".monthly_report_index.json"
    if not index_path.exists():
        return None, None
    try:
        report_index = json.loads(index_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None, None
    if not isinstance(report_index, dict):
        return None, None
    for ym in sorted(report_index.keys(), reverse=True):
        filename = (report_index.get(ym) or {}).get("file")
        if not filename:
            continue
        path = OILSTATION_ROOT / "exports" / filename
        if path.exists():
            return ym, path
    return None, None


def _report_workbook_snapshot_state(workbook_path):
    stat = workbook_path.stat()
    return {
        "source": "retail_report_snapshot",
        "sourceFile": workbook_path.name,
        "sourceMtime": stat.st_mtime,
        "snapshotGeneratedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="minutes"),
    }


def _latest_completed_shift_marker_for_map():
    station_keys = sorted(SHOP_KEY_MAP.keys())
    if not station_keys:
        return None
    station_key_sql = ",".join(str(key) for key in station_keys)
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT MAX(DatetimeShiftEnd)
            FROM shift
            WHERE ShopKey IN ({station_key_sql})
              AND DatetimeShiftBegin IS NOT NULL
              AND DatetimeShiftEnd IS NOT NULL
              AND DatetimeShiftEnd > DatetimeShiftBegin
              AND DatetimeShiftEnd >= DATE_SUB(NOW(), INTERVAL 180 DAY)
            """
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _station_map_details_cache_current(cached):
    if not isinstance(cached, dict):
        return True
    _, workbook_path = _latest_report_workbook_for_map()
    if not workbook_path:
        latest_shift_end = _latest_completed_shift_marker_for_map()
        if not latest_shift_end:
            return cached.get("source") == "live_database" and bool(cached.get("snapshotGeneratedAt"))
        try:
            cached_mtime = float(cached.get("sourceMtime"))
        except (TypeError, ValueError):
            cached_mtime = None
        return (
            cached.get("source") == "live_database"
            and cached_mtime is not None
            and abs(cached_mtime - latest_shift_end.timestamp()) < 0.001
        )
    try:
        snapshot_state = _report_workbook_snapshot_state(workbook_path)
    except OSError:
        return False
    try:
        cached_mtime = float(cached.get("sourceMtime"))
    except (TypeError, ValueError):
        cached_mtime = None
    return (
        cached.get("source") == snapshot_state["source"]
        and cached.get("sourceFile") == snapshot_state["sourceFile"]
        and cached_mtime is not None
        and abs(cached_mtime - snapshot_state["sourceMtime"]) < 0.001
    )


def _report_sheet_last_nonempty_day(workbook):
    last_day = 0
    for sheet_name in workbook.sheetnames:
        if not sheet_name.endswith("日") or not sheet_name[:2].isdigit():
            continue
        sheet = workbook[sheet_name]
        for row in sheet.iter_rows(min_row=5, values_only=True):
            if _to_float(row[18] if len(row) > 18 else None) or _to_float(row[20] if len(row) > 20 else None):
                last_day = max(last_day, int(sheet_name[:2]))
                break
    return last_day


def _station_map_details_from_report_snapshot():
    ym, workbook_path = _latest_report_workbook_for_map()
    if not workbook_path:
        return None
    workbook = None
    try:
        workbook = load_workbook(workbook_path, read_only=True, data_only=True)
        last_day = _report_sheet_last_nonempty_day(workbook)
        sheet_name = f"{last_day:02d}日" if last_day else None
        if not sheet_name or sheet_name not in workbook.sheetnames:
            sheet_name = "总表" if "总表" in workbook.sheetnames else workbook.sheetnames[0]
        sheet = workbook[sheet_name]
        snapshot_date = f"{ym}-{last_day:02d}" if ym and last_day else ym
        snapshot_state = _report_workbook_snapshot_state(workbook_path)
        snapshot_generated_at = snapshot_state["snapshotGeneratedAt"]
        details = {
            shop_key: {
                "shopKey": shop_key,
                "inventory": 0.0,
                "inventoryByResource": [],
                "prices": [],
                "inventoryAsOf": snapshot_date,
                "priceAsOf": snapshot_date,
                "snapshotGeneratedAt": snapshot_generated_at,
            }
            for shop_key in sorted(SHOP_KEY_MAP.keys())
        }
        rows_by_station = {shop_key: {} for shop_key in details}
        current_shop_key = None
        for row in sheet.iter_rows(min_row=5, values_only=True):
            station_key = _station_key_from_report_cell(row[0] if len(row) > 0 else None)
            if station_key is not None:
                current_shop_key = station_key
            if current_shop_key is None or current_shop_key not in rows_by_station:
                continue
            product_name = str(row[3] if len(row) > 3 and row[3] is not None else "").strip()
            if not product_name or "合计" in product_name or "итого" in product_name.lower():
                continue
            rk = _resource_key_from_report_name(product_name)
            if rk not in KNOWN_RESOURCE_KEYS:
                continue
            if sheet_name == "总表":
                inventory = _to_float(row[23] if len(row) > 23 else None)
                price = _to_float(row[22] if len(row) > 22 else None)
            else:
                inventory = _to_float(row[21] if len(row) > 21 else None)
                sale_volume = _to_float(row[18] if len(row) > 18 else None)
                sale_amount = _to_float(row[20] if len(row) > 20 else None)
                price = round(sale_amount / sale_volume, 2) if sale_volume else 0.0
            if not inventory and not price:
                continue
            bucket = rows_by_station[current_shop_key].setdefault(rk, {
                "resourceKey": rk,
                "name": RESOURCE_NAMES.get(rk, f"Other-{rk}"),
                "inventory": 0.0,
                "price": None,
            })
            bucket["inventory"] += inventory
            if price:
                bucket["price"] = round(price, 2)

        for shop_key, by_resource in rows_by_station.items():
            rows = sorted(
                (
                    {**item, "inventory": round(float(item.get("inventory") or 0), 2)}
                    for item in by_resource.values()
                    if float(item.get("inventory") or 0) or item.get("price") is not None
                ),
                key=lambda item: RESOURCE_ORDER_INDEX.get(item["resourceKey"], 999),
            )
            detail = details[shop_key]
            detail["inventoryByResource"] = rows
            detail["inventory"] = round(sum(item["inventory"] for item in rows), 2)
            detail["prices"] = [
                {"resourceKey": item["resourceKey"], "name": item["name"], "price": item["price"]}
                for item in rows
                if item.get("price") is not None
            ]
        return {
            "items": list(details.values()),
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
            "sourceSheet": sheet_name,
            **snapshot_state,
        }
    except Exception:
        return None
    finally:
        if workbook is not None:
            workbook.close()


def _station_map_details_payload():
    cached = get_cached(STATION_MAP_DETAILS_CACHE_KEY)
    if cached and cache_allowed() and _station_map_details_cache_current(cached):
        return cached

    snapshot_payload = _station_map_details_from_report_snapshot()
    if snapshot_payload:
        set_cached(STATION_MAP_DETAILS_CACHE_KEY, snapshot_payload, ttl=STATION_MAP_DETAILS_TTL)
        return snapshot_payload

    station_keys = sorted(SHOP_KEY_MAP.keys())
    station_key_sql = ",".join(str(key) for key in station_keys)
    details = {
        shop_key: {
            "shopKey": shop_key,
            "inventory": 0.0,
            "inventoryByResource": [],
            "prices": [],
            "inventoryAsOf": None,
            "priceAsOf": None,
        }
        for shop_key in station_keys
    }
    inventory = {}
    prices = {}
    price_dates = {}
    inventory_dates = {}
    latest_shifts = {}

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT ShopKey, ShiftKey, DatetimeShiftEnd
            FROM shift
            WHERE ShopKey IN ({station_key_sql})
              AND DatetimeShiftBegin IS NOT NULL
              AND DatetimeShiftEnd IS NOT NULL
              AND DatetimeShiftEnd > DatetimeShiftBegin
              AND DatetimeShiftEnd >= DATE_SUB(NOW(), INTERVAL 180 DAY)
            ORDER BY ShopKey, DatetimeShiftEnd DESC
            """
        )
        for shop_key, shift_key, shift_end in cur.fetchall():
            latest_shifts.setdefault(int(shop_key), (int(shift_key), shift_end))

        if latest_shifts:
            conditions = " OR ".join(["(ShopKey = %s AND ShiftKey = %s)" for _ in latest_shifts])
            params = []
            for shop_key, (shift_key, _) in latest_shifts.items():
                params.extend([shop_key, shift_key])
            cur.execute(
                f"""
                SELECT ShopKey, ResourceKey, EndBalance, EndPrice, ResourceShopKey, ShiftKey
                FROM balance
                WHERE BeginMass IS NOT NULL
                  AND ({conditions})
                ORDER BY ShopKey, ResourceKey, ResourceShopKey
                """,
                params,
            )
            for shop_key, resource_key, end_balance, end_price, resource_shop_key, shift_key in cur.fetchall():
                sk = int(shop_key)
                rk = infer_balance_resource_key(sk, resource_key, end_price, resource_shop_key)
                if rk < 100 or rk not in KNOWN_RESOURCE_KEYS:
                    continue
                key = (sk, rk)
                inventory[key] = round(inventory.get(key, 0.0) + float(end_balance or 0), 2)
                as_of = latest_shifts.get(sk, (None, None))[1]
                if end_price:
                    prices[key] = round(float(end_price), 2)
                    price_dates[key] = as_of
                inventory_dates[sk] = as_of
    finally:
        conn.close()

    for shop_key in station_keys:
        resource_keys = sorted(
            {rk for sk, rk in inventory if sk == shop_key} | {rk for sk, rk in prices if sk == shop_key},
            key=lambda rk: RESOURCE_ORDER_INDEX.get(rk, 999),
        )
        rows = []
        for rk in resource_keys:
            volume = round(float(inventory.get((shop_key, rk), 0) or 0), 2)
            price = prices.get((shop_key, rk))
            if not volume and price is None:
                continue
            rows.append({
                "resourceKey": rk,
                "name": RESOURCE_NAMES.get(rk, f"Other-{rk}"),
                "inventory": volume,
                "price": price,
            })
        total_inventory = round(sum(item["inventory"] for item in rows), 2)
        detail = details[shop_key]
        detail["inventory"] = total_inventory
        detail["inventoryByResource"] = rows
        detail["prices"] = [
            {"resourceKey": item["resourceKey"], "name": item["name"], "price": item["price"]}
            for item in rows
            if item.get("price") is not None
        ]
        inv_dt = inventory_dates.get(shop_key)
        price_dt = max((price_dates.get((shop_key, rk)) for rk in resource_keys if price_dates.get((shop_key, rk))), default=None)
        detail["inventoryAsOf"] = inv_dt.isoformat(sep=" ", timespec="minutes") if hasattr(inv_dt, "isoformat") else None
        detail["priceAsOf"] = price_dt.isoformat(sep=" ", timespec="minutes") if hasattr(price_dt, "isoformat") else None
        detail["snapshotGeneratedAt"] = detail["inventoryAsOf"] or detail["priceAsOf"]

    latest_shift_end = max((shift_end for _, shift_end in latest_shifts.values() if shift_end), default=None)
    generated_at = (
        latest_shift_end.isoformat(sep=" ", timespec="minutes")
        if hasattr(latest_shift_end, "isoformat")
        else datetime.now().isoformat(timespec="minutes")
    )
    source_mtime = latest_shift_end.timestamp() if hasattr(latest_shift_end, "timestamp") else None

    payload = {
        "items": list(details.values()),
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "live_database",
        "snapshotGeneratedAt": generated_at,
        "sourceMtime": source_mtime,
    }
    set_cached(STATION_MAP_DETAILS_CACHE_KEY, payload, ttl=STATION_MAP_DETAILS_TTL)
    return payload
def _snapshot_month_labels(year):
    now = datetime.now()
    max_month = 12
    if year == now.year:
        max_month = now.month
    elif year > now.year:
        max_month = 0
    return [f"{year}-{month:02d}" for month in range(1, max_month + 1)]


def _monthly_snapshots_for_year(year):
    snapshots = []
    for label in _snapshot_month_labels(year):
        payload = get_cached(f"monthly:{label}")
        if payload:
            if retail_repair_payload_mass_from_report(label, payload):
                set_cached(f"monthly:{label}", payload)
            snapshots.append(payload)
    return snapshots


def _resource_map_from_rows(rows):
    bucket = {}
    for item in rows or []:
        add_resource_bucket(
            bucket,
            item.get("resourceKey") or item.get("key"),
            item.get("volume"),
            item.get("amount"),
            retail_mass_from_item(item),
        )
    return bucket


def _sum_resource_maps(*maps):
    merged = {}
    for resource_map in maps:
        for rk, values in (resource_map or {}).items():
            add_resource_bucket(merged, rk, values.get("volume"), values.get("amount"), values.get("mass"))
    return merged


def _resource_items_from_map(resource_map, previous=None, month_data=None, prev_month_data=None):
    previous = previous or {}
    month_data = month_data or {}
    prev_month_data = prev_month_data or {}
    resource_keys = sorted(set(resource_map) | set(previous) | set(month_data) | set(prev_month_data))
    resources = []
    for rk in resource_keys:
        cur_d = resource_map.get(rk, {"volume": 0, "amount": 0, "mass": 0})
        prev_d = previous.get(rk, {"volume": 0, "amount": 0, "mass": 0})
        mon_d = month_data.get(rk, {"volume": 0, "amount": 0, "mass": 0})
        prev_mon_d = prev_month_data.get(rk, {"volume": 0, "amount": 0, "mass": 0})
        mass = round(float(cur_d.get("mass") or 0), 3)
        latest_month_mass = round(float(mon_d.get("mass") or 0), 3)
        resources.append({
            "resourceKey": rk,
            "key": rk,
            "name": RESOURCE_NAMES.get(rk, f"Other-{rk}"),
            "volume": round(cur_d["volume"], 2),
            "mass": mass,
            "tons": round(mass / 1000, 3),
            "amount": round(cur_d["amount"], 2),
            "color": RESOURCE_COLORS.get(rk, "#999999"),
            "yoyVolume": calc_change(cur_d["volume"], prev_d["volume"]),
            "yoySales": calc_change(cur_d["amount"], prev_d["amount"]),
            "momVolume": calc_change(mon_d["volume"], prev_mon_d["volume"]),
            "momSales": calc_change(mon_d["amount"], prev_mon_d["amount"]),
            "latestMonthVolume": round(mon_d["volume"], 2),
            "latestMonthMass": latest_month_mass,
            "latestMonthTons": round(latest_month_mass / 1000, 3),
            "latestMonthAmount": round(mon_d["amount"], 2),
        })
    resources.sort(key=lambda item: RESOURCE_ORDER_INDEX.get(item["key"], 999))
    return resources


def _dashboard_yearly_from_monthly_snapshots(year):
    months = _monthly_snapshots_for_year(year)
    if not months:
        return None

    stations = {}
    resource_totals = {}
    query_start = f"{year}-01-01"
    query_end = query_start

    for payload in months:
        summary = payload.get("summary") or {}
        query_start = min(query_start, summary.get("queryStart") or query_start)
        query_end = max(query_end, summary.get("queryEnd") or query_end)
        for station in payload.get("stations") or []:
            shop_key = station.get("shopKey")
            if shop_key is None:
                continue
            bucket = stations.setdefault(int(shop_key), {
                "txnCount": 0,
                "volume": 0.0,
                "mass": 0.0,
                "amount": 0.0,
                "cash": 0.0,
                "card": 0.0,
                "cashLiters": 0.0,
                "cardLiters": 0.0,
                "bonus": 0.0,
            })
            bucket["txnCount"] += int(station.get("txnCount") or 0)
            bucket["volume"] += float(station.get("volume") or 0)
            bucket["mass"] += float(station.get("mass") or 0) or float(station.get("tons") or 0) * 1000
            bucket["amount"] += float(station.get("amount") or station.get("totalSales") or 0)
            bucket["cash"] += float(station.get("cash") or station.get("cashSales") or 0)
            bucket["card"] += float(station.get("card") or station.get("cardSales") or 0)
            bucket["cashLiters"] += float(station.get("cashLiters") or 0)
            bucket["cardLiters"] += float(station.get("cardLiters") or 0)
            bucket["bonus"] += float(station.get("bonus") or station.get("bonusCost") or 0)
        resource_totals = _sum_resource_maps(resource_totals, _resource_map_from_rows(payload.get("byResource")))

    stations_list = []
    for shop_key, info in SHOP_KEY_MAP.items():
        coords = SHOP_COORDS.get(shop_key, {"lng": 0, "lat": 0})
        data = stations.get(shop_key, {})
        amount = round(float(data.get("amount") or 0), 2)
        stations_list.append({
            "shopKey": shop_key,
            "name": info["name"],
            "short": info["short"],
            "region": info["region"],
            "lng": coords.get("lng", 0),
            "lat": coords.get("lat", 0),
            "txnCount": int(data.get("txnCount") or 0),
            "volume": round(float(data.get("volume") or 0), 2),
            "mass": round(float(data.get("mass") or 0), 3),
            "tons": round(float(data.get("mass") or 0) / 1000, 3),
            "amount": amount,
            "cash": round(float(data.get("cash") or 0), 2),
            "card": round(float(data.get("card") or 0), 2),
            "cashLiters": round(float(data.get("cashLiters") or 0), 2),
            "cardLiters": round(float(data.get("cardLiters") or 0), 2),
            "bonus": round(float(data.get("bonus") or 0), 2),
            "status": station_status_for(shop_key, amount),
            "closedReason": CLOSED_STATIONS.get(shop_key, ""),
        })

    regions = {}
    for station in stations_list:
        region = station["region"]
        bucket = regions.setdefault(region, {
            "amount": 0.0,
            "volume": 0.0,
            "tons": 0.0,
            "cash": 0.0,
            "card": 0.0,
            "bonus": 0.0,
            "stationCount": 0,
            "activeCount": 0,
        })
        bucket["stationCount"] += 1
        bucket["amount"] += station["amount"]
        bucket["volume"] += station["volume"]
        bucket["tons"] += station.get("tons") or 0
        bucket["cash"] += station["cash"]
        bucket["card"] += station["card"]
        bucket["bonus"] += station["bonus"]
        if station["amount"] > 0:
            bucket["activeCount"] += 1
    for data in regions.values():
        for key in ("amount", "volume", "cash", "card", "bonus"):
            data[key] = round(data[key], 2)
        data["tons"] = round(data.get("tons") or 0, 3)

    return {
        "year": year,
        "queryStart": query_start,
        "queryEndExclusive": query_end,
        "stations": stations_list,
        "depots": [
            {
                "name": name,
                "short": data["short"],
                "region": data["region"],
                "lng": data["lng"],
                "lat": data["lat"],
                "type": "depot",
                "status": data.get("status", "normal"),
                "closedReason": data.get("closedReason", ""),
            }
            for name, data in DEPOT_COORDS.items()
        ],
        "regions": regions,
        "byResource": format_resource_rows([
            (rk, values["volume"], values["amount"], values.get("mass", 0))
            for rk, values in resource_totals.items()
        ]),
        "snapshot": True,
    }


def _resources_yearly_from_monthly_snapshots(year, month=None):
    if month:
        current_label = f"{year}-{month:02d}"
        current_payload = get_cached(f"monthly:{current_label}")
        if not current_payload:
            return None
        if retail_repair_payload_mass_from_report(current_label, current_payload):
            set_cached(f"monthly:{current_label}", current_payload)
        prev_label = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"
        yoy_label = f"{year - 1}-{month:02d}"
        current = _resource_map_from_rows(current_payload.get("byResource"))
        previous = _resource_map_from_rows((get_cached(f"monthly:{yoy_label}") or {}).get("byResource"))
        prev_month_data = _resource_map_from_rows((get_cached(f"monthly:{prev_label}") or {}).get("byResource"))
        latest_month = current_label
        prev_month = prev_label
        period_start = current_payload.get("summary", {}).get("queryStart", f"{year}-{month:02d}-01")
        period_end = current_payload.get("summary", {}).get("queryEnd", period_start)
        resources = _resource_items_from_map(current, previous, current, prev_month_data)
    else:
        months = _monthly_snapshots_for_year(year)
        if not months:
            return None
        current = {}
        for payload in months:
            current = _sum_resource_maps(current, _resource_map_from_rows(payload.get("byResource")))
        previous = {}
        for payload in _monthly_snapshots_for_year(year - 1):
            previous = _sum_resource_maps(previous, _resource_map_from_rows(payload.get("byResource")))
        latest_payload = months[-1]
        latest_month = latest_payload.get("month")
        prev_month = None
        if latest_month:
            y, m = int(latest_month[:4]), int(latest_month[5:7])
            prev_month = f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
        month_data = _resource_map_from_rows(latest_payload.get("byResource"))
        prev_month_data = _resource_map_from_rows((get_cached(f"monthly:{prev_month}") or {}).get("byResource")) if prev_month else {}
        period_start = f"{year}-01-01"
        period_end = max((payload.get("summary", {}).get("queryEnd") or period_start for payload in months), default=period_start)
        resources = _resource_items_from_map(current, previous, month_data, prev_month_data)

    return {
        "year": year,
        "month": month,
        "periodLabel": f"{year}-{month:02d}" if month else f"{year} 全年",
        "queryStart": period_start,
        "queryEndExclusive": period_end,
        "latestMonth": latest_month,
        "prevMonth": prev_month,
        "resources": resources,
        "summary": {
            "totalVolume": round(sum(item["volume"] for item in resources), 2),
            "totalTons": round(sum(item["tons"] for item in resources), 3),
            "totalAmount": round(sum(item["amount"] for item in resources), 2),
            "resourceCount": len([item for item in resources if item["amount"] > 0 or item["volume"] > 0]),
        },
        "snapshot": True,
    }
