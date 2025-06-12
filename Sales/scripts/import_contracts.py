from __future__ import annotations

import argparse
from pathlib import Path
import sys

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from db import get_connection
from import_helpers import (
    get_or_create_batch,
    get_or_create_customer,
    load_product_lookup,
    lookup_product,
    reset_batch_rows,
    store_raw_row,
)
from text_utils import clean_str, parse_date, parse_decimal


MAIN_SHEET_INDEX = 0
DATA_START_ROW = 3


def classify_sales_type(remark):
    text = (remark or "").upper()
    if "ЭКСПОРТ" in text or "EXPORT" in text or "出口" in text:
        return "export_wholesale"
    if "МЕСТНАЯ" in text or "本地" in text:
        return "local_wholesale"
    if "服务" in text or "УСЛУГ" in text:
        return "internal"
    return "unknown"


def import_contracts(path):
    conn = get_connection()
    try:
        cur = conn.cursor()
        batch_id = get_or_create_batch(
            cur,
            source_type="contract_excel",
            source_path=path,
        )
        reset_batch_rows(cur, batch_id, ["contracts"])

        product_lookup = load_product_lookup(cur)
        xl = pd.ExcelFile(path)
        sheet_name = xl.sheet_names[MAIN_SHEET_INDEX]
        df = pd.read_excel(path, sheet_name=sheet_name, header=None)

        imported = 0
        unknown_products = 0
        for row_idx in range(DATA_START_ROW, len(df)):
            row = df.iloc[row_idx].tolist()
            store_raw_row(cur, batch_id, sheet_name, row_idx + 1, row)

            customer = clean_str(row[2] if len(row) > 2 else None)
            contract_no = clean_str(row[3] if len(row) > 3 else None)
            raw_product = clean_str(row[9] if len(row) > 9 else None)
            if not customer or not contract_no or not raw_product:
                continue

            remark = clean_str(row[17] if len(row) > 17 else None)
            sales_type = classify_sales_type(remark)
            customer_id = get_or_create_customer(cur, customer, sales_type if sales_type != "internal" else "unknown")
            product = lookup_product(product_lookup, raw_product)
            product_id = product["id"] if product else None
            if not product_id:
                unknown_products += 1
                cur.execute(
                    """
                    INSERT INTO data_quality_issues
                        (issue_type, severity, related_table, related_id, message)
                    VALUES ('unknown_product', 'warning', 'contracts', NULL, %s)
                    """,
                    (f"Contract product is not mapped: {raw_product}",),
                )

            cur.execute(
                """
                INSERT INTO contracts
                    (batch_id, customer_id, raw_customer_name, contract_no, appendix_no,
                     signed_date, effective_start, effective_end, product_id, raw_product_name,
                     destination, sales_type, price_with_logistics, price_without_logistics,
                     contract_quantity_tons, contract_amount_original, currency_code, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'KGS', %s)
                """,
                (
                    batch_id,
                    customer_id,
                    customer,
                    contract_no,
                    clean_str(row[4] if len(row) > 4 else None),
                    parse_date(row[1] if len(row) > 1 else None),
                    parse_date(row[5] if len(row) > 5 else None),
                    parse_date(row[6] if len(row) > 6 else None),
                    product_id,
                    raw_product,
                    clean_str(row[10] if len(row) > 10 else None),
                    sales_type,
                    parse_decimal(row[11] if len(row) > 11 else None),
                    parse_decimal(row[12] if len(row) > 12 else None),
                    parse_decimal(row[13] if len(row) > 13 else None),
                    parse_decimal(row[14] if len(row) > 14 else None),
                    remark,
                ),
            )
            imported += 1

        cur.execute(
            """
            UPDATE import_batches
            SET status = 'imported', imported_at = CURRENT_TIMESTAMP, note = %s
            WHERE id = %s
            """,
            (f"Imported {imported} contracts; unknown products: {unknown_products}.", batch_id),
        )
        conn.commit()
        print(f"contract import complete: batch={batch_id}, rows={imported}, unknown_products={unknown_products}")
        return batch_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Import wholesale contract register.")
    parser.add_argument("path", help="Path to contract Excel file.")
    args = parser.parse_args()
    import_contracts(args.path)


if __name__ == "__main__":
    main()
