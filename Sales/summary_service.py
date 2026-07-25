from __future__ import annotations

from datetime import date

from retail_bridge import summarize_retail
from wholesale_source_policy import detail_source_policy_clause, detail_source_policy_params


PRODUCT_SECTIONS = ("export_wholesale", "local_wholesale", "unknown", "transfer", "processing", "procurement")
LOADING_CLASSES = ("export_wholesale", "local_wholesale", "transfer")
UNLOADING_CLASSES = ("procurement",)
OPERATION_CLASSES = LOADING_CLASSES + UNLOADING_CLASSES


def wholesale_operation_type_for_classification(classification):
    if classification in UNLOADING_CLASSES:
        return "unloading"
    if classification in LOADING_CLASSES:
        return "loading"
    return "other"


def wholesale_operation_type_sql(alias="d"):
    loading_values = ", ".join(f"'{item}'" for item in LOADING_CLASSES)
    return (
        "CASE "
        f"WHEN {alias}.classification = 'procurement' THEN 'unloading' "
        f"WHEN {alias}.classification IN ({loading_values}) THEN 'loading' "
        "ELSE 'other' "
        "END"
    )


def period_bounds(year, month=None):
    if month:
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    else:
        start = date(year, 1, 1)
        end = date(year + 1, 1, 1)
    return start, end


def summarize_wholesale(cur, year, month=None):
    start, end = period_bounds(year, month)
    source_policy = detail_source_policy_clause("d")
    cur.execute(
        """
        SELECT
            d.classification,
            COUNT(*) AS row_count,
            COALESCE(SUM(d.weight_tons), 0) AS tons,
            COALESCE(SUM(cr.amount_kgs), 0) AS amount_kgs,
            COALESCE(SUM(cr.amount_cny), 0) AS amount_cny
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.business_date >= %s AND d.business_date < %s
          AND """ + source_policy + """
        GROUP BY d.classification
        """,
        (start, end, *detail_source_policy_params()),
    )
    categories = {}
    for classification, row_count, tons, amount_kgs, amount_cny in cur.fetchall():
        categories[classification] = {
            "rows": int(row_count or 0),
            "tons": round(float(tons or 0), 3),
            "amountKgs": round(float(amount_kgs or 0), 2),
            "amountCny": round(float(amount_cny or 0), 2),
        }

    by_product_category = product_rankings(cur, start, end)

    cur.execute(
        """
        SELECT issue_type, COUNT(*)
        FROM data_quality_issues
        WHERE status = 'open'
        GROUP BY issue_type
        ORDER BY COUNT(*) DESC
        """
    )
    issues = [{"type": row[0], "count": int(row[1])} for row in cur.fetchall()]

    sales_keys = ("local_wholesale", "export_wholesale", "unknown")
    sales_tons = sum(categories.get(key, {}).get("tons", 0) for key in sales_keys)
    sales_cny = sum(categories.get(key, {}).get("amountCny", 0) for key in sales_keys)
    transfer_tons = categories.get("transfer", {}).get("tons", 0)

    return {
        "categories": categories,
        "salesTons": round(sales_tons, 3),
        "salesAmountCny": round(sales_cny, 2),
        "pendingSalesTons": categories.get("unknown", {}).get("tons", 0),
        "transferTons": round(transfer_tons, 3),
        "byProduct": [item for section in PRODUCT_SECTIONS for item in by_product_category[section]],
        "byProductCategory": by_product_category,
        "issues": issues,
    }


def product_rankings(cur, start, end):
    result = {}
    source_policy = detail_source_policy_clause("d")
    operation_type = wholesale_operation_type_sql("d")
    for classification in PRODUCT_SECTIONS:
        cur.execute(
            f"""
            SELECT
                COALESCE(NULLIF(p.display_name, ''), d.raw_product_name),
                COALESCE(SUM(d.weight_tons), 0) AS tons,
                COALESCE(SUM(cr.amount_cny), 0) AS amount_cny,
                COUNT(*) AS row_count,
                SUM(CASE WHEN COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN 1 ELSE 0 END) AS truck_rows,
                COALESCE(SUM(CASE WHEN COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN d.weight_tons ELSE 0 END), 0) AS truck_tons,
                SUM(CASE WHEN COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN 1 ELSE 0 END) AS train_rows,
                COALESCE(SUM(CASE WHEN COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN d.weight_tons ELSE 0 END), 0) AS train_tons,
                SUM(CASE WHEN {operation_type} = 'loading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN 1 ELSE 0 END) AS loading_truck_rows,
                COALESCE(SUM(CASE WHEN {operation_type} = 'loading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN d.weight_tons ELSE 0 END), 0) AS loading_truck_tons,
                SUM(CASE WHEN {operation_type} = 'loading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN 1 ELSE 0 END) AS loading_train_rows,
                COALESCE(SUM(CASE WHEN {operation_type} = 'loading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN d.weight_tons ELSE 0 END), 0) AS loading_train_tons,
                SUM(CASE WHEN {operation_type} = 'unloading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN 1 ELSE 0 END) AS unloading_truck_rows,
                COALESCE(SUM(CASE WHEN {operation_type} = 'unloading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'truck' THEN d.weight_tons ELSE 0 END), 0) AS unloading_truck_tons,
                SUM(CASE WHEN {operation_type} = 'unloading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN 1 ELSE 0 END) AS unloading_train_rows,
                COALESCE(SUM(CASE WHEN {operation_type} = 'unloading' AND COALESCE(NULLIF(d.transport_mode, ''), 'truck') = 'train' THEN d.weight_tons ELSE 0 END), 0) AS unloading_train_tons
            FROM wholesale_detail_records d
            LEFT JOIN products p ON p.id = d.product_id
            LEFT JOIN calculation_results cr ON cr.detail_id = d.id
            WHERE d.business_date >= %s AND d.business_date < %s
              AND """ + source_policy + """
              AND d.classification = %s
            GROUP BY COALESCE(NULLIF(p.display_name, ''), d.raw_product_name)
            ORDER BY SUM(d.weight_tons) DESC
            LIMIT 20
            """,
            (start, end, *detail_source_policy_params(), classification),
        )
        items = []
        for row in cur.fetchall():
            item = {
                "name": row[0] or "未识别油品",
                "classification": classification,
                "tons": round(float(row[1] or 0), 3),
                "amountCny": round(float(row[2] or 0), 2),
                "rows": int(row[3] or 0),
                "truckRows": int(row[4] or 0),
                "truckTons": round(float(row[5] or 0), 3),
                "trainRows": int(row[6] or 0),
                "trainTons": round(float(row[7] or 0), 3),
            }
            if classification in OPERATION_CLASSES:
                item.update(
                    {
                        "loadingTruckRows": int(row[8] or 0),
                        "loadingTruckTons": round(float(row[9] or 0), 3),
                        "loadingTrainRows": int(row[10] or 0),
                        "loadingTrainTons": round(float(row[11] or 0), 3),
                        "unloadingTruckRows": int(row[12] or 0),
                        "unloadingTruckTons": round(float(row[13] or 0), 3),
                        "unloadingTrainRows": int(row[14] or 0),
                        "unloadingTrainTons": round(float(row[15] or 0), 3),
                    }
                )
            items.append(item)
        result[classification] = items
    return result


def summarize_combined(cur, year, month=None):
    retail = summarize_retail(cur, year, month)
    wholesale = summarize_wholesale(cur, year, month)
    combined = {
        "salesTons": round(retail["tons"] + wholesale["salesTons"], 3),
        "salesAmountCny": round(retail["amountCny"] + wholesale["salesAmountCny"], 2),
        "transferTons": wholesale["transferTons"],
    }
    return {"retail": retail, "wholesale": wholesale, "combined": combined}


def available_periods(cur):
    cur.execute(
        """
        SELECT DISTINCT YEAR(business_date), MONTH(business_date)
        FROM wholesale_detail_records
        ORDER BY 1 DESC, 2 DESC
        """
    )
    wholesale_months = [{"year": int(row[0]), "month": int(row[1])} for row in cur.fetchall()]
    years = sorted({item["year"] for item in wholesale_months if item["year"] > 0} | {2023, 2024, 2025, 2026})
    return {"years": years, "wholesaleMonths": wholesale_months}
