from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path
import sys

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from calculations import recalculate_wholesale_batch
from db import get_connection
from import_helpers import (
    get_or_create_batch,
    get_or_create_customer,
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
    reset_batch_rows,
    store_raw_row,
)
from text_utils import clean_str, normalize_text, parse_date, parse_decimal


SHEET_DETAIL = 6
SHEET_TRANSFER = 1
SHEET_SALES = 2
SHEET_PROCESSING = 3
DETAIL_DATA_START_ROW = 5
SUMMARY_DATA_START_ROW = 4


def find_detail_columns(df):
    required = {
        "date": ("入厂日期", "дата заезда"),
        "product": ("油品名称", "примечание"),
        "vehicle": ("车号", "номер авто"),
        "entity": ("供应商/客户", "получатель"),
        "weight": ("过磅重量", "обьем"),
        "remark": ("备注",),
    }
    for row_idx in range(min(len(df), 15)):
        cells = [normalize_text(clean_str(value)) for value in df.iloc[row_idx].tolist()]
        columns = {}
        for key, aliases in required.items():
            for col_idx, cell in enumerate(cells):
                if any(normalize_text(alias) in cell for alias in aliases):
                    columns[key] = col_idx
                    break
        if all(key in columns for key in ("date", "product", "entity", "weight")):
            if "remark" not in columns and columns["weight"] + 1 < len(cells):
                columns["remark"] = columns["weight"] + 1
            return row_idx + 1, columns
    return DETAIL_DATA_START_ROW, {
        "date": 1,
        "product": 2,
        "vehicle": 3,
        "entity": 4,
        "weight": 5,
        "remark": 6,
    }


def pair_key(entity_name, product_name):
    return normalize_text(entity_name), normalize_text(product_name)


def parse_summary_sheet(path, sheet_index, summary_type):
    xl = pd.ExcelFile(path)
    sheet_name = xl.sheet_names[sheet_index]
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    rows = []
    pairs = set()
    current_entity = None
    for row_idx in range(SUMMARY_DATA_START_ROW, len(df)):
        row = df.iloc[row_idx].tolist()
        entity = clean_str(row[1] if len(row) > 1 else None)
        product = clean_str(row[2] if len(row) > 2 else None)
        weight = parse_decimal(row[3] if len(row) > 3 else None)
        if entity:
            current_entity = entity
        if not current_entity or not product:
            continue
        weight_value = weight if weight is not None else 0
        rows.append(
            {
                "sheet_name": sheet_name,
                "source_row_number": row_idx + 1,
                "entity": current_entity,
                "product": product,
                "weight_kg": weight_value,
                "summary_type": summary_type,
                "raw": row,
            }
        )
        # Empty template entries identify available customers, not actual processing sales.
        if weight_value > 0:
            pairs.add(pair_key(current_entity, product))
    return sheet_name, rows, pairs


def import_summary_rows(cur, batch_id, summary_rows, product_lookup):
    imported = 0
    for item in summary_rows:
        store_raw_row(cur, batch_id, item["sheet_name"], item["source_row_number"], item["raw"])
        product = lookup_product(product_lookup, item["product"])
        cur.execute(
            """
            INSERT INTO wholesale_summary_records
                (batch_id, summary_type, sheet_name, source_row_number, raw_entity_name,
                 raw_product_name, product_id, weight_kg)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                batch_id,
                item["summary_type"],
                item["sheet_name"],
                item["source_row_number"],
                item["entity"],
                item["product"],
                product["id"] if product else None,
                item["weight_kg"],
            ),
        )
        imported += 1
    return imported


def classify_detail(entity_name, product_name, entity, sales_pairs, transfer_pairs, processing_pairs):
    if entity and entity.get("entity_type") in ("retail_station", "own_depot"):
        return "transfer"
    key = pair_key(entity_name, product_name)
    if key in transfer_pairs:
        return "transfer"
    if key in processing_pairs:
        return "processing"
    if key in sales_pairs:
        return "unknown"
    return "other"


def import_detail_rows(cur, batch_id, path, product_lookup, entity_lookup, sales_pairs, transfer_pairs, processing_pairs):
    xl = pd.ExcelFile(path)
    sheet_name = xl.sheet_names[SHEET_DETAIL]
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    data_start_row, columns = find_detail_columns(df)
    imported = 0
    unknown_products = 0
    unknown_entities = 0
    dates = []

    for row_idx in range(data_start_row, len(df)):
        row = df.iloc[row_idx].tolist()
        store_raw_row(cur, batch_id, sheet_name, row_idx + 1, row)

        def detail_value(key):
            col_idx = columns.get(key)
            return row[col_idx] if col_idx is not None and len(row) > col_idx else None

        business_date = parse_date(detail_value("date"))
        raw_product = clean_str(detail_value("product"))
        raw_entity = clean_str(detail_value("entity"))
        weight_kg = parse_decimal(detail_value("weight"))
        if not business_date or not raw_product or not raw_entity or weight_kg is None:
            continue

        dates.append(business_date)
        product = lookup_product(product_lookup, raw_product)
        entity = lookup_entity(entity_lookup, raw_entity)
        classification = classify_detail(raw_entity, raw_product, entity, sales_pairs, transfer_pairs, processing_pairs)
        match_status = "matched" if classification in ("transfer", "processing", "other") else "unmatched"

        if not product:
            unknown_products += 1
            cur.execute(
                """
                INSERT INTO data_quality_issues
                    (issue_type, severity, related_table, issue_date, message)
                VALUES ('unknown_product', 'warning', 'wholesale_detail_records', %s, %s)
                """,
                (business_date, f"Detail product is not mapped: {raw_product}"),
            )
        if not entity and classification == "transfer":
            unknown_entities += 1
            cur.execute(
                """
                INSERT INTO data_quality_issues
                    (issue_type, severity, related_table, issue_date, message)
                VALUES ('unknown_entity', 'warning', 'wholesale_detail_records', %s, %s)
                """,
                (business_date, f"Transfer target is not mapped: {raw_entity}"),
            )

        if classification in ("unknown", "other"):
            get_or_create_customer(cur, raw_entity)

        cur.execute(
            """
            INSERT INTO wholesale_detail_records
                (batch_id, source_row_number, business_date, raw_product_name, product_id,
                 vehicle_no, raw_entity_name, entity_type, entity_code, standard_entity_name,
                 classification, weight_kg, remark, match_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                batch_id,
                row_idx + 1,
                business_date,
                raw_product,
                product["id"] if product else None,
                clean_str(detail_value("vehicle")),
                raw_entity,
                entity["entity_type"] if entity else "unknown",
                entity["entity_code"] if entity else None,
                entity["standard_name"] if entity else None,
                classification,
                weight_kg,
                clean_str(detail_value("remark")),
                match_status,
            ),
        )
        imported += 1

    return {
        "imported": imported,
        "unknown_products": unknown_products,
        "unknown_entities": unknown_entities,
        "dates": dates,
    }


def import_wholesale(path):
    conn = get_connection()
    try:
        cur = conn.cursor()
        batch_id = get_or_create_batch(
            cur,
            source_type="export_sales_excel",
            source_path=path,
        )
        reset_batch_rows(
            cur,
            batch_id,
            ["wholesale_summary_records", "wholesale_detail_records"],
        )
        product_lookup = load_product_lookup(cur)
        entity_lookup = load_entity_lookup(cur)

        _, sales_rows, sales_pairs = parse_summary_sheet(path, SHEET_SALES, "sales")
        _, transfer_rows, transfer_pairs = parse_summary_sheet(path, SHEET_TRANSFER, "transfer")
        _, processing_rows, processing_pairs = parse_summary_sheet(path, SHEET_PROCESSING, "processing")

        summary_count = 0
        summary_count += import_summary_rows(cur, batch_id, sales_rows, product_lookup)
        summary_count += import_summary_rows(cur, batch_id, transfer_rows, product_lookup)
        summary_count += import_summary_rows(cur, batch_id, processing_rows, product_lookup)

        detail_result = import_detail_rows(
            cur,
            batch_id,
            path,
            product_lookup,
            entity_lookup,
            sales_pairs,
            transfer_pairs,
            processing_pairs,
        )
        if detail_result["imported"] == 0:
            raise ValueError("明细表未识别到可导入记录，请检查明细表的日期、油品、供应商/客户和过磅重量列。")

        calc_result = recalculate_wholesale_batch(cur, batch_id)
        period_year = period_month = None
        if detail_result["dates"]:
            first_date = min(detail_result["dates"])
            period_year = first_date.year
            period_month = first_date.month

        cur.execute(
            """
            UPDATE import_batches
            SET period_year = %s,
                period_month = %s,
                status = 'imported',
                imported_at = CURRENT_TIMESTAMP,
                note = %s
            WHERE id = %s
            """,
            (
                period_year,
                period_month,
                (
                    f"Imported {detail_result['imported']} detail rows and {summary_count} summary rows. "
                    f"Contract matches: {calc_result['matched']}; needs review: {calc_result['unmatched']}. "
                    f"Unknown products: {detail_result['unknown_products']}; "
                    f"unknown transfer targets: {detail_result['unknown_entities']}."
                ),
                batch_id,
            ),
        )
        conn.commit()
        print(
            "wholesale import complete: "
            f"batch={batch_id}, detail_rows={detail_result['imported']}, "
            f"summary_rows={summary_count}, matched_contracts={calc_result['matched']}, "
            f"needs_review={calc_result['unmatched']}"
        )
        return batch_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Import monthly wholesale external sales and transfer Excel.")
    parser.add_argument("path", help="Path to export/transfer Excel file.")
    args = parser.parse_args()
    import_wholesale(args.path)


if __name__ == "__main__":
    main()
