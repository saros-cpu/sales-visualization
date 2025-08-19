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

OILSTATION_ROOT = Path(__file__).resolve().parents[4]


def cache_allowed(refresh_arg):
    return refresh_arg not in {"1", "true", "yes"}


def snapshot_month_labels(year):
    now = datetime.now()
    if year > now.year:
        return []
    max_month = now.month if year == now.year else 12
    return [f"{year}-{month:02d}" for month in range(1, max_month + 1)]


def monthly_snapshots_for_year(year):
    return [
        payload
        for label in snapshot_month_labels(year)
        if (payload := get_cached(f"monthly:{label}"))
    ]


def completed_month_label():
    completed_day = date.today() - timedelta(days=1)
    return f"{completed_day.year}-{completed_day.month:02d}"


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
        amount = 0.0
        txn = 0
        query_start = f"{year}-01-01"
        query_end = query_start
        for payload in payloads:
            summary = payload.get("summary") or {}
            volume += float(summary.get("totalLiters") or 0)
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
            "totalAmount": amount,
            "transactionCount": txn,
            "queryStart": query_start,
            "queryEnd": query_end,
        }

    current = totals(months)
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
        return cached

    refresh_arg = ""
    snapshot_month = completed_month_label()
    snapshot = get_cached(f"monthly:{snapshot_month}")
    if snapshot:
        summary = dict(snapshot.get("summary") or {})
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
        cur.execute(
            f"""
            SELECT COUNT(DISTINCT s.ShopKey)
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND s.ShopCost > 0
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """,
            business_period_params(ym_start, ym_end),
        )
        summary["activeShops"] = int(cur.fetchone()[0] or 0)
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
        if _attach_yearly_inventory(year, cached, include_inventory):
            set_cached(cache_key, cached, ttl=CACHE_TTL["kpi_yearly"])
        return cached

    snapshot_cache_key = f"kpi_yearly:{year}:{'with_inventory' if include_inventory else 'summary'}"
    snapshot = get_cached(snapshot_cache_key)
    if snapshot:
        if _attach_yearly_inventory(year, snapshot, include_inventory):
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

        year_start = f"{year}-01-01"
        today_str = datetime.now().strftime("%Y-%m-%d")
        current_year = datetime.now().year
        if year == current_year:
            year_end_exclusive = today_str
        elif year < current_year:
            year_end_exclusive = f"{year + 1}-01-01"
        else:
            year_end_exclusive = year_start

        period_condition = business_period_condition_with_pruning("s", "sh")
        cur.execute(
            f"""
            SELECT
                COUNT(DISTINCT s.ShopKey) as active_shops,
                SUM(s.Volume) as total_volume,
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
                "totalAmount": round(float(summary[2] or 0), 2),
                "totalSales": round(float(summary[2] or 0), 2),
                "totalLiters": round(float(summary[1] or 0), 2),
                "inventory": inventory,
                "inventoryMonth": latest_month,
                "queryStart": year_start,
                "queryEndExclusive": year_end_exclusive,
            },
            "comparison": {
                "yoyVolume": calc_change(summary[1] or 0, prev_summary[0] or 0),
                "yoySales": calc_change(summary[2] or 0, prev_summary[1] or 0),
                "yoySalesAmount": calc_change(summary[2] or 0, prev_summary[1] or 0),
            },
        }

        set_cached(cache_key, result, ttl=CACHE_TTL["kpi"])
        return result
    finally:
        conn.close()
