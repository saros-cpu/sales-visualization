from __future__ import annotations

from decimal import Decimal

from import_helpers import classify_wholesale_movement, load_entity_lookup, resolve_customer_reference


def resolve_exchange(cur, rate_date):
    cur.execute(
        "SELECT usd_kgs, cny_kgs FROM exchange_rates WHERE rate_date = %s",
        (rate_date,),
    )
    row = cur.fetchone()
    if not row:
        return None, None
    return row[0], row[1]


def convert_amount(amount_original, currency_code, usd_kgs, cny_kgs):
    if amount_original is None:
        return None, None, None, True

    currency_code = (currency_code or "KGS").upper()
    missing = False
    if currency_code == "KGS":
        amount_kgs = amount_original
    elif currency_code == "USD":
        if not usd_kgs:
            return None, None, None, True
        amount_kgs = amount_original * usd_kgs
    elif currency_code == "CNY":
        if not cny_kgs:
            return None, None, amount_original, True
        amount_kgs = amount_original * cny_kgs
    else:
        amount_kgs = amount_original
        missing = True

    amount_usd = amount_kgs / usd_kgs if usd_kgs else None
    amount_cny = amount_kgs / cny_kgs if cny_kgs else None
    missing = missing or not usd_kgs or not cny_kgs
    return amount_kgs, amount_usd, amount_cny, missing


def resolve_sales_customer(cur, raw_entity_name):
    return resolve_customer_reference(cur, raw_entity_name)


def provisional_sales_classification(customer_type, existing_classification):
    if customer_type in ("local_wholesale", "export_wholesale"):
        return customer_type
    return "unknown"


def recalculate_wholesale_details(cur, where_clause, params=()):
    cur.execute(
        f"""
        DELETE cr
        FROM calculation_results cr
        JOIN wholesale_detail_records d ON d.id = cr.detail_id
        WHERE {where_clause}
        """,
        params,
    )
    cur.execute(
        f"""
        DELETE qi
        FROM data_quality_issues qi
        JOIN wholesale_detail_records d ON d.id = qi.related_id
        WHERE {where_clause}
          AND qi.related_table = 'wholesale_detail_records'
        """,
        params,
    )

    entity_lookup = load_entity_lookup(cur)
    cur.execute(
        f"""
        SELECT id, business_date, raw_entity_name, sender_name, product_id, weight_tons, classification, audit_status
        FROM wholesale_detail_records d
        WHERE {where_clause}
        """,
        params,
    )
    details = cur.fetchall()

    matched = 0
    unmatched = 0
    missing_rates = 0
    classification_cache = {}
    manual_non_sales_classes = {"transfer", "processing", "procurement", "other"}
    for detail_id, business_date, raw_entity_name, sender_name, product_id, weight_tons, classification, audit_status in details:
        if audit_status == "approved" and classification in manual_non_sales_classes:
            cur.execute(
                """
                UPDATE wholesale_detail_records
                SET contract_id = NULL,
                    match_status = CASE WHEN product_id IS NULL THEN 'unmatched' ELSE 'matched' END
                WHERE id = %s
                """,
                (detail_id,),
            )
            continue
        classification_key = (raw_entity_name or "", sender_name or "")
        strict_classification = classification_cache.get(classification_key)
        if strict_classification is None:
            strict_classification = classify_wholesale_movement(
                cur,
                entity_lookup,
                raw_entity_name,
                sender_name=sender_name,
                current=classification,
            )
            classification_cache[classification_key] = strict_classification
        if strict_classification not in ("local_wholesale", "export_wholesale", "unknown"):
            cur.execute(
                """
                UPDATE wholesale_detail_records
                SET contract_id = NULL,
                    classification = %s,
                    match_status = CASE WHEN product_id IS NULL THEN 'unmatched' ELSE 'matched' END
                WHERE id = %s
                """,
                (strict_classification, detail_id),
            )
            continue

        if strict_classification == "unknown":
            issue_type = "unknown_product" if not product_id else "contract_unmatched"
            mark_unmatched(cur, detail_id, issue_type, "unknown")
            unmatched += 1
            continue

        customer_name, customer_type = resolve_sales_customer(cur, raw_entity_name)
        provisional_classification = strict_classification
        if not product_id:
            mark_unmatched(cur, detail_id, "unknown_product", provisional_classification)
            unmatched += 1
            continue

        cur.execute(
            """
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
            """,
            (customer_name, product_id, business_date, business_date),
        )
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
            cur.execute(
                """
                INSERT INTO data_quality_issues
                    (issue_type, severity, related_table, related_id, issue_date, message)
                VALUES ('missing_exchange_rate', 'warning', 'wholesale_detail_records', %s, %s, %s)
                """,
                (detail_id, business_date, "Wholesale amount needs manual exchange-rate completion."),
            )

        cur.execute(
            """
            INSERT INTO calculation_results
                (detail_id, contract_id, price_source, unit_price, currency_code,
                 amount_original, amount_kgs, amount_usd, amount_cny, exchange_rate_date, exchange_missing)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                detail_id,
                contract_id,
                price_source,
                unit_price,
                currency_code,
                amount_original,
                amount_kgs,
                amount_usd,
                amount_cny,
                business_date,
                exchange_missing,
            ),
        )
        cur.execute(
            """
            UPDATE wholesale_detail_records
            SET contract_id = %s, classification = %s, match_status = 'matched'
            WHERE id = %s
            """,
            (contract_id, strict_classification, detail_id),
        )
        matched += 1

    return {"matched": matched, "unmatched": unmatched, "missing_rates": missing_rates}


def recalculate_wholesale_batch(cur, batch_id):
    return recalculate_wholesale_details(cur, "d.batch_id = %s", (batch_id,))


def recalculate_wholesale_all(cur):
    return recalculate_wholesale_details(cur, "1 = 1")


def mark_unmatched(cur, detail_id, issue_type, classification="unknown"):
    cur.execute(
        """
        UPDATE wholesale_detail_records
        SET classification = %s,
            contract_id = NULL,
            match_status = 'needs_review'
        WHERE id = %s
        """,
        (classification, detail_id),
    )
    cur.execute(
        """
        INSERT INTO data_quality_issues
            (issue_type, severity, related_table, related_id, message)
        VALUES (%s, 'warning', 'wholesale_detail_records', %s, 'Wholesale quantity is counted; contract and pricing need review.')
        """,
        (issue_type, detail_id),
    )
