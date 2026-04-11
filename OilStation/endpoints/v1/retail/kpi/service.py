import json
from datetime import date, datetime, timedelta
from pathlib import Path

from business_time import business_period_condition_with_pruning, business_period_params, shift_join
from cache_store import CACHE_TTL, get_cached, set_cached
from db import get_connection

from endpoints.v1.retail.common.query import (
    get_query_date_range,
    query_month_summary,
    get_latest_month_in_year,
    get_report_month_inventory,
)
from endpoints.v1.retail.analytics.service.shared import (
    report_mass_expr,
    retail_mass_from_item,
    retail_payload_mass_needs_refresh,
    retail_repair_payload_mass_from_report,
)

OILSTATION_ROOT = Path(__file__).resolve().parents[4]
YEARLY_TONS_SOURCE_DB = "retail_db_mass"
YEARLY_TONS_SOURCE_RESOURCES = "resources_yearly_true_mass"


def cache_allowed(refresh_arg):
    return refresh_arg not in {"1", "true", "yes"}


def snapshot_month_labels(year):
    now = datetime.now()
    if year > now.year:
        return []
    max_month = now.month if year == now.year else 12
    return [f"{year}-{month:02d}" for month in range(1, max_month + 1)]


def _monthly_snapshot_for_kpi(year_month):
    payload = get_cached(f"monthly:{year_month}")
    if payload and retail_payload_mass_needs_refresh(payload):
        if retail_repair_payload_mass_from_report(year_month, payload):
            set_cached(f"monthly:{year_month}", payload, ttl=CACHE_TTL["monthly"])
    return payload


def monthly_snapshots_for_year(year):
    return [
        payload
        for label in snapshot_month_labels(year)
        if (payload := _monthly_snapshot_for_kpi(label))
    ]


def completed_month_label():
    completed_day = date.today() - timedelta(days=1)
    return f"{completed_day.year}-{completed_day.month:02d}"


def _year_query_range(year):
    year_start = f"{year}-01-01"
    today_str = datetime.now().strftime("%Y-%m-%d")
    current_year = datetime.now().year
    if year == current_year:
        return year_start, today_str
    if year < current_year:
        return year_start, f"{year + 1}-01-01"
    return year_start, year_start


def _query_year_total_tons(year):
    year_start, year_end_exclusive = _year_query_range(year)
    if year_start == year_end_exclusive:
        return 0.0
    conn = get_connection()
    try:
        cur = conn.cursor()
        period_condition = business_period_condition_with_pruning("s", "sh")
        total_mass = report_mass_expr("s", year_start)
        cur.execute(
            f"""
            SELECT {total_mass}
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """,
            business_period_params(year_start, year_end_exclusive),
        )
        row = cur.fetchone()
        return round(float((row or [0])[0] or 0) / 1000, 3)
    finally:
        conn.close()


def _resources_year_total_tons(year):
    payload = get_cached(f"resources_yearly:{year}:year")
    if not isinstance(payload, dict):
        return 0.0
    summary = payload.get("summary") or {}
    summary_tons = _safe_float(summary.get("totalTons") or summary.get("tons"))
    if summary_tons > 0:
        return round(summary_tons, 3)
    total = 0.0
    for item in payload.get("resources") or payload.get("byResource") or []:
        if not isinstance(item, dict):
            continue
        mass = retail_mass_from_item(item)
        if mass is not None:
            total += mass / 1000
    return round(total, 3) if total > 0 else 0.0


def _resolve_year_total_tons(year, allow_db=True, allow_monthly=True):
    resource_tons = _resources_year_total_tons(year)
    if resource_tons > 0:
        return resource_tons, YEARLY_TONS_SOURCE_RESOURCES
    if allow_db:
        db_tons = _query_year_total_tons(year)
        if db_tons > 0:
            return db_tons, YEARLY_TONS_SOURCE_DB
    if allow_monthly:
        monthly_tons = sum(_payload_tons(month) for month in monthly_snapshots_for_year(year))
        if monthly_tons > 0:
            return round(monthly_tons, 3), "monthly_snapshot_mass"
    return 0.0, None


def inventory_from_report_extras(year_month):
    year, month = year_month.split("-")
    path = (
        OILSTATION_ROOT
        / "cache_snapshots"
        / "report_extras"
        / year
        / f"report_extras_{int(month):02d}.json"
    )
    if not path.exists():
        return 0.0
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        return round(float(data.get("totalEndInventory") or 0), 3)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return 0.0


def _resolve_inventory(year_month, summary=None):
    if not year_month:
        return 0.0
    summary = summary or {}
    for key in ("inventory", "endInventory", "totalEndInventory"):
        try:
            value = float(summary.get(key) or 0)
        except (TypeError, ValueError):
            value = 0.0
        if value > 0:
            return round(value, 3)

    value = inventory_from_report_extras(year_month)
    if value > 0:
        return value

    conn = get_connection()
    try:
        cur = conn.cursor()
        return round(float(get_report_month_inventory(cur, year_month) or 0), 3)
    finally:
        conn.close()


def _safe_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _payload_tons(payload):
    if not payload:
        return 0.0
    total = 0.0
    found_resource_mass = False
    for key in ("byResource", "resources"):
        rows = payload.get(key)
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            mass = retail_mass_from_item(row)
            if mass is not None:
                total += mass / 1000
                found_resource_mass = True
    if found_resource_mass:
        return total

    summary = payload.get("summary") or {}
    total_tons = _safe_float(summary.get("totalTons") or summary.get("tons"))
    if total_tons > 0:
        return total_tons
    for row in payload.get("byResource") or payload.get("resources") or []:
        row_tons = _safe_float(row.get("tons"))
        total += row_tons if row_tons > 0 else _safe_float(row.get("mass")) / 1000
    return total


def _attach_yearly_tons(year, payload):
    if not payload:
        return False
    summary = payload.setdefault("summary", {})
    current_tons = _safe_float(summary.get("totalTons"))
    current_source = summary.get("totalTonsSource")
    trusted = current_tons > 0 and current_source in {
        YEARLY_TONS_SOURCE_DB,
        YEARLY_TONS_SOURCE_RESOURCES,
    }
    total_tons, total_source = _resolve_year_total_tons(
        year,
        allow_db=not trusted,
        allow_monthly=not trusted,
    )
    if total_tons <= 0:
        return False
    if (
        current_tons > 0
        and current_source == total_source
        and abs(current_tons - total_tons) <= max(0.5, total_tons * 0.001)
    ):
        return False
    summary["totalTons"] = round(total_tons, 3)
    if total_source:
        summary["totalTonsSource"] = total_source
    return True


def _latest_snapshot_month(year):
    months = monthly_snapshots_for_year(year)
    if months:
        return months[-1].get("month")
    return None


def _attach_yearly_inventory(year, payload, include_inventory):
    if not include_inventory or not payload:
        return False
    summary = payload.setdefault("summary", {})
    changed = False
    try:
        current_inventory = float(summary.get("inventory") or 0)
    except (TypeError, ValueError):
        current_inventory = 0.0

    latest_month = summary.get("inventoryMonth") or _latest_snapshot_month(year)
    if not latest_month:
        conn = get_connection()
        try:
            cur = conn.cursor()
            latest_month = get_latest_month_in_year(cur, year)
        finally:
            conn.close()
    latest_snapshot = get_cached(f"monthly:{latest_month}") if latest_month else None
    latest_summary = (latest_snapshot or {}).get("summary") or {}
    if latest_summary.get("activeShops") is not None and summary.get("activeShops") != latest_summary.get("activeShops"):
        summary["activeShops"] = latest_summary.get("activeShops")
        changed = True
    if latest_summary.get("totalShops") is not None and summary.get("totalShops") != latest_summary.get("totalShops"):
        summary["totalShops"] = latest_summary.get("totalShops")
        changed = True
    if summary.get("activeMonth") != latest_month:
        summary["activeMonth"] = latest_month
        changed = True
    if current_inventory <= 0 or not summary.get("inventoryMonth"):
        inventory = _resolve_inventory(latest_month, latest_summary) if latest_month else 0.0
        if summary.get("inventory") != inventory or summary.get("inventoryMonth") != latest_month:
            summary["inventory"] = inventory
            summary["inventoryMonth"] = latest_month
            changed = True
    return changed


def yearly_kpi_from_monthly_snapshots(year, include_inventory):
    months = monthly_snapshots_for_year(year)
    if not months:
        return None
    prev_months = monthly_snapshots_for_year(year - 1)

    def totals(payloads):
        shops = set()
        volume = 0.0
        tons = 0.0
        amount = 0.0
        txn = 0
        query_start = f"{year}-01-01"
        query_end = query_start
        for payload in payloads:
            summary = payload.get("summary") or {}
            volume += float(summary.get("totalLiters") or 0)
            tons += _payload_tons(payload)
            amount += float(summary.get("totalSales") or 0)
            txn += int(summary.get("totalTxn") or 0)
            query_start = min(query_start, summary.get("queryStart") or query_start)
            query_end = max(query_end, summary.get("queryEnd") or query_end)
            for station in payload.get("stations") or []:
                if float(station.get("amount") or 0) > 0 or float(station.get("volume") or 0) > 0:
                    shops.add(station.get("shopKey"))
        return {
            "activeShops": len(shops),
            "totalVolume": volume,
            "totalTons": tons,
            "totalAmount": amount,
            "transactionCount": txn,
            "queryStart": query_start,
            "queryEnd": query_end,
        }

    current = totals(months)
    resolved_tons, tons_source = _resolve_year_total_tons(year, allow_monthly=False)
    if resolved_tons > 0:
        current["totalTons"] = resolved_tons
    previous = totals(prev_months) if prev_months else {"totalVolume": 0.0, "totalAmount": 0.0}

    def calc_change(current_value, previous_value):
        if not previous_value or previous_value == 0:
            return 0
        return round((current_value - previous_value) / previous_value * 100, 1)

    latest_month = months[-1].get("month") if months else None
    latest_summary = months[-1].get("summary") or {}
    inventory = _resolve_inventory(latest_month, latest_summary) if latest_month else 0.0

    return {
        "year": year,
        "summary": {
            "activeShops": int(latest_summary.get("activeShops") or current["activeShops"]),
            "totalShops": int(latest_summary.get("totalShops") or 0),
            "activeMonth": latest_month,
            "totalVolume": round(current["totalVolume"], 2),
            "totalTons": round(current["totalTons"], 3),
            "totalTonsSource": tons_source or "monthly_snapshot_mass",
            "totalAmount": round(current["totalAmount"], 2),
            "totalSales": round(current["totalAmount"], 2),
            "totalLiters": round(current["totalVolume"], 2),
            "inventory": inventory if include_inventory else 0.0,
            "inventoryMonth": latest_month if include_inventory else None,
            "queryStart": current["queryStart"],
            "queryEndExclusive": current["queryEnd"],
            "transactionCount": current["transactionCount"],
        },
        "comparison": {
            "yoyVolume": calc_change(current["totalVolume"], previous["totalVolume"]),
            "yoySales": calc_change(current["totalAmount"], previous["totalAmount"]),
            "yoySalesAmount": calc_change(current["totalAmount"], previous["totalAmount"]),
        },
        "snapshot": True,
    }


def get_current_kpi():
    cache_key = "kpi:current"
    cached = get_cached(cache_key)
    if cached:
        summary = cached.setdefault("summary", {})
        if _safe_float(summary.get("totalTons")) <= 0:
            snapshot_month = cached.get("month") or completed_month_label()
            summary["totalTons"] = round(_payload_tons(get_cached(f"monthly:{snapshot_month}")), 3)
            set_cached(cache_key, cached, ttl=60)
        return cached

    refresh_arg = ""
    snapshot_month = completed_month_label()
    snapshot = get_cached(f"monthly:{snapshot_month}")
    if snapshot:
        summary = dict(snapshot.get("summary") or {})
        if _safe_float(summary.get("totalTons")) <= 0:
            summary["totalTons"] = round(_payload_tons(snapshot), 3)
        summary.setdefault("totalTonsSource", snapshot.get("massSource") or "monthly_snapshot_mass")
        summary["inventory"] = _resolve_inventory(snapshot_month, summary)
        summary["inventoryMonth"] = snapshot_month
        result = {
            "month": snapshot_month,
            "summary": summary,
            "snapshot": True,
            "source": "monthly_snapshot",
        }
        set_cached(cache_key, result, ttl=60)
        return result

    conn = get_connection()
    try:
        cur = conn.cursor()

        now = datetime.now()
        ym = f"{now.year}-{now.month:02d}"
        ym_start, ym_end = get_query_date_range(ym)

        summary = query_month_summary(cur, ym)

        period_condition = business_period_condition_with_pruning("s", "sh")
        total_mass = report_mass_expr("s", ym_start)
        cur.execute(
            f"""
            SELECT COUNT(DISTINCT s.ShopKey), {total_mass}
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND s.ShopCost > 0
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """,
            business_period_params(ym_start, ym_end),
        )
        active_row = cur.fetchone()
        summary["activeShops"] = int(active_row[0] or 0)
        summary["totalTons"] = round(float(active_row[1] or 0) / 1000, 3)
        summary["totalTonsSource"] = YEARLY_TONS_SOURCE_DB
        summary["inventory"] = get_report_month_inventory(cur, ym)
        summary["inventoryMonth"] = ym

        result = {
            "month": ym,
            "summary": summary,
        }
        set_cached(cache_key, result, ttl=60)
        return result
    finally:
        conn.close()


def get_yearly_kpi(year, include_inventory):
    cache_key = f"kpi:yearly:{year}:{'with_inventory' if include_inventory else 'summary'}"
    cached = get_cached(cache_key)
    if cached:
        changed = _attach_yearly_inventory(year, cached, include_inventory)
        changed = _attach_yearly_tons(year, cached) or changed
        if changed:
            set_cached(cache_key, cached, ttl=CACHE_TTL["kpi_yearly"])
        return cached

    snapshot_cache_key = f"kpi_yearly:{year}:{'with_inventory' if include_inventory else 'summary'}"
    snapshot = get_cached(snapshot_cache_key)
    if snapshot:
        changed = _attach_yearly_inventory(year, snapshot, include_inventory)
        changed = _attach_yearly_tons(year, snapshot) or changed
        if changed:
            set_cached(cache_key, snapshot, ttl=CACHE_TTL["kpi_yearly"])
            set_cached(snapshot_cache_key, snapshot, ttl=CACHE_TTL["kpi_yearly"])
        return snapshot

    snapshot = yearly_kpi_from_monthly_snapshots(year, include_inventory)
    if snapshot:
        set_cached(cache_key, snapshot, ttl=CACHE_TTL["kpi_yearly"])
        set_cached(snapshot_cache_key, snapshot, ttl=CACHE_TTL["kpi_yearly"])
        return snapshot

    conn = get_connection()
    try:
        cur = conn.cursor()

        year_start, year_end_exclusive = _year_query_range(year)

        period_condition = business_period_condition_with_pruning("s", "sh")
        total_mass = report_mass_expr("s", year_start)
        cur.execute(
            f"""
            SELECT
                COUNT(DISTINCT s.ShopKey) as active_shops,
                SUM(s.Volume) as total_volume,
                {total_mass} as total_mass,
                SUM(s.ShopCost) as total_amount,
                COUNT(*) as transaction_count
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """,
            business_period_params(year_start, year_end_exclusive),
        )
        summary = cur.fetchone()

        prev_year = year - 1
        prev_year_start = f"{prev_year}-01-01"
        prev_next_year_start = f"{year}-01-01"

        cur.execute(
            f"""
            SELECT SUM(s.Volume) as prev_volume, SUM(s.ShopCost) as prev_amount
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """,
            business_period_params(prev_year_start, prev_next_year_start),
        )
        prev_summary = cur.fetchone()

        def calc_change(current, previous):
            if not previous or previous == 0:
                return 0
            return round((current - previous) / previous * 100, 1)

        latest_month = get_latest_month_in_year(cur, year)
        latest_summary = query_month_summary(cur, latest_month, exclude_today=False) if latest_month else {}
        inventory = get_report_month_inventory(cur, latest_month) if include_inventory and latest_month else 0.0

        result = {
            "year": year,
            "summary": {
                "activeShops": int(latest_summary.get("activeShops") or summary[0] or 0),
                "totalShops": int(latest_summary.get("totalShops") or 0),
                "activeMonth": latest_month,
                "totalVolume": round(float(summary[1] or 0), 2),
                "totalTons": round(float(summary[2] or 0) / 1000, 3),
                "totalTonsSource": YEARLY_TONS_SOURCE_DB,
                "totalAmount": round(float(summary[3] or 0), 2),
                "totalSales": round(float(summary[3] or 0), 2),
                "totalLiters": round(float(summary[1] or 0), 2),
                "inventory": inventory,
                "inventoryMonth": latest_month,
                "queryStart": year_start,
                "queryEndExclusive": year_end_exclusive,
            },
            "comparison": {
                "yoyVolume": calc_change(summary[1] or 0, prev_summary[0] or 0),
                "yoySales": calc_change(summary[3] or 0, prev_summary[1] or 0),
                "yoySalesAmount": calc_change(summary[3] or 0, prev_summary[1] or 0),
            },
        }

        set_cached(cache_key, result, ttl=CACHE_TTL["kpi"])
        return result
    finally:
        conn.close()
