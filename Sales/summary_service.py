from __future__ import annotations

from datetime import date

from retail_bridge import summarize_retail


PRODUCT_SECTIONS = ("export_wholesale", "local_wholesale", "unknown", "transfer", "processing", "procurement")


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
        GROUP BY d.classification
        """,
        (start, end),
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
    for classification in PRODUCT_SECTIONS:
        cur.execute(
            """
            SELECT
                p.display_name,
                COALESCE(SUM(d.weight_tons), 0) AS tons,
                COALESCE(SUM(cr.amount_cny), 0) AS amount_cny
            FROM wholesale_detail_records d
            LEFT JOIN products p ON p.id = d.product_id
            LEFT JOIN calculation_results cr ON cr.detail_id = d.id
            WHERE d.business_date >= %s AND d.business_date < %s
              AND d.classification = %s
            GROUP BY p.display_name
            ORDER BY SUM(d.weight_tons) DESC
            LIMIT 20
            """,
            (start, end, classification),
        )
        result[classification] = [
            {
                "name": row[0] or "未识别油品",
                "classification": classification,
                "tons": round(float(row[1] or 0), 3),
                "amountCny": round(float(row[2] or 0), 2),
            }
            for row in cur.fetchall()
        ]
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
