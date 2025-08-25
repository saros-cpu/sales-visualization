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
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
)
from text_utils import normalize_text

WEIGH_COLUMNS = ["序号", "编号", "卡号", "车号", "服务区域", "运输单位", "发货单位",
    "收货单位", "货名", "规格", "毛重", "皮重", "净重", "扣重", "实重",
    "单价", "金额", "过磅费", "毛重司磅员", "皮重司磅员",
    "毛重日期", "毛重时间", "皮重日期", "皮重时间", "备注",
    "发货车辆", "作废", "上传"]


def main():
    source = os.environ.get("WEIGH_SOURCE", "储运区")
    weigh_table = os.environ.get("WEIGH_TABLE", "kj_weighing")
    conn = get_connection()
    try:
        cur = conn.cursor()
        yesterday = date.today() - timedelta(days=1)
        col_str = ", ".join(WEIGH_COLUMNS)
        cur.execute(f"SELECT {col_str} FROM {weigh_table} WHERE sync_date = %s AND (作废 IS NULL OR 作废 = 0) ORDER BY 序号", (yesterday,))
        rows = cur.fetchall()

        generated = 0
        skipped = 0
        auto_entity = 0
        auto_approved = 0
        auto_product = 0
        entity_lookup = load_entity_lookup(cur)
        product_lookup = load_product_lookup(cur)

        for r in rows:
            record = dict(zip(WEIGH_COLUMNS, r))
            raw_entity = (record.get("收货单位") or record.get("发货单位") or "").strip()
            raw_product = (record.get("货名") or "").strip()
            vehicle_no = (record.get("车号") or "").strip()
            weigh_serial_no = (record.get("编号") or "").strip()
            sender_name = (record.get("发货单位") or "").strip()
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
                 standard_entity_name, classification, weight_kg, match_status, audit_status, weigh_source)
                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (int(record.get("序号", 0) or 0), business_date, raw_product, product_id, vehicle_no,
                  weigh_serial_no, raw_entity, sender_name, entity_type, entity_code,
                  standard_name, classification, weight_kg, match_status, audit_status, source))
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
