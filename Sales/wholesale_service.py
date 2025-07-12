from __future__ import annotations

from pathlib import Path
import sys

from summary_service import period_bounds, product_rankings


SALES_CLASSES = ("export_wholesale", "local_wholesale", "unknown", "processing", "procurement")
WHOLESALE_CLASSES = ("export_wholesale", "local_wholesale", "unknown", "transfer", "processing", "procurement")
PROJECT_ROOT = Path(__file__).resolve().parent


def summarize_wholesale_page(cur, year, month=None):
    start, end = period_bounds(year, month)
    return {
        "period": {
            "year": year,
            "month": month,
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
        "cards": category_cards(cur, start, end),
        "productRankings": product_rankings(cur, start, end),
        "customerRankings": customer_rankings(cur, start, end),
        "transferTargets": transfer_targets(cur, start, end),
        "transferSummary": transfer_summary(cur, start, end),
        "dailyTrend": daily_trend(cur, start, end),
        "review": review_summary(cur, start, end),
        "issues": open_issues(cur, start, end),
        "exchangeRates": exchange_rates(cur, start, end),
    }


def retail_region_lookup():
    oilstation_root = PROJECT_ROOT.parent / "OilStation"
    sys.path.insert(0, str(oilstation_root))
    try:
        from constants import DEPOT_COORDS, SHOP_KEY_MAP
    finally:
        sys.path = [item for item in sys.path if item != str(oilstation_root)]

    station_regions = {str(shop_key): info.get("region") or "未识别区域" for shop_key, info in SHOP_KEY_MAP.items()}
    depot_regions = {
        "north_CTY-22-LAT_depot": DEPOT_COORDS.get("DemoDepotNorth", {}).get("region", "REG-06"),
        "south_CTY-30_depot": DEPOT_COORDS.get("DemoDepotSouth", {}).get("region", "REG-07"),
    }
    return station_regions, depot_regions


def region_for_transfer(entity_type, entity_code):
    station_regions, depot_regions = retail_region_lookup()
    if entity_type == "retail_station":
        return station_regions.get(str(entity_code), "未识别区域")
    if entity_type == "own_depot":
        return depot_regions.get(str(entity_code), "未识别区域")
    return "未识别区域"


def category_cards(cur, start, end):
    cur.execute(
        """
        SELECT
            d.classification,
            COUNT(*) AS row_count,
            COUNT(DISTINCT d.raw_entity_name) AS entity_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
            SUM(d.match_status = 'matched') AS matched_rows,
            SUM(d.match_status <> 'matched') AS review_rows
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND d.classification IN ('export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'processing', 'procurement')
        GROUP BY d.classification
        """,
        (start, end),
    )
    result = {
        key: {
            "rows": 0,
            "entities": 0,
            "tons": 0,
            "amountCny": 0,
            "matchedRows": 0,
            "reviewRows": 0,
        }
        for key in WHOLESALE_CLASSES
    }
    for row in cur.fetchall():
        result[row[0]] = {
            "rows": int(row[1] or 0),
            "entities": int(row[2] or 0),
            "tons": round(float(row[3] or 0), 3),
            "amountCny": round(float(row[4] or 0), 2),
            "matchedRows": int(row[5] or 0),
            "reviewRows": int(row[6] or 0),
        }
    return result


def customer_rankings(cur, start, end):
    result = {}
    for classification in SALES_CLASSES:
        cur.execute(
            """
            SELECT
                d.raw_entity_name,
                COALESCE(SUM(d.weight_tons), 0) AS tons,
                COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
                COUNT(*) AS row_count,
                SUM(d.match_status = 'matched') AS matched_rows
            FROM wholesale_detail_records d
            LEFT JOIN calculation_results cr ON cr.detail_id = d.id
            WHERE d.business_date >= %s AND d.business_date < %s
              AND d.classification = %s
            GROUP BY d.raw_entity_name
            ORDER BY SUM(d.weight_tons) DESC
            LIMIT 20
            """,
            (start, end, classification),
        )
        result[classification] = [
            {
                "name": row[0],
                "tons": round(float(row[1] or 0), 3),
                "amountCny": round(float(row[2] or 0), 2),
                "rows": int(row[3] or 0),
                "matchedRows": int(row[4] or 0),
            }
            for row in cur.fetchall()
        ]
    return result


def transfer_targets(cur, start, end):
    cur.execute(
        """
        SELECT
            d.entity_type,
            d.entity_code,
            COALESCE(d.standard_entity_name, d.raw_entity_name) AS target_name,
            COUNT(*) AS row_count,
            COUNT(DISTINCT d.product_id) AS product_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons
        FROM wholesale_detail_records d
        WHERE d.business_date >= %s AND d.business_date < %s
          AND d.classification = 'transfer'
        GROUP BY d.entity_type, d.entity_code, COALESCE(d.standard_entity_name, d.raw_entity_name)
        ORDER BY SUM(d.weight_tons) DESC
        LIMIT 30
        """,
        (start, end),
    )
    return [
        {
            "entityType": row[0],
            "entityCode": row[1],
            "region": region_for_transfer(row[0], row[1]),
            "name": row[2],
            "rows": int(row[3] or 0),
            "productCount": int(row[4] or 0),
            "tons": round(float(row[5] or 0), 3),
        }
        for row in cur.fetchall()
    ]


def transfer_summary(cur, start, end):
    cur.execute(
        """
        SELECT
            d.entity_type,
            d.entity_code,
            p.display_name,
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons
        FROM wholesale_detail_records d
        LEFT JOIN products p ON p.id = d.product_id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND d.classification = 'transfer'
        GROUP BY d.entity_type, d.entity_code, p.display_name
        ORDER BY SUM(d.weight_tons) DESC
        """,
        (start, end),
    )
    region_map = {}
    product_map = {}
    region_product_map = {}
    for entity_type, entity_code, product_name, rows, tons in cur.fetchall():
        region = region_for_transfer(entity_type, entity_code)
        product_name = product_name or "未识别油品"
        tons_value = float(tons or 0)
        region_item = region_map.setdefault(region, {"region": region, "rows": 0, "tons": 0})
        region_item["rows"] += int(rows or 0)
        region_item["tons"] += tons_value

        product_item = product_map.setdefault(product_name, {"name": product_name, "rows": 0, "tons": 0})
        product_item["rows"] += int(rows or 0)
        product_item["tons"] += tons_value

        key = (region, product_name)
        region_product_item = region_product_map.setdefault(
            key,
            {"region": region, "product": product_name, "rows": 0, "tons": 0},
        )
        region_product_item["rows"] += int(rows or 0)
        region_product_item["tons"] += tons_value

    def ordered(values):
        return sorted(
            (
                {**item, "tons": round(item["tons"], 3)}
                for item in values
            ),
            key=lambda item: item["tons"],
            reverse=True,
        )

    return {
        "byRegion": ordered(region_map.values()),
        "byProduct": ordered(product_map.values()),
        "byRegionProduct": ordered(region_product_map.values()),
    }


def daily_trend(cur, start, end):
    cur.execute(
        """
        SELECT
            d.business_date,
            d.classification,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND d.classification IN ('export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'processing', 'procurement')
        GROUP BY d.business_date, d.classification
        ORDER BY d.business_date
        """,
        (start, end),
    )
    by_day = {}
    for business_date, classification, tons, amount_cny in cur.fetchall():
        item = by_day.setdefault(
            business_date.isoformat(),
            {
                "date": business_date.isoformat(),
                "exportTons": 0,
                "localTons": 0,
                "pendingTons": 0,
                "transferTons": 0,
                "processingTons": 0,
                "procurementTons": 0,
                "amountCny": 0,
            },
        )
        if classification == "export_wholesale":
            item["exportTons"] = round(float(tons or 0), 3)
        elif classification == "local_wholesale":
            item["localTons"] = round(float(tons or 0), 3)
        elif classification == "unknown":
            item["pendingTons"] = round(float(tons or 0), 3)
        elif classification == "transfer":
            item["transferTons"] = round(float(tons or 0), 3)
        elif classification == "processing":
            item["processingTons"] = round(float(tons or 0), 3)
        elif classification == "procurement":
            item["procurementTons"] = round(float(tons or 0), 3)
        if classification in ("export_wholesale", "local_wholesale"):
            item["amountCny"] = round(item["amountCny"] + float(amount_cny or 0), 2)
    return list(by_day.values())


def review_summary(cur, start, end):
    cur.execute(
        """
        SELECT match_status, COUNT(*), COALESCE(SUM(weight_tons), 0)
        FROM wholesale_detail_records
        WHERE business_date >= %s AND business_date < %s
        GROUP BY match_status
        """,
        (start, end),
    )
    status = {
        row[0]: {"rows": int(row[1] or 0), "tons": round(float(row[2] or 0), 3)}
        for row in cur.fetchall()
    }
    cur.execute(
        """
        SELECT
            raw_entity_name,
            raw_product_name,
            COUNT(*) AS row_count,
            COALESCE(SUM(weight_tons), 0) AS tons
        FROM wholesale_detail_records
        WHERE business_date >= %s AND business_date < %s
          AND match_status <> 'matched'
        GROUP BY raw_entity_name, raw_product_name
        ORDER BY SUM(weight_tons) DESC
        LIMIT 20
        """,
        (start, end),
    )
    top = [
        {
            "entity": row[0],
            "product": row[1],
            "rows": int(row[2] or 0),
            "tons": round(float(row[3] or 0), 3),
        }
        for row in cur.fetchall()
    ]
    return {"status": status, "topNeedsReview": top}


def open_issues(cur, start, end):
    cur.execute(
        """
        SELECT issue_type, severity, issue_date, message
        FROM data_quality_issues
        WHERE status = 'open'
          AND (issue_date IS NULL OR (issue_date >= %s AND issue_date < %s))
        ORDER BY
          CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          issue_date DESC,
          id DESC
        LIMIT 50
        """,
        (start, end),
    )
    return [
        {
            "type": row[0],
            "severity": row[1],
            "date": row[2].isoformat() if row[2] else None,
            "message": row[3],
        }
        for row in cur.fetchall()
    ]


def exchange_rates(cur, start, end):
    cur.execute(
        """
        SELECT
            er.rate_date,
            er.usd_kgs,
            er.cny_kgs,
            er.source,
            er.is_manual,
            COALESCE(g.status, IF(er.usd_kgs IS NULL OR er.cny_kgs IS NULL, 'open', 'resolved')) AS gap_status,
            COALESCE(g.missing_usd, er.usd_kgs IS NULL) AS missing_usd,
            COALESCE(g.missing_cny, er.cny_kgs IS NULL) AS missing_cny
        FROM exchange_rates er
        LEFT JOIN exchange_rate_gaps g ON g.rate_date = er.rate_date
        WHERE er.rate_date >= %s AND er.rate_date < %s
        ORDER BY er.rate_date DESC
        """,
        (start, end),
    )
    items = [
        {
            "date": row[0].isoformat(),
            "usdKgs": float(row[1]) if row[1] is not None else None,
            "cnyKgs": float(row[2]) if row[2] is not None else None,
            "source": row[3],
            "isManual": bool(row[4]),
            "gapStatus": row[5],
            "missingUsd": bool(row[6]),
            "missingCny": bool(row[7]),
        }
        for row in cur.fetchall()
    ]
    return {
        "items": items,
        "total": len(items),
        "missingUsd": sum(1 for item in items if item["missingUsd"]),
        "missingCny": sum(1 for item in items if item["missingCny"]),
        "openGaps": sum(1 for item in items if item["gapStatus"] == "open"),
    }
