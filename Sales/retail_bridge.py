from __future__ import annotations

from datetime import date, timedelta
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

import pymysql

from config import DB_CONFIG, OILSTATION_BASE_URL
from retail_internal import get_oilstation_json


_CACHE = {}
_CACHE_TTL_SECONDS = 300
SHOP_KEYS = tuple(range(1, 31))


RESOURCE_NAMES = {
    102: "AI 80",
    103: "AI 92",
    104: "AI 95",
    106: "Диз Топливо",
    107: "СПБТ",
    108: "ГАЗ",
    109: "Диз Топливо",
    110: "Диз Топливо K5",
}


def period_bounds(year, month=None):
    if month:
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    else:
        start = date(year, 1, 1)
        end = date(year + 1, 1, 1)
    today = date.today()
    if start <= today < end:
        end = today
    return start, end


def get_retail_connection():
    cfg = dict(DB_CONFIG)
    cfg["database"] = "ocw"
    cfg["autocommit"] = True
    return pymysql.connect(**cfg)


def cached(key):
    item = _CACHE.get(key)
    if not item:
        return None
    expires_at, payload = item
    if expires_at < time.time():
        _CACHE.pop(key, None)
        return None
    return payload


def set_cache(key, payload):
    _CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, payload)


def normalize_resource_key(resource_key):
    key = int(resource_key or 0)
    if key in (109, 110):
        return 106
    if key in (102, 103, 104, 106, 108, 110):
        return key
    return key


def load_densities(cur):
    cur.execute(
        """
        SELECT p.retail_resource_key, d.effective_date, d.density
        FROM product_density_history d
        JOIN products p ON p.id = d.product_id
        WHERE p.retail_resource_key IS NOT NULL
        ORDER BY p.retail_resource_key, d.effective_date
        """
    )
    densities = {}
    for resource_key, effective_date, density in cur.fetchall():
        densities.setdefault(int(resource_key), []).append((effective_date, float(density)))
    return densities


def density_for(densities, resource_key, day):
    rows = densities.get(normalize_resource_key(resource_key), [])
    selected = None
    for effective_date, density in rows:
        if effective_date <= day:
            selected = density
        else:
            break
    return selected


def load_rates(cur, start, end):
    cur.execute(
        """
        SELECT rate_date, cny_kgs
        FROM exchange_rates
        WHERE rate_date >= %s AND rate_date < %s
        """,
        (start, end),
    )
    return {row[0]: float(row[1]) for row in cur.fetchall() if row[1]}


def parse_iso_date(value):
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def fetch_oilstation_summary(year, month=None):
    query = {"year": year}
    if month:
        query["month"] = month
    return get_oilstation_json("/api/integration/retail-summary", query)


def summarize_from_oilstation(cur, year, month=None):
    source = fetch_oilstation_summary(year, month)
    start = parse_iso_date(source.get("queryStart")) if source.get("queryStart") else period_bounds(year, month)[0]
    end = parse_iso_date(source.get("queryEndExclusive")) if source.get("queryEndExclusive") else period_bounds(year, month)[1]
    densities = load_densities(cur)
    rates = load_rates(cur, start, end)
    summary = source.get("summary") or {}

    total_liters = float(summary.get("totalLiters") or 0)
    total_kgs = float(summary.get("totalSales") or 0)
    total_tons = 0.0
    total_cny = 0.0
    missing = []
    by_product = {}

    for item in source.get("daily") or []:
        business_day = parse_iso_date(item.get("date"))
        amount_kgs = float(item.get("amount") or 0)
        rate = rates.get(business_day)
        if rate:
            total_cny += amount_kgs / rate
        elif amount_kgs:
            missing.append(business_day.isoformat())

    for item in source.get("dailyResource") or []:
        business_day = parse_iso_date(item.get("date"))
        resource_key = normalize_resource_key(item.get("resourceKey"))
        liters = float(item.get("volume") or 0)
        density = density_for(densities, resource_key, business_day)
        tons = liters * float(density or 0) / 1000
        total_tons += tons
        if density is None and liters:
            missing.append(f"density:{resource_key}:{business_day.isoformat()}")

        bucket = by_product.setdefault(
            str(resource_key),
            {
                "resourceKey": resource_key,
                "name": RESOURCE_NAMES.get(resource_key, f"Resource {resource_key}"),
                "liters": 0.0,
                "tons": 0.0,
            },
        )
        bucket["liters"] += liters
        bucket["tons"] += tons

    return {
        "liters": round(total_liters, 2),
        "tons": round(total_tons, 3),
        "amountKgs": round(total_kgs, 2),
        "amountCny": round(total_cny, 2),
        "byProduct": sorted(by_product.values(), key=lambda item: item["tons"], reverse=True),
        "missingRateDates": sorted(set(missing)),
        "errors": [],
        "source": source.get("source", "OilStation"),
    }


def fetch_retail_rows(start, end):
    inferred_resource_expr = """
        CASE
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 7  THEN 102
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 8  THEN 103
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 9  THEN 104
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 10 THEN 109
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 11 THEN 110
            WHEN s.ShopKey = 28 AND s.ResourceShopKey = 12 THEN 108
            WHEN s.ShopKey = 6  AND s.ResourceShopKey = 1  THEN 103
            WHEN s.ShopKey = 6  AND s.ResourceShopKey = 2  THEN 104
            WHEN s.ShopKey = 6  AND s.ResourceShopKey = 3  THEN 102
            WHEN s.ShopKey = 6  AND s.ResourceShopKey = 5  THEN 106
            WHEN s.ShopKey IN (7, 15) AND s.ResourceKey = 104 THEN 102
            WHEN s.ShopKey = 29 AND s.ResourceShopKey = 7  THEN 103
            WHEN s.ShopKey = 29 AND s.ResourceShopKey = 8  THEN 102
            WHEN s.ShopKey = 29 AND s.ResourceShopKey = 9  THEN 106
            WHEN s.ShopKey = 29 AND s.ResourceShopKey = 10 THEN 108
            WHEN s.ResourceKey >= 100 THEN s.ResourceKey
            WHEN s.BasePrice <= 0 THEN s.ResourceKey
            WHEN s.BasePrice <= 45 THEN 108
            WHEN s.BasePrice <= 65 THEN 102
            WHEN s.BasePrice <= 78 THEN 103
            WHEN s.BasePrice <= 83 THEN 104
            ELSE 106
        END
    """
    conn = get_retail_connection()
    try:
        cur = conn.cursor()
        rows = []
        for shop_key in SHOP_KEYS:
            cur.execute(
                f"""
                SELECT
                    DATE(s.TransactionDatetime) AS business_day,
                    {inferred_resource_expr} AS resource_key,
                    COALESCE(SUM(s.Volume), 0) AS liters,
                    COALESCE(SUM(s.ShopCost), 0) AS amount_kgs
                FROM selling s FORCE INDEX (Index_ST)
                WHERE s.ShopKey = %s
                  AND s.TransactionDatetime >= %s
                  AND s.TransactionDatetime < %s
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4))
                GROUP BY DATE(s.TransactionDatetime), {inferred_resource_expr}
                """,
                (shop_key, start, end),
            )
            rows.extend(cur.fetchall())
        return rows
    finally:
        conn.close()


def summarize_retail(cur, year, month=None):
    cache_key = (year, month)
    payload = cached(cache_key)
    if payload:
        return payload

    try:
        result = summarize_from_oilstation(cur, year, month)
        set_cache(cache_key, result)
        return result
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        error = f"OilStation integration unavailable: {exc}"
    except Exception as exc:
        error = f"OilStation integration failed: {exc}"

    result = {
        "liters": 0.0,
        "tons": 0.0,
        "amountKgs": 0.0,
        "amountCny": 0.0,
        "byProduct": [],
        "missingRateDates": [],
        "errors": [error],
        "source": "OilStationUnavailable",
    }
    set_cache(cache_key, result)
    return result
