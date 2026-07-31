from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from text_utils import clean_str, file_sha256, normalize_station_name, normalize_text


def _lpg_remark_time(value):
    text = clean_str(value)
    if not text:
        return ""
    if "T" in text:
        text = text.rsplit("T", 1)[-1]
    return text[:8]


def _lpg_operation_parts(value):
    operation = re.sub(r"\s+", " ", clean_str(value) or "").strip()
    if not operation:
        return []
    upper_operation = operation.upper()
    for marker, label in (("ПРИЕМ", "卸车/收货"), ("ОТПРАВКА", "装车/发货")):
        index = upper_operation.find(marker)
        if index >= 0:
            tail = f"{operation[:index]} {operation[index + len(marker):]}".strip(" -:|")
            parts = [label]
            if tail:
                parts.append(re.sub(r"\s+", " ", tail).strip())
            return parts
    return [operation]


def format_lpg_remark(value):
    """Format qchr JSON remarks for human-facing weighing screens."""
    text = clean_str(value)
    if not text:
        return ""
    try:
        payload = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return " | ".join(_lpg_operation_parts(text))
    if not isinstance(payload, dict):
        return " | ".join(_lpg_operation_parts(text))

    parts = _lpg_operation_parts(payload.get("operation"))
    spec_or_trailer = re.sub(r"\s+", " ", clean_str(payload.get("spec_or_trailer")) or "").strip()
    if spec_or_trailer:
        parts.append(f"挂车/规格 {spec_or_trailer}")
    gross_time = _lpg_remark_time(payload.get("gross_time"))
    if gross_time:
        parts.append(f"毛重 {gross_time}")
    tare_time = _lpg_remark_time(payload.get("tare_time"))
    if tare_time:
        parts.append(f"皮重 {tare_time}")
    operator = clean_str(payload.get("operator"))
    tare_operator = clean_str(payload.get("tare_operator"))
    operators = "/".join(item for item in (operator, tare_operator) if item)
    if operators:
        parts.append(f"司磅 {operators}")
    return " | ".join(parts) or text


def format_lpg_tank_remark(value):
    """Return only the large-tank code from qchr remarks for compact audit tables."""
    text = clean_str(value)
    if not text:
        return ""
    try:
        payload = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        targets = [text]
    else:
        if isinstance(payload, dict):
            targets = [
                clean_str(payload.get("operation")),
                clean_str(payload.get("spec_or_trailer")),
                text,
            ]
        else:
            targets = [text]
    for target in targets:
        match = re.search(r"\bP\d{3,6}\b", target or "", flags=re.IGNORECASE)
        if match:
            return match.group(0).upper()
    return ""


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
                period_year = %s,
                period_month = %s,
                status = 'created',
                note = NULL
            WHERE id = %s
            """,
            (source_type, source_path, period_year, period_month, batch_id),
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


def _wholesale_detail_duplicate_key(row):
    business_date = _first_row_value(row, "business_date", 3)
    source_row_number = _first_row_value(row, "source_row_number", 2)
    raw_product_name = _first_row_value(row, "raw_product_name", 4)
    standard_entity_name = _first_row_value(row, "standard_entity_name", 5)
    raw_entity_name = _first_row_value(row, "raw_entity_name", 6)
    vehicle_no = _first_row_value(row, "vehicle_no", 7)
    weigh_serial_no = _first_row_value(row, "weigh_serial_no", 9)
    weight_kg = _first_row_value(row, "weight_kg", 8)
    # 同一来源文件重传时，raw_entity_name（原始单元格文本）高度一致，
    # 而 standard_entity_name 在不同导入批次间的归一化可能不一致（如
    # “АЗС S-06” 一次被归一为 “ИП CUSTOMER-W”、另一次为 “S-06”）。
    # 因此优先用 raw_entity_name 作为公司去重依据，standard 作为兜底。
    company_name = raw_entity_name or standard_entity_name
    if not company_name or weight_kg is None:
        return None
    # 身份标识优先级：磅单号 > 车号 > 行号（行号仅同文件内有意义，跨批次不参与）
    if weigh_serial_no and normalize_text(weigh_serial_no):
        identity = "SERIAL:" + normalize_text(weigh_serial_no)
    elif vehicle_no and normalize_text(vehicle_no):
        identity = "VEH:" + normalize_text(vehicle_no)
    else:
        identity = "ROW:" + str(source_row_number)
    return (
        str(business_date),
        normalize_text(raw_product_name),
        normalize_text(company_name),
        identity,
        str(weight_kg),
    )


def delete_duplicate_wholesale_detail_rows(cur, batch_id=None):
    cur.execute(
        """
        SELECT id, batch_id, source_row_number, business_date, raw_product_name,
               standard_entity_name, raw_entity_name, vehicle_no, weight_kg, weigh_serial_no
        FROM wholesale_detail_records
        WHERE batch_id IS NOT NULL
        ORDER BY batch_id, source_row_number, id
        """
    )
    rows = cur.fetchall()
    seen = set()
    delete_ids = []
    deleted_by_batch = Counter()
    for row in rows:
        detail_id = _first_row_value(row, "id", 0)
        row_batch_id = _first_row_value(row, "batch_id", 1)
        key = _wholesale_detail_duplicate_key(row)
        if not key:
            continue
        if key not in seen:
            seen.add(key)
            continue
        if batch_id is not None and row_batch_id != batch_id:
            continue
        delete_ids.append(detail_id)
        deleted_by_batch[str(row_batch_id)] += 1

    for offset in range(0, len(delete_ids), 500):
        chunk = delete_ids[offset : offset + 500]
        placeholders = ", ".join(["%s"] * len(chunk))
        cur.execute(f"DELETE FROM calculation_results WHERE detail_id IN ({placeholders})", chunk)
        cur.execute(
            f"""
            DELETE FROM data_quality_issues
            WHERE related_table = 'wholesale_detail_records'
              AND related_id IN ({placeholders})
            """,
            chunk,
        )
        cur.execute(f"DELETE FROM wholesale_detail_records WHERE id IN ({placeholders})", chunk)

    return {
        "scanned": len(rows),
        "deleted": len(delete_ids),
        "deletedByBatch": dict(deleted_by_batch),
    }


def dedup_wholesale_detail_cross_batch(cur, batch_id):
    """删除新上传批次中与「更早批次」重复的行，保留更早的那一份。

    自然键：(业务日期, 油品, 公司名称, 身份标识[磅单号>车号>行号], 重量)。
    只删除 batch_id 这一「新上传批次」内部的行；其它批次（含手工录入）绝不被删除，
    因此手工录入数据不受影响。用于防止换文件重传整月报表时把同期数据双算。
    """
    cur.execute(
        "SELECT DISTINCT business_date FROM wholesale_detail_records WHERE batch_id = %s",
        (batch_id,),
    )
    dates = [r[0] for r in cur.fetchall()]
    if not dates:
        return {"scanned": 0, "deleted": 0}

    date_placeholders = ", ".join(["%s"] * len(dates))
    # 收集更早批次（同业务日期）已有的自然键，保留最早出现的一份
    cur.execute(
        f"""
        SELECT id, batch_id, source_row_number, business_date, raw_product_name,
               standard_entity_name, raw_entity_name, vehicle_no, weight_kg, weigh_serial_no
        FROM wholesale_detail_records
        WHERE batch_id IS NOT NULL AND batch_id <> %s
          AND business_date IN ({date_placeholders})
        ORDER BY batch_id, source_row_number, id
        """,
        (batch_id, *dates),
    )
    existing_keys = {}
    for row in cur.fetchall():
        key = _wholesale_detail_duplicate_key(row)
        if key and key not in existing_keys:
            existing_keys[key] = row[0]

    # 扫描新批次，凡是自然键已在更早批次出现 -> 视为重复，删除新批次这一份
    cur.execute(
        """
        SELECT id, batch_id, source_row_number, business_date, raw_product_name,
               standard_entity_name, raw_entity_name, vehicle_no, weight_kg, weigh_serial_no
        FROM wholesale_detail_records
        WHERE batch_id = %s
        """,
        (batch_id,),
    )
    delete_ids = []
    scanned = 0
    for row in cur.fetchall():
        scanned += 1
        key = _wholesale_detail_duplicate_key(row)
        if key and key in existing_keys:
            delete_ids.append(row[0])

    for offset in range(0, len(delete_ids), 500):
        chunk = delete_ids[offset : offset + 500]
        placeholders = ", ".join(["%s"] * len(chunk))
        cur.execute(f"DELETE FROM calculation_results WHERE detail_id IN ({placeholders})", chunk)
        cur.execute(
            f"""
            DELETE FROM data_quality_issues
            WHERE related_table = 'wholesale_detail_records'
              AND related_id IN ({placeholders})
            """,
            chunk,
        )
        cur.execute(f"DELETE FROM wholesale_detail_records WHERE id IN ({placeholders})", chunk)

    return {"scanned": scanned, "deleted": len(delete_ids)}


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

    if "ГАЗОЙЛ" in text or "GAZOIL" in text or "GASOIL" in text or "VACUUM" in text or "ВАКУМ" in text or "ВАКУУМ" in text or "蜡油" in text:
        return "VGO"

    if "НЕФТ" in text or "СЫРОЙ" in text or "BITUM" in text or "原油" in text or "混合油" in text:
        return "CRUDE_OIL"

    if "ПРЯМОГОН" in text or "НАФТА" in text or "直馏汽油" in text:
        return "STRAIGHT_RUN_GASOLINE"
    if ("ЛЕГК" in text and "БЕНЗИН" in text) or "轻质汽油" in text:
        return "LIGHT_GASOLINE"
    if ("КАТАЛИЧЕСКОГО КРЕКИНГА" in text and "БЕНЗИН" in text) or "催化汽油" in text:
        return "CATALYTIC_GASOLINE"
    if "АРОМАТИЧЕСКИХ УГЛЕВОДОРОД" in text or "芳烃油" in text:
        return "AROMATIC_OIL"
    if "АНТИДЕТОНАТОР" in text or "抗爆剂" in text:
        return "ANTIKNOCK_AGENT"

    if "МАЗУТ" in text or "MAZUT" in text or "油浆" in text or ("ТОПОЧ" in text and "МАЗ" in text):
        return "MAZUT"
    if "ММА" in text or "MMA" in text:
        return "MMA"
    if "MTBE" in text:
        return "MTBE"
    if "METANOL" in text or "МЕТАНОЛ" in text:
        return "METHANOL"
    if "污油" in text:
        return "WASTE_OIL"
    if "渣油" in text:
        return "RESIDUAL_OIL"
    if "НЕФРАС" in text:
        return "NEFRAS_C50_170"
    if "外购火车原材料" in text:
        return "RAIL_RAW_MATERIAL"
    if "СЕРНАЯ КИСЛОТА" in text:
        return "SULFURIC_ACID"
    if "ЧЕРНЫЙ МЕТАЛЛ" in text:
        return "SCRAP_METAL"
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
    lookup = {}
    for row in cur.fetchall():
        norm = (row[3] or "").strip()
        if not norm:
            # 跳过空别名：entity_aliases 中存在 normalized_alias='' 的脏数据
            # (映射到 X-43)，空串不应作为合法别名参与匹配。
            continue
        entry = {"entity_type": row[0], "entity_code": row[1], "standard_name": row[2]}
        existing = lookup.get(norm)
        # 同名别名冲突时，优先采用更完整的 standard_name
        # (如 Example公司完整双语名 胜过 own_depot 的短名'Example')。
        if existing is None or len(entry["standard_name"] or "") > len(existing["standard_name"] or ""):
            lookup[norm] = entry
    return lookup


def lookup_entity(entity_lookup, raw_name):
    normalized = normalize_text(raw_name)
    station_normalized = normalize_station_name(raw_name)
    entity = entity_lookup.get(normalized)
    if entity:
        return entity
    entity = entity_lookup.get(station_normalized)
    if entity:
        return entity
    if not any(marker in normalized for marker in ("АЗС", "AЗС", "AZS", "ЗАПРАВ", "加油站", "STATION")):
        return None
    matches = []
    seen = set()
    for alias, candidate in entity_lookup.items():
        if candidate.get("entity_type") != "retail_station":
            continue
        names = {alias, normalize_text(candidate.get("standard_name"))}
        for name in names:
            if not name or len(name) < 4 or name in seen:
                continue
            seen.add(name)
            if name in normalized or name in station_normalized:
                matches.append((len(name), candidate))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


_SALES_CUSTOMER_TYPES = ("export_wholesale", "local_wholesale")
INTERNAL_USE_ENTITY_CODE = "internal_use"
_CUSTOMER_LEGAL_WORDS_RE = re.compile(r"\b(?:CJSC|ООО|ЗАО|ОАО|НПЗ|ТОО|ИП|ЧП)\b", re.IGNORECASE)
_LATIN_CUSTOMER_LEGAL_WORDS_RE = re.compile(
    r"\b(?:OCOO|OSOO|OC?OO|OAO|ZAO|OJSC|CJSC|IP|CHP|LLC|LTD|CO|COMPANY|CORP|INC)\b",
    re.IGNORECASE,
)
_NAME_MATCH_COMPACT_RE = re.compile(r"[\s\"'«»“”._\-/\\]+")
_CYRILLIC_CUSTOMER_LEGAL_PREFIXES_COMPACT = ("CJSC", "ООО", "ЗАО", "ОАО", "НПЗ", "ТОО", "ИП", "ЧП")
_LATIN_CUSTOMER_LEGAL_PREFIXES_COMPACT = ("OCOO", "OSOO", "OOO", "OAO", "ZAO", "OJSC", "CJSC", "LLC", "LTD")
_LATIN_CUSTOMER_LEGAL_SUFFIXES_COMPACT = ("CO", "COMPANY", "CORP", "INC", "LTD", "LLC")
_INTERNAL_SUBSTRING_KEYWORDS = (
    "example",
    "ExampleLatin",
    "ExamplePetrol",
    "GLAVNY SKLAD",
    "NEFTBAZA",
    "Example",
    "油气公司",
    "ExampleCo",
    "ExampleCo ПЕТРОЛ",
    "CUSTOMER-S ПРОМЫШЛЕННАЯ",
    "НЕФТЬ И ГАЗ",
    "ГЛАВНЫЙ СКЛАД",
    "DemoDepot",
)
_INTERNAL_EXACT_KEYWORDS = (
    "CUSTOMER-S-LAT",
    "CUSTOMER-S-АББР",
    "CTY-30",
    "CTY-05",
    "CTY-22-LAT",
    "CTY-22-АЛЬТ",
)
TRAIN_TRANSPORT_MARKERS = (
    "火车",
    "铁路",
    "铁运",
    "TRAIN",
    "RAIL",
    "RAILWAY",
    "ВАГОН",
    "ЖЕЛЕЗНОДОРОЖ",
)
TRAIN_TRANSPORT_COMPACT_MARKERS = ("ЖД",)

_SENDER_STANDARD_ALIASES = (
    (
        "Example",
        (
            "Example",
            "Example石油",
            "Example石油公司",
            "ExampleCo",
            "ExampleCo Petroleum Company ExampleCo",
            "ExampleCo Petroleum Companyя ExampleCo",
            "Example Petroleum CJSC",
            "CJSC ExampleCo Petroleum Companyя ExampleCo",
            "example",
            "example COMPANY",
            "ExampleLatin",
            "ExamplePetrol",
            "ExamplePetrol Company ExampleLatin",
        ),
    ),
    (
        "油气公司",
        (
            "油气公司",
            "CUSTOMER-S-АББР",
            "CUSTOMER-S нефть и газ",
            "CJSC CUSTOMER-S нефть и газ",
            "Нефть и газ",
            "CUSTOMER-S-LAT",
            "Regional Petroleum Company",
            "Oil Gas",
        ),
    ),
    ("CUSTOMER-H", ("CUSTOMER-H", "CUSTOMER-H-3", "CUSTOMER-H 3", "CUSTOMER-H-3", "CUSTOMER-H-LAT")),
    (
        'OcOO "CUSTOMER-F"',
        (
            'OcOO "CUSTOMER-F"',
            "CUSTOMER-F",
            "CUSTOMER-F PETROLAT",
        ),
    ),
    (
        'CJSC "CUSTOMER-E ГРУПП"',
        (
            'CJSC "CUSTOMER-E ГРУПП"',
            "CUSTOMER-E ГРУПП",
            "CUSTOMER-E GROUP LAT",
        ),
    ),
    ("CUSTOMER-G", ("CUSTOMER-G", "CUSTOMER-G LAT")),
    ('CJSC "CUSTOMER-J"', ('CJSC "CUSTOMER-J"', "CUSTOMER-J", "CUSTOMER-J LAT")),
)


def _first_row_value(row, key, index=0):
    if not row:
        return None
    if isinstance(row, dict):
        return row.get(key)
    return row[index] if len(row) > index else None


def _sender_lookup_keys(value):
    normalized = normalize_text(value)
    if not normalized:
        return ()
    variants = {normalized, normalize_station_name(value)}
    stripped = _CUSTOMER_LEGAL_WORDS_RE.sub(" ", normalized)
    stripped = _LATIN_CUSTOMER_LEGAL_WORDS_RE.sub(" ", stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip(" -/\"'«»“”")
    if stripped:
        variants.update(
            {
                stripped,
                stripped.replace("-", " "),
                stripped.replace(" - ", " "),
                re.sub(r"(?<=[\s-])З\b", "3", stripped),
            }
        )
    compact = _NAME_MATCH_COMPACT_RE.sub("", normalized)
    if compact:
        variants.add(compact)
    return tuple(item for item in variants if item)


def _default_sender_lookup():
    lookup = {}
    for standard_name, aliases in _SENDER_STANDARD_ALIASES:
        for alias in (standard_name, *aliases):
            for key in _sender_lookup_keys(alias):
                lookup[key] = standard_name
    return lookup


def load_sender_standard_lookup(cur):
    lookup = _default_sender_lookup()
    cur.execute(
        """
        SELECT standard_name, alias_name, normalized_alias
        FROM entity_aliases
        WHERE standard_name IS NOT NULL
          AND TRIM(standard_name) <> ''
        """
    )
    for row in cur.fetchall():
        standard_name = _first_row_value(row, "standard_name", 0)
        if not standard_name:
            continue
        values = (
            _first_row_value(row, "alias_name", 1),
            _first_row_value(row, "normalized_alias", 2),
            standard_name,
        )
        for value in values:
            for key in _sender_lookup_keys(value):
                lookup[key] = standard_name
    return lookup


def resolve_sender_standard_name(sender_lookup, raw_name):
    normalized = normalize_text(raw_name)
    if not normalized:
        return None
    for key in _sender_lookup_keys(raw_name):
        standard_name = sender_lookup.get(key)
        if standard_name:
            return standard_name

    matches = []
    for alias, standard_name in sender_lookup.items():
        if len(alias) < 4:
            continue
        if alias in normalized or normalized in alias:
            matches.append((len(alias), standard_name))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


def _customer_reference_from_row(row):
    if not row:
        return None
    normalized_name = _first_row_value(row, "normalized_name")
    if not normalized_name:
        return None
    return normalized_name, (_first_row_value(row, "customer_type", 1) or "unknown")


def _is_sales_customer_reference(reference):
    return bool(reference and reference[1] in _SALES_CUSTOMER_TYPES)


def _is_customer_reference(reference):
    return bool(reference and reference[0])


def _customer_lookup_candidates(*names):
    seen = set()
    for name in names:
        normalized = normalize_text(name)
        if not normalized:
            continue
        variants = [normalized, normalize_station_name(name)]
        stripped = _CUSTOMER_LEGAL_WORDS_RE.sub(" ", normalized)
        stripped = re.sub(r"\s+", " ", stripped).strip(" -")
        if stripped:
            variants.extend(
                [
                    stripped,
                    stripped.replace("-", " "),
                    stripped.replace(" - ", " "),
                    re.sub(r"(?<=[\s-])З\b", "3", stripped),
                ]
            )
        for variant in variants:
            candidate = re.sub(r"\s+", " ", normalize_text(variant)).strip(" -")
            if candidate and candidate not in seen:
                seen.add(candidate)
                yield candidate


def _lookup_customer_reference_by_name(cur, candidate):
    cur.execute(
        """
        SELECT normalized_name, customer_type
        FROM customers
        WHERE normalized_name = %s OR standard_name = %s
        ORDER BY CASE
            WHEN customer_type IN ('export_wholesale', 'local_wholesale') THEN 0
            ELSE 1
        END
        LIMIT 1
        """,
        (candidate, candidate),
    )
    return _customer_reference_from_row(cur.fetchone())


def _lookup_customer_reference_by_id(cur, customer_id):
    if customer_id is None or not str(customer_id).isdigit():
        return None
    cur.execute(
        """
        SELECT normalized_name, customer_type
        FROM customers
        WHERE id = %s
        LIMIT 1
        """,
        (int(customer_id),),
    )
    return _customer_reference_from_row(cur.fetchone())


def _lookup_customer_reference_by_alias(cur, candidate):
    cur.execute(
        """
        SELECT entity_code, standard_name
        FROM entity_aliases
        WHERE entity_type = 'wholesale_customer'
          AND (normalized_alias = %s OR standard_name = %s OR alias_name = %s)
        ORDER BY confidence DESC
        LIMIT 5
        """,
        (candidate, candidate, candidate),
    )
    rows = cur.fetchall()
    fallback = None
    for row in rows:
        reference = _lookup_customer_reference_by_id(cur, _first_row_value(row, "entity_code", 0))
        if _is_sales_customer_reference(reference):
            return reference
        if reference and fallback is None:
            fallback = reference
        standard_name = _first_row_value(row, "standard_name", 1)
        reference = _lookup_customer_reference_by_name(cur, normalize_text(standard_name))
        if _is_sales_customer_reference(reference):
            return reference
        if reference and fallback is None:
            fallback = reference
    return fallback


def find_customer_reference(cur, *names):
    fallback = None
    for candidate in _customer_lookup_candidates(*names):
        reference = _lookup_customer_reference_by_name(cur, candidate)
        if _is_sales_customer_reference(reference):
            return reference
        if reference and fallback is None:
            fallback = reference
        reference = _lookup_customer_reference_by_alias(cur, candidate)
        if _is_sales_customer_reference(reference):
            return reference
        if reference and fallback is None:
            fallback = reference
    return fallback


def resolve_customer_reference(cur, *names):
    first_candidate = None
    for candidate in _customer_lookup_candidates(*names):
        first_candidate = candidate
        break
    reference = find_customer_reference(cur, *names)
    if reference:
        return reference
    return (first_candidate or "", "unknown")


def lookup_customer_type(cur, *names):
    _, customer_type = resolve_customer_reference(cur, *names)
    return customer_type if customer_type in _SALES_CUSTOMER_TYPES else None


def _customer_reference_for_entity(cur, entity, raw_name):
    fallback = None
    if entity and entity.get("entity_type") == "wholesale_customer":
        reference = _lookup_customer_reference_by_id(cur, entity.get("entity_code"))
        if _is_sales_customer_reference(reference):
            return reference
        fallback = reference
        reference = find_customer_reference(cur, entity.get("standard_name"), raw_name)
        if _is_sales_customer_reference(reference):
            return reference
        return fallback or reference
    return find_customer_reference(cur, raw_name)


def _classification_from_customer_type(customer_type):
    if customer_type == "export_wholesale":
        return "export_wholesale"
    if customer_type == "local_wholesale":
        return "local_wholesale"
    return None


def is_internal_entity_name(name):
    normalized = normalize_text(name)
    if not normalized:
        return False
    compact = _NAME_MATCH_COMPACT_RE.sub("", normalized)
    return any(
        keyword in normalized
        or (_NAME_MATCH_COMPACT_RE.sub("", normalize_text(keyword)) in compact)
        for keyword in _INTERNAL_SUBSTRING_KEYWORDS
    ) or any(
        normalized == keyword
        or compact == _NAME_MATCH_COMPACT_RE.sub("", normalize_text(keyword))
        for keyword in _INTERNAL_EXACT_KEYWORDS
    )


def is_customer_like_entity_name(name):
    normalized = normalize_text(name)
    if not normalized or is_internal_entity_name(name):
        return False
    compact = _NAME_MATCH_COMPACT_RE.sub("", normalized)
    return (
        bool(_CUSTOMER_LEGAL_WORDS_RE.search(normalized))
        or bool(_LATIN_CUSTOMER_LEGAL_WORDS_RE.search(normalized))
        or compact.startswith(_CYRILLIC_CUSTOMER_LEGAL_PREFIXES_COMPACT)
        or any(compact.startswith(f"НГК{prefix}") for prefix in _CYRILLIC_CUSTOMER_LEGAL_PREFIXES_COMPACT)
        or compact.startswith(_LATIN_CUSTOMER_LEGAL_PREFIXES_COMPACT)
        or compact.endswith(_LATIN_CUSTOMER_LEGAL_SUFFIXES_COMPACT)
        or "Company" in normalized
        or is_processing_sender_name(name)
    )


def is_processing_sender_name(name):
    normalized = normalize_text(name)
    if not normalized:
        return False
    compact = _NAME_MATCH_COMPACT_RE.sub("", normalized)
    processing_keywords = (
        "CUSTOMER-H",
        "CUSTOMER-H-3",
        "CUSTOMER-H З",
        "CUSTOMER-H 3",
        "CUSTOMER-H",
        "CUSTOMER-H3",
        "CUSTOMER-H-LAT",
        "CUSTOMER-F ПЕТРОЛАТ",
        "CUSTOMER-FПЕТРОЛАТ",
        "CUSTOMER-F PETROLAT",
        "CUSTOMER-FPETROLAT",
        "CUSTOMER-E ГРУПП",
        "CUSTOMER-E",
        "CUSTOMER-E GROUP LAT",
        "CUSTOMER-EGROUPLAT",
        "CUSTOMER-G ЛАТ",
        "CUSTOMER-GЛАТ",
        "CUSTOMER-G LAT",
        "CUSTOMER-GLAT",
        "CUSTOMER-J ЛАТ",
        "CUSTOMER-J LAT",
    )
    return any(keyword in normalized or keyword in compact for keyword in processing_keywords)


def normalize_wholesale_classification(value):
    if value in ("export_wholesale", "local_wholesale", "transfer", "processing", "procurement", "other", "unknown"):
        return value
    if value == "external_transport":
        return "transfer"
    if value == "toll_processing":
        return "processing"
    return "unknown"


def detect_transport_mode(*values):
    text = normalize_text(" ".join(clean_str(value) or "" for value in values))
    compact = (
        text.replace(" ", "")
        .replace("-", "")
        .replace("/", "")
        .replace("\\", "")
        .replace(".", "")
    )
    if any(marker in text for marker in TRAIN_TRANSPORT_MARKERS):
        return "train"
    if any(marker in compact for marker in TRAIN_TRANSPORT_COMPACT_MARKERS):
        return "train"
    return "truck"


def detail_transport_mode(classification, vehicle_no=None, weigh_serial_no=None, remark=None):
    if normalize_wholesale_classification(classification) == "processing":
        return detect_transport_mode(remark)
    return detect_transport_mode(vehicle_no, weigh_serial_no, remark)


def can_auto_approve_weigh_detail(classification, product_id=None, entity_code=None):
    classification = normalize_wholesale_classification(classification)
    if not product_id or classification == "unknown":
        return False
    if classification in ("transfer", "processing", "procurement", "other"):
        return True
    return entity_code is not None


def classify_wholesale_movement(cur, entity_lookup, raw_entity, sender_name=None, current=None):
    receiver = lookup_entity(entity_lookup, raw_entity)
    sender = lookup_entity(entity_lookup, sender_name) if sender_name else None
    receiver_type = receiver.get("entity_type") if receiver else "unknown"
    sender_type = sender.get("entity_type") if sender else "unknown"

    sender_internal = sender_type == "own_depot" or is_internal_entity_name(sender_name)
    receiver_business_internal = receiver_type == "own_depot" or is_internal_entity_name(raw_entity)
    receiver_transfer_target = (
        receiver_type in ("retail_station", "own_depot")
        and str(receiver.get("entity_code") or "") not in (INTERNAL_USE_ENTITY_CODE, "ExampleLatin")
    )

    receiver_customer = _customer_reference_for_entity(cur, receiver, raw_entity)
    sender_customer = find_customer_reference(cur, sender_name)
    receiver_is_customer = (
        (_is_customer_reference(receiver_customer) or is_customer_like_entity_name(raw_entity))
        and not receiver_business_internal
        and not receiver_transfer_target
    )
    sender_is_customer = (
        (_is_customer_reference(sender_customer) or is_customer_like_entity_name(sender_name))
        and not sender_internal
    )
    sender_has_name = bool(clean_str(sender_name))

    if receiver_type == "own_depot" and str(receiver.get("entity_code") or "") == INTERNAL_USE_ENTITY_CODE:
        return "other"

    if sender_has_name and not sender_internal and receiver_business_internal:
        return "procurement"

    if sender_is_customer and receiver_business_internal:
        return "procurement"

    if sender_is_customer and receiver_is_customer:
        return "processing"

    if sender_internal and receiver_transfer_target:
        return "transfer"

    if sender_internal and receiver_business_internal:
        return "other"

    if sender_internal and receiver_is_customer:
        classified = _classification_from_customer_type(receiver_customer[1] if receiver_customer else None)
        return classified or "unknown"

    return "unknown"


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
