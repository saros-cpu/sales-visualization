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
    classify_wholesale_movement,
    delete_duplicate_wholesale_detail_rows,
    dedup_wholesale_detail_cross_batch,
    detect_transport_mode,
    detail_transport_mode,
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


def find_detail_columns(df, is_procurement=False):
    sender_aliases = ("发货单位", "发货公司", "发货方", "油品所属公司", "所属公司", "отправитель", "поставщик")
    if is_procurement:
        sender_aliases = sender_aliases + ("供应商/客户", "供应商", "客户", "收货单位", "收货方", "получатель", "покупатель", "клиент", "单位名称", "单位名称(ОТПРАВИТЕЛЬ)")
    required = {
        "date": ("入厂日期", "进厂日期", "日期", "дата заезда", "заезда", "进站时间", "出站时间"),
        "product": ("油品名称", "油品", "品名", "примечание", "продукт", "нефтепродукт", "名称"),
        "vehicle": ("车号", "车牌", "车牌号", "номер авто", "гос номер", "госномер", "авто"),
        "weight": ("过磅重量", "过磅重", "重量", "净重", "обьем", "объем", "масса", "вес"),
        "remark": ("备注",),
        "serial": ("磅单号", "过磅单号", "单号", "编号", "номер"),
        "sender": sender_aliases,
    }
    if not is_procurement:
        required["entity"] = ("供应商/客户", "供应商", "客户", "收货单位", "收货方", "получатель", "покупатель", "клиент")
    required_keys = ("date", "product", "weight") if is_procurement else ("date", "product", "entity", "weight")
    for row_idx in range(min(len(df), 15)):
        cells = [normalize_text(clean_str(value)) for value in df.iloc[row_idx].tolist()]
        columns = {}
        for key, aliases in required.items():
            for col_idx, cell in enumerate(cells):
                if any(normalize_text(alias) in cell for alias in aliases):
                    columns[key] = col_idx
                    break
        if all(key in columns for key in required_keys):
            if "sender" not in columns:
                for header_idx in range(row_idx):
                    header_cells = [normalize_text(clean_str(value)) for value in df.iloc[header_idx].tolist()]
                    for col_idx, cell in enumerate(header_cells):
                        if any(normalize_text(alias) in cell for alias in sender_aliases):
                            columns["sender"] = col_idx
                            break
                    if "sender" in columns:
                        break
            # Prefer exit time (出站时间) as business date when both entry/exit times exist
            for col_idx, cell in enumerate(cells):
                if "出站时间" in cell:
                    columns["date"] = col_idx
                    break
            # Prefer net weight (净重) over waybill weight when present
            for col_idx, cell in enumerate(cells):
                if "净重" in cell:
                    columns["weight"] = col_idx
                    break
            if "remark" not in columns and columns["weight"] + 1 < len(cells):
                columns["remark"] = columns["weight"] + 1
            return row_idx + 1, columns
    fallback = {
        "date": 1,
        "product": 2,
        "vehicle": 3,
        "weight": 5,
        "remark": 6,
    }
    if not is_procurement:
        fallback["entity"] = 4
    return DETAIL_DATA_START_ROW, fallback


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


def classify_detail(cur, entity_lookup, entity_name, product_name, sender_name, sales_pairs, transfer_pairs, processing_pairs):
    _ = (transfer_pairs, processing_pairs)
    key = pair_key(entity_name, product_name)
    fallback = "unknown" if key in sales_pairs else None
    return classify_wholesale_movement(cur, entity_lookup, entity_name, sender_name, fallback)


def import_detail_rows(cur, batch_id, path, product_lookup, entity_lookup, sales_pairs, transfer_pairs, processing_pairs, is_procurement=False):
    xl = pd.ExcelFile(path)
    sheet_name = xl.sheet_names[SHEET_DETAIL]
    df = pd.read_excel(path, sheet_name=sheet_name, header=None)
    data_start_row, columns = find_detail_columns(df, is_procurement=is_procurement)
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
        weigh_serial_no = clean_str(detail_value("serial"))
        sender_name = clean_str(detail_value("sender"))
        raw_entity = clean_str(detail_value("entity"))
        weight_kg = parse_decimal(detail_value("weight"))
        if is_procurement and not raw_entity:
            raw_entity = "Example"
        if not business_date or not raw_product or not raw_entity or weight_kg is None:
            continue

        vehicle_no = clean_str(detail_value("vehicle"))
        remark = clean_str(detail_value("remark"))
        dates.append(business_date)
        product = lookup_product(product_lookup, raw_product)
        entity = lookup_entity(entity_lookup, raw_entity)
        classification = classify_detail(cur, entity_lookup, raw_entity, raw_product, sender_name, sales_pairs, transfer_pairs, processing_pairs)
        transport_mode = detail_transport_mode(classification, vehicle_no, weigh_serial_no, remark)
        match_status = "matched" if classification in ("transfer", "processing", "procurement", "other") else "unmatched"

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

        if classification == "unknown":
            get_or_create_customer(cur, raw_entity)

        cur.execute(
            """
            INSERT INTO wholesale_detail_records
                (batch_id, source_row_number, business_date, raw_product_name, product_id,
                 vehicle_no, weigh_serial_no, raw_entity_name, sender_name, entity_type, entity_code,
                 standard_entity_name, classification, weight_kg, remark, match_status, transport_mode)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                batch_id,
                row_idx + 1,
                business_date,
                raw_product,
                product["id"] if product else None,
                vehicle_no,
                weigh_serial_no,
                raw_entity,
                sender_name,
                entity["entity_type"] if entity else "unknown",
                entity["entity_code"] if entity else None,
                entity["standard_name"] if entity else None,
                classification,
                weight_kg,
                remark,
                match_status,
                transport_mode,
            ),
        )
        imported += 1

    return {
        "imported": imported,
        "unknown_products": unknown_products,
        "unknown_entities": unknown_entities,
        "dates": dates,
    }


def import_wholesale_procurement(path):
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
            ["wholesale_detail_records"],
        )
        product_lookup = load_product_lookup(cur)
        entity_lookup = load_entity_lookup(cur)
        xl = pd.ExcelFile(path)

        total_imported = 0
        total_unknown_products = 0
        total_unknown_entities = 0
        all_dates = []

        for sheet_name in xl.sheet_names:
            if sheet_name.strip() == "汇总":
                continue
            if "火车 (2)" in sheet_name:
                continue
            df = pd.read_excel(path, sheet_name=sheet_name, header=None)
            data_start_row, columns = find_detail_columns(df, is_procurement=True)
            has_required = "date" in columns and "product" in columns and "weight" in columns
            if not has_required:
                continue

            imported = 0
            for row_idx in range(data_start_row, len(df)):
                row = df.iloc[row_idx].tolist()
                store_raw_row(cur, batch_id, sheet_name, row_idx + 1, row)

                def detail_value(key):
                    col_idx = columns.get(key)
                    return row[col_idx] if col_idx is not None and len(row) > col_idx else None

                business_date = parse_date(detail_value("date"))
                raw_product = clean_str(detail_value("product"))
                weigh_serial_no = clean_str(detail_value("serial"))
                sender_name = clean_str(detail_value("sender"))
                raw_entity = clean_str(detail_value("entity"))
                weight_kg = parse_decimal(detail_value("weight"))
                if not raw_entity:
                    raw_entity = "Example"
                if not business_date or not raw_product or not raw_entity or weight_kg is None:
                    continue

                vehicle_no = clean_str(detail_value("vehicle"))
                remark = clean_str(detail_value("remark"))
                all_dates.append(business_date)
                product = lookup_product(product_lookup, raw_product)
                entity = lookup_entity(entity_lookup, raw_entity)
                classification = classify_detail(
                    cur, entity_lookup, raw_entity, raw_product, sender_name,
                    set(), set(), set(),
                )
                transport_mode = detail_transport_mode(classification, vehicle_no, weigh_serial_no, remark, sheet_name=sheet_name)
                match_status = "matched" if classification in ("transfer", "processing", "procurement", "other") else "unmatched"

                if not product:
                    total_unknown_products += 1
                    cur.execute(
                        """
                        INSERT INTO data_quality_issues
                            (issue_type, severity, related_table, issue_date, message)
                        VALUES ('unknown_product', 'warning', 'wholesale_detail_records', %s, %s)
                        """,
                        (business_date, f"Detail product is not mapped: {raw_product}"),
                    )
                if classification == "unknown":
                    get_or_create_customer(cur, raw_entity)

                cur.execute(
                    """
                    INSERT INTO wholesale_detail_records
                        (batch_id, source_row_number, business_date, raw_product_name, product_id,
                         vehicle_no, weigh_serial_no, raw_entity_name, sender_name, entity_type, entity_code,
                         standard_entity_name, classification, weight_kg, remark, match_status, transport_mode)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        batch_id,
                        row_idx + 1,
                        business_date,
                        raw_product,
                        product["id"] if product else None,
                        vehicle_no,
                        weigh_serial_no,
                        raw_entity,
                        sender_name,
                        entity["entity_type"] if entity else "unknown",
                        entity["entity_code"] if entity else None,
                        entity["standard_name"] if entity else None,
                        classification,
                        weight_kg,
                        remark,
                        match_status,
                        transport_mode,
                    ),
                )
                imported += 1

            total_imported += imported
            if imported > 0:
                print(f"  sheet '{sheet_name}': {imported} rows imported")

        if total_imported == 0:
            raise ValueError("采购文件未识别到可导入记录，请检查明细表的日期、油品和过磅重量列。")

        duplicate_result = delete_duplicate_wholesale_detail_rows(cur, batch_id)
        cross_dup_result = dedup_wholesale_detail_cross_batch(cur, batch_id)
        kept_detail_rows = (
            total_imported - duplicate_result["deleted"] - cross_dup_result["deleted"]
        )
        period_year = period_month = None
        if all_dates:
            first_date = min(all_dates)
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
                    f"Procurement import: {kept_detail_rows} detail rows. "
                    f"Duplicate detail rows removed: {duplicate_result['deleted']}. "
                    f"Cross-batch duplicate rows removed: {cross_dup_result['deleted']}. "
                    f"Unknown products: {total_unknown_products}."
                ),
                batch_id,
            ),
        )
        conn.commit()
        print(
            "wholesale procurement import complete: "
            f"batch={batch_id}, detail_rows={total_imported}, "
            f"kept={kept_detail_rows}"
        )
        return batch_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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
        duplicate_result = delete_duplicate_wholesale_detail_rows(cur, batch_id)
        cross_dup_result = dedup_wholesale_detail_cross_batch(cur, batch_id)
        kept_detail_rows = (
            detail_result["imported"] - duplicate_result["deleted"] - cross_dup_result["deleted"]
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
                    f"Imported {kept_detail_rows} detail rows and {summary_count} summary rows. "
                    f"Duplicate detail rows removed: {duplicate_result['deleted']}. "
                    f"Cross-batch duplicate rows removed: {cross_dup_result['deleted']}. "
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


def import_wholesale_single_sheet(path, skip_recalc=False):
    """导入单表批发明细。

    skip_recalc=True 时跳过 recalculate_wholesale_batch。
    该开关用于「同一来源文件重传去重」场景：classification 必须保持导入时
    按文件来源权威盖章的结果，而 recalculate_wholesale_batch 会按收发方实体
    类型重新推导并覆写 classification（Sales/calculations.py:120），
    违反 AGENTS.md「报表入库后禁止跑 recalculate_wholesale_batch」的禁令。
    默认关闭，历史调用行为不变。
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        batch_id = get_or_create_batch(
            cur,
            source_type="export_sales_excel",
            source_path=path,
        )
        reset_batch_rows(cur, batch_id, ["wholesale_detail_records"])
        product_lookup = load_product_lookup(cur)
        entity_lookup = load_entity_lookup(cur)

        xl = pd.ExcelFile(path)
        sheet_name = xl.sheet_names[0]
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
            weigh_serial_no = clean_str(detail_value("serial"))
            sender_name = clean_str(detail_value("sender"))
            raw_entity = clean_str(detail_value("entity"))
            weight_kg = parse_decimal(detail_value("weight"))
            if not business_date or not raw_product or not raw_entity or weight_kg is None:
                continue

            vehicle_no = clean_str(detail_value("vehicle"))
            remark = clean_str(detail_value("remark"))
            dates.append(business_date)
            product = lookup_product(product_lookup, raw_product)
            entity = lookup_entity(entity_lookup, raw_entity)
            classification = classify_detail(cur, entity_lookup, raw_entity, raw_product, sender_name, set(), set(), set())
            transport_mode = detail_transport_mode(classification, vehicle_no, weigh_serial_no, remark)
            match_status = "matched" if classification in ("transfer", "processing", "procurement", "other") else "unmatched"

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

            if classification == "unknown":
                get_or_create_customer(cur, raw_entity)

            cur.execute(
                """
                INSERT INTO wholesale_detail_records
                    (batch_id, source_row_number, business_date, raw_product_name, product_id,
                     vehicle_no, weigh_serial_no, raw_entity_name, sender_name, entity_type, entity_code,
                     standard_entity_name, classification, weight_kg, remark, match_status, transport_mode)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    batch_id,
                    row_idx + 1,
                    business_date,
                    raw_product,
                    product["id"] if product else None,
                    vehicle_no,
                    weigh_serial_no,
                    raw_entity,
                    sender_name,
                    entity["entity_type"] if entity else "unknown",
                    entity["entity_code"] if entity else None,
                    entity["standard_name"] if entity else None,
                    classification,
                    weight_kg,
                    remark,
                    match_status,
                    transport_mode,
                ),
            )
            imported += 1

        if imported == 0:
            raise ValueError("未识别到可导入的批发明细记录，请检查单表的日期、油品、供应商/客户和过磅重量列。")

        duplicate_result = delete_duplicate_wholesale_detail_rows(cur, batch_id)
        cross_dup_result = dedup_wholesale_detail_cross_batch(cur, batch_id)
        kept_imported = imported - duplicate_result["deleted"] - cross_dup_result["deleted"]
        if skip_recalc:
            calc_result = {"matched": 0, "unmatched": 0, "missing_rates": 0}
        else:
            calc_result = recalculate_wholesale_batch(cur, batch_id)
        period_year = period_month = None
        if dates:
            first_date = min(dates)
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
                    f"Imported {kept_imported} wholesale detail rows from single sheet. "
                    f"Duplicate detail rows removed: {duplicate_result['deleted']}. "
                    f"Cross-batch duplicate rows removed: {cross_dup_result['deleted']}. "
                    f"Contract matches: {calc_result['matched']}; needs review: {calc_result['unmatched']}. "
                    f"Unknown products: {unknown_products}; "
                    f"unknown transfer targets: {unknown_entities}."
                    + (" Contract recalculation skipped (classification preserved from import)."
                       if skip_recalc else "")
                ),
                batch_id,
            ),
        )
        conn.commit()
        print(
            "wholesale single-sheet import complete: "
            f"batch={batch_id}, detail_rows={kept_imported}, duplicates_removed={duplicate_result['deleted']}, "
            f"matched_contracts={calc_result['matched']}, "
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
    xl = pd.ExcelFile(args.path)
    if "明细表" in xl.sheet_names:
        if len(xl.sheet_names) >= 7:
            import_wholesale(args.path)
        else:
            import_wholesale_single_sheet(args.path)
    else:
        import_wholesale_procurement(args.path)


if __name__ == "__main__":
    main()
