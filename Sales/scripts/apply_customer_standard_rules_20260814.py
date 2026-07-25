from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from db import get_connection
from text_utils import normalize_text


SOURCE_TAG = "customer_rule_20260814"
CUSTOMER_TYPES = {"local_wholesale", "export_wholesale", "mixed", "unknown"}
PUNCT_RE = re.compile(r"[\s\-_.·,，。/\\()（）№#\"'`«»“”‘’]+", re.UNICODE)


def json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def compact(value) -> str:
    return PUNCT_RE.sub("", normalize_text(value).replace("Ё", "Е"))


def rule_jailoo(value) -> bool:
    return "ЖАЙЛООБАЕВ" in normalize_text(value).replace("Ё", "Е")


def rule_panyshev(value) -> bool:
    return "ПАНЫШЕВ" in normalize_text(value).replace("Ё", "Е")


def rule_sever_yug(value) -> bool:
    text = normalize_text(value).replace("Ё", "Е")
    return "СЕВЕР" in text and "ЮГ" in text and "ОЙЛ" in text


def rule_asman(value) -> bool:
    text = compact(value)
    return "АСМАН" in text and "ОЙЛ" in text


def rule_baiel(value) -> bool:
    return "БАЙЭЛ" in normalize_text(value).replace("Ё", "Е")


RULES = [
    ("jailooobaev", "И П. Жайлообаев. А.Ж", rule_jailoo),
    ("panyshev", "И.П Панышев Н.М", rule_panyshev),
    ("sever_yug_oil", 'CJSC "CUSTOMER-O"', rule_sever_yug),
    ("asman_oil", "CJSC CUSTOMER-P", rule_asman),
    ("baiel", "CJSC НПЗ CUSTOMER-H-3", rule_baiel),
]


def placeholders(values) -> str:
    return ",".join(["%s"] * len(values))


def fetch_customer_maps(cur):
    cur.execute("SELECT id, standard_name, normalized_name, customer_type FROM customers")
    rows = [dict(row) for row in cur.fetchall()]
    return {int(row["id"]): row for row in rows}, {row["normalized_name"]: row for row in rows}


def get_or_create_customer(cur, standard_name: str, customer_type: str):
    normalized = normalize_text(standard_name)
    cur.execute(
        "SELECT id, standard_name, normalized_name, customer_type FROM customers WHERE normalized_name = %s",
        (normalized,),
    )
    row = cur.fetchone()
    if row:
        customer_id = int(row["id"])
        cur.execute(
            """
            UPDATE customers
            SET standard_name = %s,
                customer_type = IF(customer_type = 'unknown', %s, customer_type)
            WHERE id = %s
            """,
            (standard_name, customer_type, customer_id),
        )
        return customer_id, False

    cur.execute(
        "INSERT INTO customers (standard_name, normalized_name, customer_type) VALUES (%s, %s, %s)",
        (standard_name, normalized, customer_type),
    )
    return int(cur.lastrowid), True


def collect_rule_names(cur, predicate):
    names = set()
    source_customer_ids = set()
    type_counts = Counter()

    cur.execute("SELECT id, standard_name, normalized_name, customer_type FROM customers")
    for row in cur.fetchall():
        standard_name = row.get("standard_name") or ""
        normalized_name = row.get("normalized_name") or ""
        if predicate(standard_name) or predicate(normalized_name):
            source_customer_ids.add(int(row["id"]))
            type_counts[row.get("customer_type") or "unknown"] += 1
            names.add(standard_name)
            if normalized_name:
                names.add(normalized_name)

    cur.execute(
        """
        SELECT alias_name, standard_name, entity_code
        FROM entity_aliases
        WHERE entity_type = 'wholesale_customer'
        """
    )
    for row in cur.fetchall():
        for value in (row.get("alias_name"), row.get("standard_name")):
            if value and predicate(value):
                names.add(value)
        entity_code = str(row.get("entity_code") or "")
        if entity_code.isdigit() and (predicate(row.get("alias_name")) or predicate(row.get("standard_name"))):
            source_customer_ids.add(int(entity_code))

    cur.execute(
        """
        SELECT raw_entity_name, standard_entity_name
        FROM wholesale_detail_records
        WHERE raw_entity_name IS NOT NULL OR standard_entity_name IS NOT NULL
        GROUP BY raw_entity_name, standard_entity_name
        """
    )
    for row in cur.fetchall():
        for value in (row.get("raw_entity_name"), row.get("standard_entity_name")):
            if value and predicate(value):
                names.add(value)

    cur.execute(
        """
        SELECT raw_customer_name
        FROM contracts
        WHERE raw_customer_name IS NOT NULL
        GROUP BY raw_customer_name
        """
    )
    for row in cur.fetchall():
        value = row.get("raw_customer_name")
        if value and predicate(value):
            names.add(value)

    return sorted(names, key=lambda item: normalize_text(item)), source_customer_ids, type_counts


def choose_customer_type(type_counts: Counter) -> str:
    for customer_type, _count in type_counts.most_common():
        if customer_type in {"local_wholesale", "export_wholesale", "mixed"}:
            return customer_type
    return "local_wholesale"


def upsert_alias(cur, target_customer_id: int, standard_name: str, alias_name: str):
    cur.execute(
        """
        INSERT INTO entity_aliases
            (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
        VALUES ('wholesale_customer', %s, %s, %s, %s, 100, %s)
        ON DUPLICATE KEY UPDATE
            entity_type = VALUES(entity_type),
            entity_code = VALUES(entity_code),
            standard_name = VALUES(standard_name),
            alias_name = VALUES(alias_name),
            confidence = VALUES(confidence),
            source = VALUES(source)
        """,
        (str(target_customer_id), standard_name, alias_name, normalize_text(alias_name), SOURCE_TAG),
    )
    return cur.rowcount


def sync_contracts(cur, target_customer_id: int, alias_names, source_customer_ids):
    rowcount = 0
    source_ids = sorted(int(item) for item in source_customer_ids if int(item) != target_customer_id)
    if source_ids:
        cur.execute(
            f"UPDATE contracts SET customer_id = %s WHERE customer_id IN ({placeholders(source_ids)})",
            [target_customer_id, *source_ids],
        )
        rowcount += cur.rowcount
    if alias_names:
        cur.execute(
            f"UPDATE contracts SET customer_id = %s WHERE raw_customer_name IN ({placeholders(alias_names)})",
            [target_customer_id, *alias_names],
        )
        rowcount += cur.rowcount
    return rowcount


def sync_details(cur, target_customer_id: int, standard_name: str, alias_names, source_customer_ids):
    conditions = []
    params = ["wholesale_customer", str(target_customer_id), standard_name]
    source_ids = [str(item) for item in sorted(source_customer_ids) if int(item) != target_customer_id]
    if source_ids:
        conditions.append(f"entity_code IN ({placeholders(source_ids)})")
        params.extend(source_ids)
    if alias_names:
        conditions.append(f"raw_entity_name IN ({placeholders(alias_names)})")
        params.extend(alias_names)
        conditions.append(f"standard_entity_name IN ({placeholders(alias_names)})")
        params.extend(alias_names)
    if not conditions:
        return 0
    cur.execute(
        f"""
        UPDATE wholesale_detail_records
        SET entity_type = %s,
            entity_code = %s,
            standard_entity_name = %s
        WHERE {" OR ".join(conditions)}
        """,
        params,
    )
    return cur.rowcount


def apply_rule(cur, slug: str, target_name: str, predicate):
    alias_names, source_customer_ids, type_counts = collect_rule_names(cur, predicate)
    customer_type = choose_customer_type(type_counts)
    target_customer_id, created = get_or_create_customer(cur, target_name, customer_type)
    alias_names = sorted(set([*alias_names, target_name]), key=lambda item: normalize_text(item))

    report = {
        "rule": slug,
        "targetName": target_name,
        "targetCustomerId": target_customer_id,
        "targetCreated": created,
        "chosenCustomerType": customer_type,
        "sourceCustomerIds": sorted(source_customer_ids),
        "aliasNames": alias_names,
        "aliasCount": len(alias_names),
        "entityAliasesUpserted": 0,
        "contractsUpdated": 0,
        "detailReferencesUpdated": 0,
    }

    for alias_name in alias_names:
        report["entityAliasesUpserted"] += upsert_alias(cur, target_customer_id, target_name, alias_name)
    report["contractsUpdated"] = sync_contracts(cur, target_customer_id, alias_names, source_customer_ids)
    report["detailReferencesUpdated"] = sync_details(cur, target_customer_id, target_name, alias_names, source_customer_ids)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--output-dir", default="D:/SalesVisualization/outputs/customer_standard_review")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    mode = "apply" if args.apply else "dry_run"
    report_path = output_dir / f"customer_standard_rules_{mode}_{stamp}.json"

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            reports = [apply_rule(cur, slug, target_name, predicate) for slug, target_name, predicate in RULES]
        if args.apply:
            conn.commit()
        else:
            conn.rollback()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    payload = {
        "mode": mode,
        "source": SOURCE_TAG,
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "rules": reports,
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=json_default), encoding="utf-8")
    print(json.dumps({"mode": mode, "reportPath": str(report_path), "rules": reports}, ensure_ascii=False, indent=2, default=json_default))


if __name__ == "__main__":
    main()
