from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
import sys

from summary_service import OPERATION_CLASSES, period_bounds, product_rankings, wholesale_operation_type_sql
from wholesale_source_policy import WHOLESALE_SOURCE_CUTOFF, detail_source_policy_clause, detail_source_policy_params
from text_utils import normalize_text


SALES_CLASSES = ("export_wholesale", "local_wholesale", "unknown", "processing", "procurement")
WHOLESALE_CLASSES = ("export_wholesale", "local_wholesale", "unknown", "transfer", "processing", "procurement")
PROJECT_ROOT = Path(__file__).resolve().parent
WEIGHING_SOURCE_META = {
    "storageDistrict": {
        "code": "storage",
        "label": "储运区",
        "table": "kj_weighing",
    },
    "lpgTankArea": {
        "code": "lpg_storage",
        "label": "液化气罐区",
        "table": "lpg_weighing",
    },
}
WEIGH_SOURCE_ALIASES = {
    "storage": "storageDistrict",
    "kj": "storageDistrict",
    "储运区": "storageDistrict",
    "lpg": "lpgTankArea",
    "lpg_storage": "lpgTankArea",
    "lpgTankArea": "lpgTankArea",
    "液化气罐区": "lpgTankArea",
}


def summarize_wholesale_page(cur, year, month=None):
    start, end = period_bounds(year, month)
    cards = category_cards(cur, start, end)
    data = _summarize_wholesale_period(
        cur,
        start,
        end,
        period={"year": year, "month": month},
        cards=cards,
    )
    data["comparison"] = wholesale_card_comparison(cur, year, month, cards)
    return data


def summarize_wholesale_range(cur, start, end, label=None):
    return _summarize_wholesale_period(
        cur,
        start,
        end,
        period={
            "year": start.year,
            "month": start.month if start.day == 1 and end == _next_month_start(start) else None,
            "label": label,
        },
    )


def _next_month_start(value: date) -> date:
    return date(value.year + 1, 1, 1) if value.month == 12 else date(value.year, value.month + 1, 1)


def _summarize_wholesale_period(cur, start, end, period=None, cards=None):
    cards = cards or category_cards(cur, start, end)
    period_info = {
        "year": start.year,
        "month": None,
        "start": start.isoformat(),
        "end": end.isoformat(),
    }
    period_info.update(period or {})
    period_info["start"] = start.isoformat()
    period_info["end"] = end.isoformat()
    completeness = wholesale_data_completeness(cur, start, end)
    return {
        "period": period_info,
        "cards": cards,
        "transportSummary": transport_summary(cur, start, end),
        "operationTransportSummary": operation_transport_summary(cur, start, end),
        "comparison": {},
        "productRankings": product_rankings(cur, start, end),
        "customerRankings": customer_rankings(cur, start, end),
        "transferTargets": transfer_targets(cur, start, end),
        "transferSummary": transfer_summary(cur, start, end),
        "dailyTrend": daily_trend(cur, start, end),
        "monthlyTrend": monthly_trend(cur, start, end),
        "review": review_summary(cur, start, end),
        "issues": open_issues(cur, start, end),
        "exchangeRates": exchange_rates(cur, start, end),
        "sourcePolicy": completeness.get("sourcePolicy"),
        "dataCompleteness": completeness,
        "dataQualityWarnings": wholesale_data_quality_warnings(completeness, start, end),
    }


def _table_exists(cur, table_name):
    cur.execute("SHOW TABLES LIKE %s", (table_name,))
    return bool(cur.fetchone())


def _lpg_product_filter(alias="d", product_alias="p"):
    raw = f"COALESCE({alias}.raw_product_name, '')"
    raw_upper = f"UPPER({raw})"
    return (
        "("
        f"{product_alias}.product_code = 'LPG' "
        f"OR {raw} LIKE '%%液化气%%' "
        f"OR {raw_upper} LIKE '%%LPG%%' "
        f"OR {raw_upper} LIKE '%%СПБТ%%' "
        f"OR {raw_upper} LIKE '%%СУГ%%' "
        f"OR {raw_upper} LIKE '%%ГАЗ%%'"
        ")"
    )


def _date_or_none(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def _round3(value):
    return round(float(value or 0), 3)


def _empty_total():
    return {
        "rows": 0,
        "tons": 0,
        "firstDate": None,
        "lastDate": None,
    }


def _empty_raw_source(table_exists=False):
    return {
        "tableExists": bool(table_exists),
        "rawRows": 0,
        "rawTons": 0,
        "firstRawDate": None,
        "lastRawDate": None,
    }


def _before_cutoff_window(start, end):
    window_end = min(end, WHOLESALE_SOURCE_CUTOFF)
    if start >= window_end:
        return None
    return start, window_end


def _from_cutoff_window(start, end):
    window_start = max(start, WHOLESALE_SOURCE_CUTOFF)
    if window_start >= end:
        return None
    return window_start, end


def _date_window_payload(window):
    if not window:
        return {"active": False, "start": None, "end": None}
    return {"active": True, "start": window[0].isoformat(), "end": window[1].isoformat()}


def _source_policy_payload(start, end):
    return {
        "cutoff": WHOLESALE_SOURCE_CUTOFF.isoformat(),
        "beforeCutoff": "batch_id IS NULL: weighing-generated detail rows from kj_weighing and lpg_weighing",
        "fromCutoff": "batch_id IS NOT NULL: uploaded or manual detail rows",
        "beforeCutoffLabel": "2026-06-01 前取两个罐区称重生成明细",
        "fromCutoffLabel": "2026-06-01 起取批发上传或手工录入明细",
        "detailTable": "wholesale_detail_records",
        "weighingTables": [
            {"key": key, "label": meta["label"], "table": meta["table"], "code": meta["code"]}
            for key, meta in WEIGHING_SOURCE_META.items()
        ],
        "applied": {
            "beforeCutoff": _date_window_payload(_before_cutoff_window(start, end)),
            "fromCutoff": _date_window_payload(_from_cutoff_window(start, end)),
        },
    }


def _normalize_detail_weigh_source(value):
    key = str(value or "").strip()
    return WEIGH_SOURCE_ALIASES.get(key) or WEIGH_SOURCE_ALIASES.get(key.lower()) or "storageDistrict"


def _policy_detail_totals(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS policy_rows,
            COALESCE(SUM(d.weight_tons), 0) AS policy_tons,
            COALESCE(SUM(CASE WHEN d.batch_id IS NULL THEN 1 ELSE 0 END), 0) AS weighing_rows,
            COALESCE(SUM(CASE WHEN d.batch_id IS NULL THEN d.weight_tons ELSE 0 END), 0) AS weighing_tons,
            COALESCE(SUM(CASE WHEN d.batch_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS uploaded_rows,
            COALESCE(SUM(CASE WHEN d.batch_id IS NOT NULL THEN d.weight_tons ELSE 0 END), 0) AS uploaded_tons,
            MIN(d.business_date) AS first_date,
            MAX(d.business_date) AS last_date
        FROM wholesale_detail_records d
        WHERE d.business_date >= %s AND d.business_date < %s
          AND {source_policy}
        """,
        (start, end, *detail_source_policy_params()),
    )
    row = cur.fetchone() or (0, 0, 0, 0, 0, 0, None, None)
    return {
        "businessPolicyRows": int(row[0] or 0),
        "businessPolicyTons": _round3(row[1]),
        "weighingGeneratedRows": int(row[2] or 0),
        "weighingGeneratedTons": _round3(row[3]),
        "uploadedOrManualRows": int(row[4] or 0),
        "uploadedOrManualTons": _round3(row[5]),
        "firstDetailDate": _date_or_none(row[6]),
        "lastDetailDate": _date_or_none(row[7]),
    }


def _detail_source_totals(cur, start, end):
    result = {key: _empty_total() for key in WEIGHING_SOURCE_META}
    cur.execute(
        """
        SELECT
            d.weigh_source,
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            MIN(d.business_date) AS first_date,
            MAX(d.business_date) AS last_date
        FROM wholesale_detail_records d
        WHERE d.batch_id IS NULL
          AND d.business_date >= %s AND d.business_date < %s
        GROUP BY d.weigh_source
        """,
        (start, end),
    )
    for source, rows, tons, first_date, last_date in cur.fetchall():
        key = _normalize_detail_weigh_source(source)
        item = result.setdefault(key, _empty_total())
        item["rows"] += int(rows or 0)
        item["tons"] = _round3(float(item["tons"] or 0) + float(tons or 0))
        first_value = _date_or_none(first_date)
        last_value = _date_or_none(last_date)
        if first_value and (not item["firstDate"] or first_value < item["firstDate"]):
            item["firstDate"] = first_value
        if last_value and (not item["lastDate"] or last_value > item["lastDate"]):
            item["lastDate"] = last_value
    total = _empty_total()
    for item in result.values():
        total["rows"] += int(item.get("rows") or 0)
        total["tons"] = _round3(float(total["tons"] or 0) + float(item.get("tons") or 0))
        first_value = item.get("firstDate")
        last_value = item.get("lastDate")
        if first_value and (not total["firstDate"] or first_value < total["firstDate"]):
            total["firstDate"] = first_value
        if last_value and (not total["lastDate"] or last_value > total["lastDate"]):
            total["lastDate"] = last_value
    return {"total": total, "sources": result}


def _uploaded_or_manual_detail_totals(cur, start, end):
    cur.execute(
        """
        SELECT
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            MIN(d.business_date) AS first_date,
            MAX(d.business_date) AS last_date
        FROM wholesale_detail_records d
        WHERE d.batch_id IS NOT NULL
          AND d.business_date >= %s AND d.business_date < %s
        """,
        (start, end),
    )
    row = cur.fetchone() or (0, 0, None, None)
    return {
        "rows": int(row[0] or 0),
        "tons": _round3(row[1]),
        "firstDate": _date_or_none(row[2]),
        "lastDate": _date_or_none(row[3]),
    }


def _storage_weighing_totals(cur, start, end):
    if not _table_exists(cur, "kj_weighing"):
        return _empty_raw_source(False)
    business_date_expr = "COALESCE(NULLIF(`毛重日期`, 0), `皮重日期`)"
    weight_expr = "COALESCE(NULLIF(`实重`, 0), `净重`, 0)"
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS row_count,
            COALESCE(SUM({weight_expr}), 0) AS net_kg,
            MIN({business_date_expr}) AS first_date,
            MAX({business_date_expr}) AS last_date
        FROM kj_weighing
        WHERE (`作废` IS NULL OR `作废` = 0)
          AND {business_date_expr} >= %s
          AND {business_date_expr} < %s
        """,
        (start, end),
    )
    row = cur.fetchone() or (0, 0, None, None)
    return {
        "tableExists": True,
        "rawRows": int(row[0] or 0),
        "rawTons": _round3(float(row[1] or 0) / 1000),
        "firstRawDate": _date_or_none(row[2]),
        "lastRawDate": _date_or_none(row[3]),
    }


def _lpg_wholesale_totals(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        f"""
        SELECT
            COUNT(*) AS policy_rows,
            COALESCE(SUM(d.weight_tons), 0) AS policy_tons,
            COALESCE(SUM(CASE WHEN d.batch_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS uploaded_rows,
            COALESCE(SUM(CASE WHEN d.batch_id IS NOT NULL THEN d.weight_tons ELSE 0 END), 0) AS uploaded_tons,
            COALESCE(SUM(CASE WHEN d.batch_id IS NULL THEN 1 ELSE 0 END), 0) AS weighing_rows,
            COALESCE(SUM(CASE WHEN d.batch_id IS NULL THEN d.weight_tons ELSE 0 END), 0) AS weighing_tons,
            MIN(d.business_date) AS first_date,
            MAX(d.business_date) AS last_date
        FROM wholesale_detail_records d
        LEFT JOIN products p ON p.id = d.product_id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND {source_policy}
          AND {_lpg_product_filter("d", "p")}
        """,
        (start, end, *detail_source_policy_params()),
    )
    row = cur.fetchone() or (0, 0, 0, 0, 0, 0, None, None)
    return {
        "businessPolicyRows": int(row[0] or 0),
        "businessPolicyTons": _round3(row[1]),
        "uploadedOrManualRows": int(row[2] or 0),
        "uploadedOrManualTons": _round3(row[3]),
        "weighingGeneratedRows": int(row[4] or 0),
        "weighingGeneratedTons": _round3(row[5]),
        "firstDetailDate": _date_or_none(row[6]),
        "lastDetailDate": _date_or_none(row[7]),
    }


def _lpg_weighing_totals(cur, start, end):
    if not _table_exists(cur, "lpg_weighing"):
        return _empty_raw_source(False)
    cur.execute(
        """
        SELECT
            COUNT(*) AS row_count,
            COALESCE(SUM(net_weight), 0) AS net_kg,
            MIN(business_date) AS first_date,
            MAX(business_date) AS last_date
        FROM lpg_weighing
        WHERE business_date >= %s AND business_date < %s
        """,
        (start, end),
    )
    row = cur.fetchone() or (0, 0, None, None)
    return {
        "tableExists": True,
        "rawRows": int(row[0] or 0),
        "rawTons": _round3(float(row[1] or 0) / 1000),
        "firstRawDate": _date_or_none(row[2]),
        "lastRawDate": _date_or_none(row[3]),
    }


def wholesale_data_completeness(cur, start, end):
    lpg_product = _lpg_wholesale_totals(cur, start, end)
    policy_detail = _policy_detail_totals(cur, start, end)
    before_window = _before_cutoff_window(start, end)
    from_window = _from_cutoff_window(start, end)
    if before_window:
        storage_source = _storage_weighing_totals(cur, *before_window)
        lpg_tank_source = _lpg_weighing_totals(cur, *before_window)
        weighing_detail = _detail_source_totals(cur, *before_window)
    else:
        storage_source = _empty_raw_source(_table_exists(cur, "kj_weighing"))
        lpg_tank_source = _empty_raw_source(_table_exists(cur, "lpg_weighing"))
        weighing_detail = {"total": _empty_total(), "sources": {key: _empty_total() for key in WEIGHING_SOURCE_META}}
    uploaded_detail = _uploaded_or_manual_detail_totals(cur, *from_window) if from_window else _empty_total()
    return {
        "sourcePolicy": _source_policy_payload(start, end),
        "businessDetail": policy_detail,
        "weighingGeneratedDetail": weighing_detail,
        "uploadedOrManualDetail": uploaded_detail,
        "weighingRawSources": {
            "storageDistrict": {
                **storage_source,
                "label": WEIGHING_SOURCE_META["storageDistrict"]["label"],
                "table": WEIGHING_SOURCE_META["storageDistrict"]["table"],
            },
            "lpgTankArea": {
                **lpg_tank_source,
                "label": WEIGHING_SOURCE_META["lpgTankArea"]["label"],
                "table": WEIGHING_SOURCE_META["lpgTankArea"]["table"],
            },
        },
        "lpgTankSource": {
            **lpg_tank_source,
            "note": "Automatic LPG tank-area weighing source. Required only for before-cutoff business policy checks.",
        },
        "lpgProductDetail": {
            **lpg_product,
            "supplementRows": lpg_product.get("uploadedOrManualRows", 0),
            "supplementTons": lpg_product.get("uploadedOrManualTons", 0),
            "note": "LPG product detail only; do not use it as LPG tank-area total because the tank area may also load AI-92/AI-80.",
        },
        "lpgTank": {
            **lpg_tank_source,
            **lpg_product,
            "supplementRows": lpg_product.get("uploadedOrManualRows", 0),
            "supplementTons": lpg_product.get("uploadedOrManualTons", 0),
            "note": "Compatibility field: rawRows/rawTons are tank-area source rows; businessPolicyTons is LPG product detail only, not tank-area total.",
        },
    }


def wholesale_data_quality_warnings(completeness, start, end):
    warnings = []
    raw_sources = (completeness or {}).get("weighingRawSources") or {}
    storage_source = raw_sources.get("storageDistrict") or {}
    lpg_source = raw_sources.get("lpgTankArea") or (completeness or {}).get("lpgTankSource") or (completeness or {}).get("lpgTank") or {}
    requires_weighing_source = start < WHOLESALE_SOURCE_CUTOFF
    if requires_weighing_source and storage_source.get("tableExists") and int(storage_source.get("rawRows") or 0) == 0:
        warnings.append(
            "2026-06-01 前统一口径看自动称重，但储运区自动源 kj_weighing 在所选区间没有记录；请确认原始称重同步或历史期间是否本来无储运区业务。"
        )
    if requires_weighing_source and lpg_source.get("tableExists") and int(lpg_source.get("rawRows") or 0) == 0:
        warnings.append(
            "2026-06-01 前统一口径看自动称重，但液化气罐区自动源 lpg_weighing 当前没有记录；因此年度/跨 6 月 1 日前的批发数据缺少罐区装车称重数据。6 月 1 日起改看上传或手工录入报表；报表暂不能区分是否来自液化气罐区，且罐区也可能装 AI-92/AI-80，系统不会用 LPG 产品量推算罐区总量。"
        )
    if start < WHOLESALE_SOURCE_CUTOFF < end:
        warnings.append("统一批发口径跨 2026-06-01：此前取称重生成明细，此日起取上传或手动录入明细。")
    return warnings


def _calc_change(current, previous):
    if not previous:
        return None
    return round((float(current or 0) - float(previous or 0)) / float(previous) * 100, 2)


def _previous_month(year, month):
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _comparison_cards(cur, year, month):
    start, end = period_bounds(year, month)
    return category_cards(cur, start, end)


def wholesale_card_comparison(cur, year, month, current_cards):
    if month:
        prev_year, prev_month = _previous_month(year, month)
        mom_cards = _comparison_cards(cur, prev_year, prev_month)
        yoy_cards = _comparison_cards(cur, year - 1, month)
    else:
        mom_cards = {}
        yoy_cards = _comparison_cards(cur, year - 1, None)

    result = {}
    for key, current in (current_cards or {}).items():
        mom = (mom_cards or {}).get(key) or {}
        yoy = (yoy_cards or {}).get(key) or {}
        result[key] = {
            "momTons": _calc_change(current.get("tons"), mom.get("tons")) if mom_cards else None,
            "momAmountCny": _calc_change(current.get("amountCny"), mom.get("amountCny")) if mom_cards else None,
            "yoyTons": _calc_change(current.get("tons"), yoy.get("tons")),
            "yoyAmountCny": _calc_change(current.get("amountCny"), yoy.get("amountCny")),
        }
    return result


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
        "south_CTY-30_depot": "南方STN-63",
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
    source_policy = detail_source_policy_clause("d")
    classification_values = ", ".join(f"'{item}'" for item in WHOLESALE_CLASSES)
    cur.execute(
        f"""
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
          AND {source_policy}
          AND d.classification IN ({classification_values})
        GROUP BY d.classification
        """,
        (start, end, *detail_source_policy_params()),
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


def transport_summary(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        """
        SELECT
            COALESCE(NULLIF(d.transport_mode, ''), 'truck') AS transport_mode,
            COUNT(*) AS row_count,
            COUNT(DISTINCT d.raw_entity_name) AS entity_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
            SUM(d.match_status = 'matched') AS matched_rows,
            SUM(d.match_status <> 'matched') AS review_rows
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.classification IN ('export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'processing', 'procurement')
        GROUP BY COALESCE(NULLIF(d.transport_mode, ''), 'truck')
        """,
        (start, end, *detail_source_policy_params()),
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
        for key in ("truck", "train")
    }
    for row in cur.fetchall():
        key = row[0] if row[0] in result else "truck"
        result[key] = {
            "rows": int(row[1] or 0),
            "entities": int(row[2] or 0),
            "tons": round(float(row[3] or 0), 3),
            "amountCny": round(float(row[4] or 0), 2),
            "matchedRows": int(row[5] or 0),
            "reviewRows": int(row[6] or 0),
        }
    return result


def _empty_card():
    return {
        "rows": 0,
        "entities": 0,
        "tons": 0,
        "amountCny": 0,
        "matchedRows": 0,
        "reviewRows": 0,
    }


def operation_transport_summary(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    operation_type = wholesale_operation_type_sql("d")
    operation_classes = ", ".join(f"'{item}'" for item in OPERATION_CLASSES)
    cur.execute(
        f"""
        SELECT
            {operation_type} AS operation_type,
            COALESCE(NULLIF(d.transport_mode, ''), 'truck') AS transport_mode,
            COUNT(*) AS row_count,
            COUNT(DISTINCT d.raw_entity_name) AS entity_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
            SUM(d.match_status = 'matched') AS matched_rows,
            SUM(d.match_status <> 'matched') AS review_rows
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.classification IN (""" + operation_classes + """)
        GROUP BY operation_type, COALESCE(NULLIF(d.transport_mode, ''), 'truck')
        """,
        (start, end, *detail_source_policy_params()),
    )
    result = {
        operation: {transport: _empty_card() for transport in ("truck", "train")}
        for operation in ("loading", "unloading")
    }
    for row in cur.fetchall():
        operation = row[0] if row[0] in result else "loading"
        transport = row[1] if row[1] in result[operation] else "truck"
        result[operation][transport] = {
            "rows": int(row[2] or 0),
            "entities": int(row[3] or 0),
            "tons": round(float(row[4] or 0), 3),
            "amountCny": round(float(row[5] or 0), 2),
            "matchedRows": int(row[6] or 0),
            "reviewRows": int(row[7] or 0),
        }
    return result


def _normalize_customer_display_name(name):
    return normalize_text(name or "").strip()


def _processing_customer_reference_maps(cur):
    cur.execute(
        """
        SELECT id, standard_name, normalized_name
        FROM customers
        WHERE standard_name IS NOT NULL
          AND TRIM(standard_name) <> ''
        """
    )
    name_by_customer_id = {
        str(row[0]): row[1]
        for row in cur.fetchall()
        if row[0] is not None and row[1]
    }

    cur.execute(
        """
        SELECT normalized_name, standard_name
        FROM customers
        WHERE standard_name IS NOT NULL
          AND TRIM(standard_name) <> ''
          AND normalized_name IS NOT NULL
          AND TRIM(normalized_name) <> ''
        """
    )
    normalized_name_by_alias = {
        _normalize_customer_display_name(row[0]): row[1]
        for row in cur.fetchall()
        if row[0] and row[1]
    }

    cur.execute(
        """
        SELECT normalized_alias, alias_name, standard_name
        FROM entity_aliases
        WHERE entity_type = 'wholesale_customer'
          AND standard_name IS NOT NULL
          AND TRIM(standard_name) <> ''
        ORDER BY confidence DESC, id DESC
        """
    )
    name_by_alias = {}
    for row in cur.fetchall():
        standard_name = row[2]
        for value in (row[0], row[1], standard_name):
            normalized = _normalize_customer_display_name(value)
            if not normalized:
                continue
            name_by_alias.setdefault(normalized, standard_name)
    name_by_alias.update({
        normalized: standard_name
        for normalized, standard_name in normalized_name_by_alias.items()
        if normalized and normalized not in name_by_alias
    })

    return name_by_customer_id, name_by_alias


def _resolve_customer_name(name_by_customer_id, name_by_alias, row):
    raw_entity_name, source_entity_name, entity_type, entity_code = row[0], row[1], row[2], row[3]
    if entity_type == "wholesale_customer" and entity_code is not None:
        standard_name = name_by_customer_id.get(str(entity_code))
        if standard_name:
            return standard_name

    for candidate in (source_entity_name, raw_entity_name):
        normalized_candidate = _normalize_customer_display_name(candidate)
        if not normalized_candidate:
            continue
        mapped = name_by_alias.get(normalized_candidate)
        if mapped:
            return mapped

    return source_entity_name


def _resolve_processing_customer_name(name_by_customer_id, name_by_alias, row):
    return _resolve_customer_name(name_by_customer_id, name_by_alias, row)


def customer_rankings(cur, start, end):
    result = {}
    source_policy = detail_source_policy_clause("d")
    name_by_customer_id, name_by_alias = _processing_customer_reference_maps(cur)
    for classification in SALES_CLASSES:
        cur.execute(
            """
            SELECT
                d.raw_entity_name,
                COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name) AS source_entity_name,
                d.entity_type,
                d.entity_code,
                COALESCE(SUM(d.weight_tons), 0) AS tons,
                COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
                COUNT(*) AS row_count,
                SUM(d.match_status = 'matched') AS matched_rows
            FROM wholesale_detail_records d
            LEFT JOIN calculation_results cr ON cr.detail_id = d.id
            WHERE d.business_date >= %s AND d.business_date < %s
              AND """ + source_policy + """
              AND d.classification = %s
            GROUP BY d.raw_entity_name, COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name), d.entity_type, d.entity_code
            """,
            (start, end, *detail_source_policy_params(), classification),
        )
        aggregated = {}
        for row in cur.fetchall():
            customer_name = _resolve_customer_name(name_by_customer_id, name_by_alias, row)
            bucket = aggregated.setdefault(
                customer_name,
                {
                    "name": customer_name,
                    "tons": 0.0,
                    "amountCny": 0.0,
                    "rows": 0,
                    "matchedRows": 0,
                },
            )
            bucket["tons"] += float(row[4] or 0)
            bucket["amountCny"] += float(row[5] or 0)
            bucket["rows"] += int(row[6] or 0)
            bucket["matchedRows"] += int(row[7] or 0)

        result[classification] = [
            {
                "name": name,
                "tons": round(values["tons"], 3),
                "amountCny": round(values["amountCny"], 2),
                "rows": values["rows"],
                "matchedRows": values["matchedRows"],
            }
            for name, values in sorted(
                aggregated.items(),
                key=lambda item: item[1]["tons"],
                reverse=True,
            )
        ][:20]
    return result

def transfer_targets(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    name_by_customer_id, name_by_alias = _processing_customer_reference_maps(cur)
    cur.execute(
        """
        SELECT
            d.entity_type,
            d.entity_code,
            d.raw_entity_name,
            COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name) AS source_entity_name,
            COUNT(*) AS row_count,
            COUNT(DISTINCT d.product_id) AS product_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons
        FROM wholesale_detail_records d
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.classification = 'transfer'
        GROUP BY d.entity_type, d.entity_code, d.raw_entity_name, COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name)
        ORDER BY SUM(d.weight_tons) DESC
        LIMIT 30
        """,
        (start, end, *detail_source_policy_params()),
    )
    aggregated = {}
    for row in cur.fetchall():
        customer_name = _resolve_customer_name(name_by_customer_id, name_by_alias, row[0:4])
        key = (row[0], row[1], customer_name)
        bucket = aggregated.setdefault(
            key,
            {
                "entityType": row[0],
                "entityCode": row[1],
                "region": region_for_transfer(row[0], row[1]),
                "name": customer_name,
                "rows": 0,
                "productCount": 0,
                "tons": 0.0,
            },
        )
        bucket["rows"] += int(row[4] or 0)
        bucket["productCount"] += int(row[5] or 0)
        bucket["tons"] += float(row[6] or 0)

    return [
        {
            **bucket,
            "tons": round(bucket["tons"], 3),
        }
        for bucket in sorted(aggregated.values(), key=lambda item: item["tons"], reverse=True)
    ]

def transfer_summary(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        """
        SELECT
            d.entity_type,
            d.entity_code,
            COALESCE(NULLIF(p.display_name, ''), d.raw_product_name),
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons
        FROM wholesale_detail_records d
        LEFT JOIN products p ON p.id = d.product_id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.classification = 'transfer'
        GROUP BY d.entity_type, d.entity_code, COALESCE(NULLIF(p.display_name, ''), d.raw_product_name)
        ORDER BY SUM(d.weight_tons) DESC
        """,
        (start, end, *detail_source_policy_params()),
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


def _empty_trend_point(bucket_key, key_name):
    return {
        key_name: bucket_key,
        "exportTons": 0,
        "localTons": 0,
        "pendingTons": 0,
        "transferTons": 0,
        "processingTons": 0,
        "procurementTons": 0,
        "amountCny": 0,
    }


def _apply_trend_row(item, classification, tons, amount_cny):
    tons_value = round(float(tons or 0), 3)
    if classification == "export_wholesale":
        item["exportTons"] = tons_value
    elif classification == "local_wholesale":
        item["localTons"] = tons_value
    elif classification == "unknown":
        item["pendingTons"] = tons_value
    elif classification == "transfer":
        item["transferTons"] = tons_value
    elif classification == "processing":
        item["processingTons"] = tons_value
    elif classification == "procurement":
        item["procurementTons"] = tons_value
    if classification in ("export_wholesale", "local_wholesale"):
        item["amountCny"] = round(item["amountCny"] + float(amount_cny or 0), 2)


def _month_after(year, month):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _fill_daily_trend(by_day, start, end):
    day_count = (end - start).days
    if day_count <= 0 or day_count > 366:
        return
    cursor = start
    while cursor < end:
        key = cursor.isoformat()
        by_day.setdefault(key, _empty_trend_point(key, "date"))
        cursor += timedelta(days=1)


def _fill_monthly_trend(by_month, start, end):
    cursor = date(start.year, start.month, 1)
    month_count = 0
    while cursor < end and month_count <= 120:
        key = f"{cursor.year}-{cursor.month:02d}"
        by_month.setdefault(key, _empty_trend_point(key, "month"))
        year, month = _month_after(cursor.year, cursor.month)
        cursor = date(year, month, 1)
        month_count += 1


def daily_trend(cur, start, end):
    source_policy = detail_source_policy_clause("d")
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
          AND """ + source_policy + """
          AND d.classification IN ('export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'processing', 'procurement')
        GROUP BY d.business_date, d.classification
        ORDER BY d.business_date
        """,
        (start, end, *detail_source_policy_params()),
    )
    by_day = {}
    for business_date, classification, tons, amount_cny in cur.fetchall():
        key = business_date.isoformat()
        item = by_day.setdefault(key, _empty_trend_point(key, "date"))
        _apply_trend_row(item, classification, tons, amount_cny)
    _fill_daily_trend(by_day, start, end)
    return [by_day[key] for key in sorted(by_day)]


def monthly_trend(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        """
        SELECT
            DATE_FORMAT(d.business_date, '%%Y-%%m') AS period_month,
            d.classification,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.classification IN ('export_wholesale', 'local_wholesale', 'unknown', 'transfer', 'processing', 'procurement')
        GROUP BY DATE_FORMAT(d.business_date, '%%Y-%%m'), d.classification
        ORDER BY period_month
        """,
        (start, end, *detail_source_policy_params()),
    )
    by_month = {}
    for period_month, classification, tons, amount_cny in cur.fetchall():
        key = str(period_month)
        item = by_month.setdefault(key, _empty_trend_point(key, "month"))
        _apply_trend_row(item, classification, tons, amount_cny)
    _fill_monthly_trend(by_month, start, end)
    return [by_month[key] for key in sorted(by_month)]


def review_summary(cur, start, end):
    source_policy = detail_source_policy_clause("d")
    name_by_customer_id, name_by_alias = _processing_customer_reference_maps(cur)
    cur.execute(
        """
        SELECT d.match_status, COUNT(*), COALESCE(SUM(d.weight_tons), 0)
        FROM wholesale_detail_records d
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
        GROUP BY d.match_status
        """,
        (start, end, *detail_source_policy_params()),
    )
    status = {
        row[0]: {"rows": int(row[1] or 0), "tons": round(float(row[2] or 0), 3)}
        for row in cur.fetchall()
    }
    cur.execute(
        """
        SELECT
            d.raw_entity_name,
            COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name) AS source_entity_name,
            d.entity_type,
            d.entity_code,
            d.raw_product_name,
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons
        FROM wholesale_detail_records d
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
          AND d.match_status <> 'matched'
        GROUP BY d.raw_entity_name, COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name), d.entity_type, d.entity_code, d.raw_product_name
        ORDER BY SUM(d.weight_tons) DESC
        LIMIT 20
        """,
        (start, end, *detail_source_policy_params()),
    )
    top = [
        {
            "entity": _resolve_customer_name(name_by_customer_id, name_by_alias, row[0:4]),
            "product": row[4],
            "rows": int(row[5] or 0),
            "tons": round(float(row[6] or 0), 3),
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
