"""
自动称重生成批发明细脚本。
由 Windows 计划任务每日 01:00 调用。
读取前一日称重数据 → 应用映射 → 插入批发明细表。
使用 entity_aliases / product_aliases 进行映射，不再使用独立的 weigh_*_mappings 表。
"""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from db import get_connection
from import_helpers import (
    can_auto_approve_weigh_detail,
    classify_wholesale_movement,
    format_lpg_remark,
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
)
from text_utils import normalize_text
from wholesale_source_policy import (
    WHOLESALE_SOURCE_CUTOFF,
    clamp_weighing_detail_range,
)

WEIGH_COLUMNS = ["序号", "编号", "卡号", "车号", "服务区域", "运输单位", "发货单位",
    "收货单位", "货名", "规格", "毛重", "皮重", "净重", "扣重", "实重",
    "单价", "金额", "过磅费", "毛重司磅员", "皮重司磅员",
    "毛重日期", "毛重时间", "皮重日期", "皮重时间", "备注",
    "发货车辆", "作废", "上传"]

WEIGH_SOURCE_STORAGE = "储运区"
WEIGH_SOURCE_LPG = "液化气罐区"
WEIGH_SOURCE_ALIASES = {
    "储运区": WEIGH_SOURCE_STORAGE,
    "kj_weighing": WEIGH_SOURCE_STORAGE,
    "storage_district": WEIGH_SOURCE_STORAGE,
    "storagedistrict": WEIGH_SOURCE_STORAGE,
    "液化气罐区": WEIGH_SOURCE_LPG,
    "lpg": WEIGH_SOURCE_LPG,
    "lpg_weighing": WEIGH_SOURCE_LPG,
    "lpg_storage": WEIGH_SOURCE_LPG,
}


def normalize_source(value):
    raw = str(value or WEIGH_SOURCE_STORAGE).strip()
    return WEIGH_SOURCE_ALIASES.get(raw) or WEIGH_SOURCE_ALIASES.get(raw.lower()) or WEIGH_SOURCE_STORAGE


def json_text(column, key):
    return f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '$.{key}')), '')"


def json_text_when_valid(column, key):
    return f"CASE WHEN JSON_VALID({column}) THEN {json_text(column, key)} ELSE NULL END"


def lpg_record_select_sql():
    return f"""
        SELECT
            lpg.id AS `序号`,
            lpg.weigh_serial_no AS `编号`,
            NULL AS `卡号`,
            lpg.vehicle_no AS `车号`,
            NULL AS `服务区域`,
            NULL AS `运输单位`,
            lpg.sender_name AS `发货单位`,
            lpg.receiver_name AS `收货单位`,
            lpg.raw_product_name AS `货名`,
            {json_text_when_valid('lpg.remark', 'spec_or_trailer')} AS `规格`,
            lpg.gross_weight AS `毛重`,
            lpg.tare_weight AS `皮重`,
            lpg.net_weight AS `净重`,
            NULL AS `扣重`,
            lpg.net_weight AS `实重`,
            NULL AS `单价`,
            NULL AS `金额`,
            NULL AS `过磅费`,
            {json_text_when_valid('lpg.remark', 'operator')} AS `毛重司磅员`,
            {json_text_when_valid('lpg.remark', 'tare_operator')} AS `皮重司磅员`,
            lpg.business_date AS `毛重日期`,
            {json_text_when_valid('lpg.remark', 'gross_time')} AS `毛重时间`,
            {json_text_when_valid('lpg.remark', 'tare_date')} AS `皮重日期`,
            {json_text_when_valid('lpg.remark', 'tare_time')} AS `皮重时间`,
            NULLIF(lpg.remark, '') AS `备注`,
            NULL AS `发货车辆`,
            0 AS `作废`,
            NULL AS `上传`,
            lpg.business_date AS sync_date
        FROM lpg_weighing lpg
        WHERE lpg.business_date >= %s AND lpg.business_date <= %s
        ORDER BY lpg.business_date, lpg.id
    """


def fetch_records(cur, source, start_date, end_date):
    col_names = WEIGH_COLUMNS + ["sync_date"]
    if source == WEIGH_SOURCE_LPG:
        cur.execute(lpg_record_select_sql(), (start_date, end_date))
        return col_names, cur.fetchall()

    weigh_table = os.environ.get("WEIGH_TABLE", "kj_weighing")
    col_parts = []
    for col in WEIGH_COLUMNS:
        if col == "毛重日期":
            col_parts.append("COALESCE(NULLIF(`毛重日期`, '0000-00-00 00:00:00'), `皮重日期`) AS `毛重日期`")
        else:
            col_parts.append(f"`{col}`")
    col_str = ", ".join(col_parts)
    cur.execute(
        f"""
        SELECT {col_str}, sync_date
        FROM {weigh_table}
        WHERE sync_date >= %s AND sync_date <= %s
          AND (`作废` IS NULL OR `作废` = 0)
        ORDER BY `序号`
        """,
        (start_date, end_date),
    )
    return col_names, cur.fetchall()


def main():
    source = normalize_source(os.environ.get("WEIGH_SOURCE", WEIGH_SOURCE_STORAGE))
    conn = get_connection()
    try:
        cur = conn.cursor()
        yesterday = date.today() - timedelta(days=1)
        start_date = date.fromisoformat(os.environ.get("WEIGH_DATE_FROM") or yesterday.isoformat())
        end_date = date.fromisoformat(os.environ.get("WEIGH_DATE_TO") or start_date.isoformat())
        effective_range = clamp_weighing_detail_range(start_date, end_date)
        if effective_range is None:
            print(
                "称重生成完成: 新增 0 条, 自动通过 0 条, 跳过 0 条, "
                "自动实体映射 0 条, 自动油品映射 0 条 "
                f"(称重业务明细只生成 {WHOLESALE_SOURCE_CUTOFF.isoformat()} 之前的数据)"
            )
            return
        start_date, end_date = effective_range
        col_names, rows = fetch_records(cur, source, start_date, end_date)

        generated = 0
        skipped = 0
        auto_entity = 0
        auto_approved = 0
        auto_product = 0
        entity_lookup = load_entity_lookup(cur)
        product_lookup = load_product_lookup(cur)

        for r in rows:
            record = dict(zip(col_names, r))
            raw_entity = (record.get("收货单位") or record.get("发货单位") or "").strip()
            raw_product = (record.get("货名") or "").strip()
            vehicle_no = (record.get("车号") or "").strip()
            weigh_serial_no = (record.get("编号") or "").strip()
            sender_name = (record.get("发货单位") or "").strip()
            remark = (record.get("备注") or "").strip()
            if source == WEIGH_SOURCE_LPG:
                remark = format_lpg_remark(remark)
            gross_date = record.get("毛重日期")
            net_weight = record.get("实重") or record.get("净重")
            if not raw_entity or not raw_product or net_weight is None:
                skipped += 1
                continue
            try:
                weight_kg = float(net_weight)
            except (TypeError, ValueError):
                skipped += 1
                continue
            if weight_kg <= 0:
                skipped += 1
                continue

            business_date = gross_date if gross_date else yesterday
            row_number = int(record.get("序号", 0) or 0)
            cur.execute(
                """
                SELECT id FROM wholesale_detail_records
                WHERE batch_id IS NULL AND weigh_source = %s AND source_row_number = %s
                LIMIT 1
                """,
                (source, row_number),
            )
            if cur.fetchone():
                skipped += 1
                continue

            match = lookup_entity(entity_lookup, raw_entity)
            entity_type = "unknown"
            entity_code = None
            standard_name = None
            classification = "unknown"
            if match:
                entity_type = match["entity_type"]
                entity_code = match["entity_code"]
                standard_name = match["standard_name"]
            else:
                normalized = normalize_text(raw_entity)
                cur.execute("SELECT id, standard_name FROM customers WHERE normalized_name = %s LIMIT 1", (normalized,))
                c = cur.fetchone()
                if c:
                    entity_type = "wholesale_customer"
                    entity_code = str(c[0])
                    standard_name = c[1]
                    cur.execute("INSERT IGNORE INTO entity_aliases (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source) VALUES (%s,%s,%s,%s,%s,50,'weigh_auto')",
                        (entity_type, entity_code, standard_name, raw_entity, normalized))
                    auto_entity += 1
                    entity_lookup = load_entity_lookup(cur)

            product_match = lookup_product(product_lookup, raw_product)
            product_id = None
            if product_match:
                product_id = product_match["id"]
            else:
                normalized = normalize_text(raw_product)
                cur.execute("""
                    SELECT p.id FROM products p
                    WHERE p.product_code = %s OR p.display_name = %s LIMIT 1
                """, (raw_product, raw_product))
                c = cur.fetchone()
                if c:
                    product_id = c[0]
                    cur.execute("INSERT IGNORE INTO product_aliases (product_id, alias_name, normalized_alias, confidence, source) VALUES (%s,%s,%s,50,'weigh_auto')",
                        (product_id, raw_product, normalized))
                    auto_product += 1
                    product_lookup = load_product_lookup(cur)

            classification = classify_wholesale_movement(
                cur,
                entity_lookup,
                raw_entity,
                sender_name=sender_name,
                current=classification,
            )
            auto_approve = can_auto_approve_weigh_detail(classification, product_id, entity_code)
            audit_status = "approved" if auto_approve else "pending"
            match_status = "matched" if auto_approve else "unmatched"
            if auto_approve:
                auto_approved += 1

            cur.execute("""
                INSERT INTO wholesale_detail_records
                (batch_id, source_row_number, business_date, raw_product_name, product_id, vehicle_no,
                 weigh_serial_no, raw_entity_name, sender_name, entity_type, entity_code,
                 standard_entity_name, classification, weight_kg, match_status, audit_status, weigh_source, remark)
                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (row_number, business_date, raw_product, product_id, vehicle_no,
                  weigh_serial_no, raw_entity, sender_name, entity_type, entity_code,
                  standard_name, classification, weight_kg, match_status, audit_status, source, remark))
            generated += 1

        conn.commit()
        print(f"称重生成完成: 新增 {generated} 条, 自动通过 {auto_approved} 条, 跳过 {skipped} 条, 自动实体映射 {auto_entity} 条, 自动油品映射 {auto_product} 条")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
