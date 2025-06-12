from __future__ import annotations

import json
import re
from pathlib import Path

from text_utils import file_sha256, normalize_station_name, normalize_text


def get_or_create_batch(cur, *, source_type, source_path, period_year=None, period_month=None):
    source_path = str(Path(source_path))
    file_hash = file_sha256(source_path)
    original_filename = Path(source_path).name
    cur.execute("SELECT id FROM import_batches WHERE file_hash = %s", (file_hash,))
    existing = cur.fetchone()
    if existing:
        batch_id = existing[0]
        cur.execute(
            """
            UPDATE import_batches
            SET source_type = %s,
                source_path = %s,
                original_filename = %s,
                period_year = %s,
                period_month = %s,
                status = 'created',
                note = NULL
            WHERE id = %s
            """,
            (source_type, source_path, original_filename, period_year, period_month, batch_id),
        )
        return batch_id

    cur.execute(
        """
        INSERT INTO import_batches
            (source_type, source_path, original_filename, file_hash, period_year, period_month)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (source_type, source_path, original_filename, file_hash, period_year, period_month),
    )
    return cur.lastrowid


def reset_batch_rows(cur, batch_id, tables):
    cur.execute("DELETE FROM import_raw_rows WHERE batch_id = %s", (batch_id,))
    if "wholesale_detail_records" in tables:
        cur.execute(
            """
            DELETE cr
            FROM calculation_results cr
            JOIN wholesale_detail_records d ON d.id = cr.detail_id
            WHERE d.batch_id = %s
            """,
            (batch_id,),
        )
        cur.execute(
            """
            DELETE qi
            FROM data_quality_issues qi
            JOIN wholesale_detail_records d ON d.id = qi.related_id
            WHERE d.batch_id = %s
              AND qi.related_table = 'wholesale_detail_records'
            """,
            (batch_id,),
        )
    for table in tables:
        cur.execute(f"DELETE FROM {table} WHERE batch_id = %s", (batch_id,))


def store_raw_row(cur, batch_id, sheet_name, source_row_number, row):
    payload = {}
    for idx, value in enumerate(row):
        if value is None or (isinstance(value, float) and value != value):
            continue
        payload[str(idx)] = str(value)
    cur.execute(
        """
        INSERT INTO import_raw_rows (batch_id, sheet_name, source_row_number, row_payload)
        VALUES (%s, %s, %s, %s)
        """,
        (batch_id, sheet_name, source_row_number, json.dumps(payload, ensure_ascii=False)),
    )


def load_product_lookup(cur):
    cur.execute(
        """
        SELECT p.id, p.product_code, p.display_name, a.normalized_alias
        FROM product_aliases a
        JOIN products p ON p.id = a.product_id
        """
    )
    lookup = {row[3]: {"id": row[0], "code": row[1], "display_name": row[2]} for row in cur.fetchall()}
    cur.execute("SELECT id, product_code, display_name FROM products WHERE is_active = TRUE")
    for product_id, code, display_name in cur.fetchall():
        item = {"id": product_id, "code": code, "display_name": display_name}
        lookup.setdefault(normalize_text(code), item)
        lookup.setdefault(normalize_text(display_name), item)
    return lookup


def _product_by_code(product_lookup):
    products = {}
    for item in product_lookup.values():
        code = item.get("code")
        if code and code not in products:
            products[code] = item
    return products


def _has_octane(text, value):
    return bool(re.search(rf"(^|[^0-9]){value}([^0-9]|$)", text)) or f"AI{value}" in text or f"АИ{value}" in text


def smart_product_code(raw_name):
    text = normalize_text(raw_name)
    compact = re.sub(r"[\s_\-#/\\.()（）]+", "", text)
    if not text:
        return None

    if "МАЗУТ" in text or "MAZUT" in text or "油浆" in text or ("ТОПОЧ" in text and "МАЗ" in text):
        return "MAZUT"
    if "ПЕЧ" in text or "催" in text:
        return "HEATING_FUEL"
    if "ГАЗ" in text or "СПБТ" in text or "СУГ" in text or "LPG" in text or "液化气" in text:
        return "LPG"
    if _has_octane(text, "80"):
        return "AI80"
    if _has_octane(text, "92"):
        return "AI92"
    if _has_octane(text, "95"):
        return "AI95"
    if "K5" in compact or "К5" in compact or "К-5" in text or "K-5" in text or "K515" in compact or "K5-15" in text:
        return "DIESEL_K5"
    if "K3" in compact or "К3" in compact or "К-3" in text or "K-3" in text:
        return "DIESEL_K3"
    if "ДИЗ" in text or "Д/Т" in text or "ДТ" in compact or "DIESEL" in text or "柴油" in text:
        return "DIESEL_K3"
    return None


def lookup_product(product_lookup, raw_name):
    product = product_lookup.get(normalize_text(raw_name))
    if product:
        return product
    product_code = smart_product_code(raw_name)
    if not product_code:
        return None
    return _product_by_code(product_lookup).get(product_code)


def load_entity_lookup(cur):
    cur.execute(
        """
        SELECT entity_type, entity_code, standard_name, normalized_alias
        FROM entity_aliases
        """
    )
    return {
        row[3]: {"entity_type": row[0], "entity_code": row[1], "standard_name": row[2]}
        for row in cur.fetchall()
    }


def lookup_entity(entity_lookup, raw_name):
    normalized = normalize_text(raw_name)
    entity = entity_lookup.get(normalized)
    if entity:
        return entity
    return entity_lookup.get(normalize_station_name(raw_name))


def get_or_create_customer(cur, raw_name, customer_type="unknown"):
    normalized = normalize_text(raw_name)
    cur.execute(
        """
        INSERT INTO customers (standard_name, normalized_name, customer_type)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE
            standard_name = VALUES(standard_name),
            customer_type = IF(customer_type = 'unknown', VALUES(customer_type), customer_type)
        """,
        (raw_name, normalized, customer_type),
    )
    cur.execute("SELECT id FROM customers WHERE normalized_name = %s", (normalized,))
    return cur.fetchone()[0]
