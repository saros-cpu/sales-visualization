from __future__ import annotations

import sys
from pathlib import Path
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from calculations import (
    resolve_sales_customer, provisional_sales_classification,
    mark_unmatched, resolve_exchange, convert_amount,
)
from db import get_connection
from import_helpers import load_product_lookup


def match_all():
    conn = get_connection()
    try:
        cur = conn.cursor()

        cur.execute("DELETE FROM calculation_results")
        cur.execute("DELETE FROM data_quality_issues WHERE related_table = 'wholesale_detail_records'")

        cur.execute("""
            SELECT id, business_date, raw_entity_name, product_id, weight_tons, classification
            FROM wholesale_detail_records
            WHERE classification IN ('local_wholesale', 'export_wholesale', 'unknown')
        """)
        details = cur.fetchall()
        print(f"Processing {len(details)} wholesale detail records...")

        matched = 0
        unmatched = 0
        missing_rates = 0

        for detail_id, business_date, raw_entity_name, product_id, weight_tons, classification in details:
            customer_name, customer_type = resolve_sales_customer(cur, raw_entity_name)
            provisional_classification = provisional_sales_classification(customer_type, classification)
            if not product_id:
                mark_unmatched(cur, detail_id, "unknown_product", provisional_classification)
                unmatched += 1
                continue

            cur.execute("""
                SELECT c.id, c.sales_type, c.price_without_logistics, c.price_with_logistics, c.currency_code
                FROM contracts c
                JOIN customers cu ON cu.id = c.customer_id
                WHERE cu.normalized_name = %s
                  AND c.product_id = %s
                  AND (c.effective_start IS NULL OR c.effective_start <= %s)
                  AND (c.effective_end IS NULL OR c.effective_end >= %s)
                ORDER BY
                  CASE c.sales_type WHEN 'export_wholesale' THEN 0 WHEN 'local_wholesale' THEN 1 ELSE 2 END,
                  c.effective_start DESC,
                  c.id DESC
                LIMIT 1
            """, (customer_name, product_id, business_date, business_date))
            contract = cur.fetchone()
            if not contract:
                mark_unmatched(cur, detail_id, "contract_unmatched", provisional_classification)
                unmatched += 1
                continue

            contract_id, sales_type, price_without, price_with, currency_code = contract
            unit_price = price_without if price_without is not None else price_with
            price_source = "without_logistics" if price_without is not None else "with_logistics"
            if unit_price is None:
                price_source = "missing"
                amount_original = None
            else:
                amount_original = Decimal(weight_tons) * Decimal(unit_price)

            usd_kgs, cny_kgs = resolve_exchange(cur, business_date)
            amount_kgs, amount_usd, amount_cny, exchange_missing = convert_amount(
                amount_original, currency_code, usd_kgs, cny_kgs
            )
            if exchange_missing:
                missing_rates += 1
                cur.execute("""
                    INSERT INTO data_quality_issues
                        (issue_type, severity, related_table, related_id, issue_date, message)
                    VALUES ('missing_exchange_rate', 'warning', 'wholesale_detail_records', %s, %s, %s)
                """, (detail_id, business_date, "Wholesale amount needs manual exchange-rate completion."))

            cur.execute("""
                INSERT INTO calculation_results
                    (detail_id, contract_id, price_source, unit_price, currency_code,
                     amount_original, amount_kgs, amount_usd, amount_cny, exchange_rate_date, exchange_missing)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                detail_id, contract_id, price_source, unit_price, currency_code,
                amount_original, amount_kgs, amount_usd, amount_cny, business_date, exchange_missing,
            ))
            matched += 1

        conn.commit()
        print(f"Done: matched={matched}, unmatched={unmatched}, missing_rates={missing_rates}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    match_all()
