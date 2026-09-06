from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import wraps
import importlib.util
import json
import logging
from pathlib import Path
import threading
from flask import jsonify, redirect, request, session
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from db import get_connection
from text_utils import parse_date, parse_decimal
from calculations import recalculate_wholesale_batch
from import_helpers import classify_wholesale_movement, load_entity_lookup, load_product_lookup, lookup_entity, lookup_product

REFRESH_CACHE_STATUS = {
    "running": False,
    "startedAt": None,
    "finishedAt": None,
    "status": "idle",
    "message": "尚未执行",
    "items": [],
}
REFRESH_CACHE_LOCK = threading.Lock()

def _column_value(row, index, key):
    return row.get(key) if isinstance(row, dict) else row[index]


def ensure_auth_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS system_users (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(64) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(128) NOT NULL,
            role VARCHAR(64) NOT NULL DEFAULT 'viewer',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            last_login_at TIMESTAMP NULL,
            password_changed_at TIMESTAMP NULL,
            password_reset_at TIMESTAMP NULL,
            KEY idx_system_users_role (role, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute("SHOW COLUMNS FROM system_users LIKE 'role'")
    row = cur.fetchone()
    if row:
        column_type = str(_column_value(row, 1, "Type") or "")
        if column_type.lower().startswith("enum"):
            cur.execute("ALTER TABLE system_users MODIFY role VARCHAR(64) NOT NULL DEFAULT 'viewer'")
            cur.execute("UPDATE system_users SET role = 'viewer' WHERE role = 'user'")
    cur.execute("SHOW COLUMNS FROM system_users LIKE 'must_change_password'")
    if not cur.fetchone():
        cur.execute(
            """
            ALTER TABLE system_users
            ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE AFTER is_active
            """
        )
    cur.execute("SHOW COLUMNS FROM system_users LIKE 'password_changed_at'")
    if not cur.fetchone():
        cur.execute(
            """
            ALTER TABLE system_users
            ADD COLUMN password_changed_at TIMESTAMP NULL AFTER last_login_at
            """
        )
    cur.execute("SHOW COLUMNS FROM system_users LIKE 'password_reset_at'")
    if not cur.fetchone():
        cur.execute(
            """
            ALTER TABLE system_users
            ADD COLUMN password_reset_at TIMESTAMP NULL AFTER password_changed_at
            """
        )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS system_revoked_tokens (
            jti VARCHAR(64) PRIMARY KEY,
            expires_at BIGINT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_system_revoked_tokens_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )


def user_requires_password_change(cur, user_id):
    if not user_id:
        return False
    ensure_auth_schema(cur)
    cur.execute(
        """
        SELECT must_change_password
        FROM system_users
        WHERE id = %s AND is_active = TRUE
        """,
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return False
    return bool(_column_value(row, 0, "must_change_password"))


def ensure_operation_log_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS operation_logs (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            user_id BIGINT NULL,
            username VARCHAR(64) NULL,
            action VARCHAR(128) NOT NULL,
            target_type VARCHAR(128) NULL,
            target_id VARCHAR(128) NULL,
            detail JSON NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_operation_logs_created (created_at),
            KEY idx_operation_logs_action (action)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )


def ensure_market_watch_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS market_watch_items (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            market_region ENUM('Russia', 'Uzbekistan', 'Europe_US', 'Global') NOT NULL DEFAULT 'Global',
            market_type ENUM('crude', 'refined', 'policy', 'logistics', 'other') NOT NULL DEFAULT 'other',
            title VARCHAR(255) NOT NULL,
            summary TEXT NOT NULL,
            price_text VARCHAR(255) NULL,
            source_name VARCHAR(128) NULL,
            source_url VARCHAR(500) NULL,
            observed_at DATE NOT NULL,
            priority INT NOT NULL DEFAULT 100,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_market_watch_active (is_active, observed_at, priority),
            KEY idx_market_watch_region (market_region, observed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute("SHOW COLUMNS FROM market_watch_items LIKE 'price_text'")
    if not cur.fetchone():
        cur.execute("ALTER TABLE market_watch_items ADD COLUMN price_text VARCHAR(255) NULL AFTER summary")


def ensure_automation_task_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS automation_task_runs (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            task_name VARCHAR(64) NOT NULL,
            status ENUM('success', 'failed', 'running') NOT NULL DEFAULT 'running',
            started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP NULL,
            summary JSON NULL,
            error TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_automation_task_name (task_name, started_at),
            KEY idx_automation_task_status (status, started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )


def ensure_data_quality_issue_schema(cur):
    duplicate_issue = "possible_duplicate_conflicting_product"
    cur.execute("SHOW COLUMNS FROM data_quality_issues LIKE 'issue_type'")
    row = cur.fetchone()
    if not row:
        return
    column_type = str(row[1] or "")
    if duplicate_issue in column_type:
        return
    cur.execute(
        """
        ALTER TABLE data_quality_issues
        MODIFY issue_type ENUM(
            'missing_exchange_rate',
            'missing_density',
            'unknown_product',
            'unknown_entity',
            'contract_unmatched',
            'contract_out_of_period',
            'summary_mismatch',
            'possible_duplicate_conflicting_product'
        ) NOT NULL
        """
    )


def record_automation_task(cur, task_name, status, summary=None, error=None):
    ensure_automation_task_schema(cur)
    cur.execute(
        """
        INSERT INTO automation_task_runs (task_name, status, started_at, finished_at, summary, error)
        VALUES (%s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, %s, %s)
        """,
        (task_name, status, json.dumps(summary or {}, ensure_ascii=False), error),
    )

def log_operation(cur, action, target_type=None, target_id=None, detail=None):
    ensure_operation_log_schema(cur)
    user = session_user() or {}
    cur.execute(
        """
        INSERT INTO operation_logs (user_id, username, action, target_type, target_id, detail)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            user.get("id"),
            user.get("username"),
            action,
            target_type,
            str(target_id) if target_id is not None else None,
            json.dumps(detail or {}, ensure_ascii=False),
        ),
    )


def log_system_operation(action, target_type=None, target_id=None, detail=None):
    conn = get_connection()
    try:
        cur = conn.cursor()
        log_operation(cur, action, target_type, target_id, detail)
        conn.commit()
    except Exception:
        conn.rollback()
        logging.exception("Failed to write operation log: %s", action)
    finally:
        conn.close()

def ensure_station_status_schema(cur):
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS retail_station_status (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            shop_key INT NOT NULL,
            status_type VARCHAR(32) NOT NULL,
            status_label VARCHAR(64) NOT NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expected_resume_at DATETIME NULL,
            ended_at DATETIME NULL,
            affects_sales BOOLEAN NOT NULL DEFAULT FALSE,
            affects_inventory BOOLEAN NOT NULL DEFAULT FALSE,
            suppress_alerts BOOLEAN NOT NULL DEFAULT FALSE,
            note TEXT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_retail_station_status_active (is_active, ended_at, shop_key),
            KEY idx_retail_station_status_shop (shop_key, started_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute("SELECT COUNT(*) FROM retail_station_status")
    row = cur.fetchone()
    if _column_value(row, 0, "COUNT(*)"):
        return
        default_rows = [
            (1, "renovation", "装修中", "装修停业，五月中恢复", True, True, False),
            (2, "normal", "正常营业", "已恢复营业", False, False, False),
            (11, "road_blocked", "修路占道", "修路占道，无法营业", True, True, False),
            (12, "road_blocked", "修路占道", "修路占道，无法营业", True, True, False),
            (30, "renovation", "等待装修", "停业，等待装修", True, True, False),
        ]
    cur.executemany(
        """
        INSERT INTO retail_station_status
            (shop_key, status_type, status_label, note, affects_sales, affects_inventory, suppress_alerts)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        default_rows,
    )
    connection = getattr(cur, "connection", None)
    if connection:
        connection.commit()

def has_users(cur):
    ensure_auth_schema(cur)
    cur.execute("SELECT COUNT(*) AS user_count FROM system_users")
    row = cur.fetchone()
    if not row:
        return False
    return bool(_column_value(row, 0, "user_count"))


def session_user():
    user = session.get("user")
    return user if isinstance(user, dict) else None


def wants_json():
    return request.path.startswith("/api/")

def login_redirect():
    next_url = request.full_path if request.query_string else request.path
    if not next_url.startswith("/") or next_url.startswith("//"):
        next_url = "/"
    return redirect(f"/login?next={next_url}")

def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = session_user()
        if user and user.get("role") == "admin":
            return fn(*args, **kwargs)
        try:
            verify_jwt_in_request(optional=True)
            if get_jwt_identity() is not None and (get_jwt() or {}).get("role") == "admin":
                return fn(*args, **kwargs)
        except Exception:
            pass
        if not user or user.get("role") != "admin":
            return jsonify({"error": "admin_required"}), 403
        return fn(*args, **kwargs)

    return wrapper

def admin_or_permission(permission_code: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = session_user()
            if user and user.get("role") == "admin":
                return fn(*args, **kwargs)
            jwt_identity = None
            try:
                verify_jwt_in_request(optional=True)
                jwt_identity = get_jwt_identity()
                if jwt_identity is not None and (get_jwt() or {}).get("role") == "admin":
                    return fn(*args, **kwargs)
            except Exception:
                pass
            if jwt_identity is None:
                return jsonify({"error": "admin_required"}), 403
            # Function-level import avoids the shared_utils <-> api_v2 package cycle.
            from api_v2.authz import permission_required
            return permission_required(permission_code)(fn)(*args, **kwargs)

        return wrapper

    return decorator

def recalculate_all_wholesale(cur):
    cur.execute(
        """
        SELECT DISTINCT b.id
        FROM import_batches b
        JOIN wholesale_detail_records d ON d.batch_id = b.id
        WHERE b.status = 'imported'
        ORDER BY b.id
        """
    )
    total = {"matched": 0, "unmatched": 0, "missing_rates": 0}
    for (batch_id,) in cur.fetchall():
        result = recalculate_wholesale_batch(cur, batch_id)
        for key in total:
            total[key] += result[key]
    return total

def reclassify_weigh_wholesale_from_references(cur):
    entity_lookup = load_entity_lookup(cur)
    cur.execute(
        """
        SELECT id, raw_entity_name, sender_name, classification
        FROM wholesale_detail_records
        WHERE batch_id IS NULL
          AND classification IN ('local_wholesale', 'export_wholesale', 'unknown')
        """
    )
    rows = cur.fetchall()
    updated = 0
    classification_cache = {}
    for row in rows:
        detail_id = _column_value(row, 0, "id")
        raw_entity_name = _column_value(row, 1, "raw_entity_name")
        sender_name = _column_value(row, 2, "sender_name")
        current = _column_value(row, 3, "classification")
        classification_key = (raw_entity_name or "", sender_name or "")
        next_classification = classification_cache.get(classification_key)
        if next_classification is None:
            next_classification = classify_wholesale_movement(
                cur,
                entity_lookup,
                raw_entity_name,
                sender_name=sender_name,
                current="unknown",
            )
            classification_cache[classification_key] = next_classification
        if not next_classification:
            next_classification = "unknown"
        if next_classification != current:
            cur.execute(
                """
                UPDATE wholesale_detail_records
                SET classification = %s
                WHERE id = %s
                """,
                (next_classification, detail_id),
            )
            updated += 1
    return {"scanned": len(rows), "updated": updated}


def reconcile_wholesale_entity_references(cur):
    entity_lookup = load_entity_lookup(cur)
    cur.execute(
        """
        SELECT id, raw_entity_name, sender_name, entity_type, entity_code,
               standard_entity_name, classification
        FROM wholesale_detail_records
        WHERE raw_entity_name IS NOT NULL
          AND TRIM(raw_entity_name) <> ''
        """
    )
    rows = cur.fetchall()
    updated = 0
    classification_cache = {}
    for row in rows:
        detail_id = _column_value(row, 0, "id")
        raw_name = _column_value(row, 1, "raw_entity_name")
        sender_name = _column_value(row, 2, "sender_name")
        old_type = _column_value(row, 3, "entity_type")
        old_code = _column_value(row, 4, "entity_code")
        old_name = _column_value(row, 5, "standard_entity_name")
        old_classification = _column_value(row, 6, "classification")
        entity = lookup_entity(entity_lookup, raw_name)
        if not entity:
            continue
        classification_key = (raw_name or "", sender_name or "")
        next_classification = classification_cache.get(classification_key)
        if next_classification is None:
            next_classification = classify_wholesale_movement(
                cur,
                entity_lookup,
                raw_name,
                sender_name=sender_name,
                current=old_classification,
            )
            classification_cache[classification_key] = next_classification
        new_values = (
            entity["entity_type"],
            entity["entity_code"],
            entity["standard_name"],
            next_classification or old_classification,
        )
        if new_values == (old_type, old_code, old_name, old_classification):
            continue
        cur.execute(
            """
            UPDATE wholesale_detail_records
            SET entity_type = %s,
                entity_code = %s,
                standard_entity_name = %s,
                classification = %s
            WHERE id = %s
            """,
            (*new_values, detail_id),
        )
        updated += 1
    return {"scanned": len(rows), "updated": updated}


def recalculate_wholesale_references(cur):
    recalculation = {"entityReferences": reconcile_wholesale_entity_references(cur)}
    recalculation.update(recalculate_all_wholesale(cur))
    recalculation["weighReclassification"] = reclassify_weigh_wholesale_from_references(cur)
    return recalculation


def reconcile_wholesale_product_ids(cur):
    product_lookup = load_product_lookup(cur)
    targets = (
        ("wholesale_detail_records", "raw_product_name", "product_id"),
        ("wholesale_summary_records", "raw_product_name", "product_id"),
        ("contracts", "raw_product_name", "product_id"),
    )
    result = {}
    for table, name_column, id_column in targets:
        cur.execute(f"SELECT id, {name_column}, {id_column} FROM {table}")
        scanned = 0
        recognized = 0
        updated = 0
        for row_id, raw_name, old_product_id in cur.fetchall():
            scanned += 1
            product = lookup_product(product_lookup, raw_name)
            if not product:
                continue
            recognized += 1
            if old_product_id != product["id"]:
                cur.execute(f"UPDATE {table} SET {id_column} = %s WHERE id = %s", (product["id"], row_id))
                updated += 1
        result[table] = {"scanned": scanned, "recognized": recognized, "updated": updated}
    return result

def review_detail_rows(cur, start, end, kind):
    where = ["d.business_date >= %s", "d.business_date < %s"]
    params = [start, end]
    if kind == "pending":
        where.append("d.match_status <> 'matched'")
    elif kind == "contract":
        where.append("d.classification IN ('export_wholesale', 'local_wholesale', 'unknown')")
    elif kind == "weigh":
        where.append("d.batch_id IS NULL")
        where.append("d.audit_status = 'pending'")
    weigh_fields = ", d.audit_status, d.weigh_source" if kind == "weigh" else ""
    query = f"""
        SELECT
            d.id,
            d.batch_id,
            d.business_date,
            d.raw_entity_name,
            d.standard_entity_name,
            d.entity_type,
            d.entity_code,
            d.raw_product_name,
            p.product_code,
            p.display_name,
            d.classification,
            d.weight_tons,
            d.match_status,
            c.contract_no,
            c.effective_start,
            c.effective_end,
            cr.amount_cny
            {weigh_fields}
        FROM wholesale_detail_records d
        LEFT JOIN products p ON p.id = d.product_id
        LEFT JOIN contracts c ON c.id = d.contract_id
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE {" AND ".join(where)}
        ORDER BY
            CASE d.match_status WHEN 'needs_review' THEN 0 WHEN 'unmatched' THEN 1 ELSE 2 END,
            d.business_date DESC,
            d.id DESC
        LIMIT 300
    """
    cur.execute(query, params)
    rows = []
    for row in cur.fetchall():
        item = {
            "id": row[0],
            "batchId": row[1],
            "date": row[2].isoformat() if row[2] else None,
            "entity": row[3],
            "standardEntity": row[4],
            "entityType": row[5],
            "entityCode": row[6],
            "product": row[7],
            "productCode": row[8],
            "standardProduct": row[9],
            "classification": row[10],
            "tons": round(float(row[11] or 0), 3),
            "matchStatus": row[12],
            "contractNo": row[13],
            "effectiveStart": row[14].isoformat() if row[14] else None,
            "effectiveEnd": row[15].isoformat() if row[15] else None,
            "amountCny": round(float(row[16] or 0), 2),
        }
        if kind == "weigh":
            item["auditStatus"] = row[17]
            item["weighSource"] = row[18]
        rows.append(item)
    return rows

def review_issue_rows(cur, start, end):
    cur.execute(
        """
        SELECT
            qi.id,
            qi.issue_type,
            qi.severity,
            qi.issue_date,
            qi.message,
            qi.related_table,
            qi.related_id,
            d.raw_entity_name,
            d.raw_product_name,
            d.classification,
            d.match_status,
            d.vehicle_no,
            d.weight_tons
        FROM data_quality_issues qi
        LEFT JOIN wholesale_detail_records d
          ON qi.related_table = 'wholesale_detail_records'
         AND d.id = qi.related_id
        WHERE qi.status = 'open'
          AND (qi.issue_date IS NULL OR (qi.issue_date >= %s AND qi.issue_date < %s))
        ORDER BY
          CASE qi.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          qi.issue_date DESC,
          qi.id DESC
        LIMIT 300
        """,
        (start, end),
    )
    return [
        {
            "id": row[0],
            "issueType": row[1],
            "severity": row[2],
            "date": row[3].isoformat() if row[3] else None,
            "message": row[4],
            "relatedTable": row[5],
            "detailId": row[6],
            "entity": row[7],
            "product": row[8],
            "classification": row[9],
            "matchStatus": row[10],
            "vehicleNo": row[11],
            "tons": round(float(row[12] or 0), 3),
        }
        for row in cur.fetchall()
    ]


PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = PROJECT_ROOT.parent / "OilStation"
SHARED_ASSETS_ROOT = PROJECT_ROOT.parent / "assets"
FRONTEND_DIST = PROJECT_ROOT.parent / "frontend" / "dist"
UPLOAD_ROOT = PROJECT_ROOT / "uploads"

STATION_STATUS_TYPES = {
    "normal": "正常营业",
    "power_outage": "停电",
    "maintenance": "设备故障",
    "renovation": "装修/维修",
    "suspended": "暂停营业",
    "road_blocked": "修路占道",
    "data_anomaly": "数据异常",
}


def retail_station_constants():
    spec = importlib.util.spec_from_file_location(
        "sales_oilstation_constants",
        OILSTATION_ROOT / "constants.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def retail_station_catalog():
    module = retail_station_constants()
    return {
        int(shop_key): {
            "shopKey": int(shop_key),
            "name": info.get("name", ""),
            "short": info.get("short", ""),
            "region": info.get("region", ""),
        }
        for shop_key, info in module.SHOP_KEY_MAP.items()
    }


def retail_station_force_normal_keys():
    module = retail_station_constants()
    return {
        int(shop_key)
        for shop_key in (getattr(module, "FORCE_NORMAL_STATIONS", set()) or set())
    }


def retail_station_catalog_cached():
    if not hasattr(retail_station_catalog_cached, "_cache"):
        retail_station_catalog_cached._cache = retail_station_catalog()
    return retail_station_catalog_cached._cache


def active_station_statuses(cur):
    ensure_station_status_schema(cur)
    cur.execute(
        """
        SELECT id, shop_key, status_type, status_label, started_at, expected_resume_at,
               ended_at, affects_sales, affects_inventory, suppress_alerts, note, is_active
        FROM retail_station_status
        WHERE is_active = TRUE AND ended_at IS NULL
          AND status_type <> 'normal'
        ORDER BY shop_key, started_at DESC, id DESC
        """
    )
    catalog = retail_station_catalog()
    force_normal = retail_station_force_normal_keys()
    statuses = {}
    for row in cur.fetchall():
        shop_key = int(_column_value(row, 1, "shop_key"))
        if shop_key in force_normal:
            continue
        if shop_key in statuses:
            continue
        station = catalog.get(shop_key, {"name": f"Station-{shop_key}", "short": "", "region": ""})
        status_type = _column_value(row, 2, "status_type")
        affects_sales = bool(_column_value(row, 7, "affects_sales"))
        public_status = "normal" if status_type == "normal" else ("closed" if affects_sales else "warning")
        note = _column_value(row, 10, "note") or ""
        status_label = _column_value(row, 3, "status_label")
        reason = "" if status_type == "normal" else (note or status_label or STATION_STATUS_TYPES.get(status_type, status_type))
        started_at = _column_value(row, 4, "started_at")
        expected_resume_at = _column_value(row, 5, "expected_resume_at")
        ended_at = _column_value(row, 6, "ended_at")
        statuses[shop_key] = {
            "id": _column_value(row, 0, "id"),
            "shopKey": shop_key,
            "name": station["name"],
            "short": station["short"],
            "region": station["region"],
            "status": public_status,
            "statusType": status_type,
            "statusLabel": status_label,
            "closedReason": reason,
            "note": note,
            "startedAt": started_at.isoformat() if started_at else None,
            "expectedResumeAt": expected_resume_at.isoformat() if expected_resume_at else None,
            "endedAt": ended_at.isoformat() if ended_at else None,
            "affectsSales": affects_sales,
            "affectsInventory": bool(_column_value(row, 8, "affects_inventory")),
            "suppressAlerts": bool(_column_value(row, 9, "suppress_alerts")),
            "isActive": bool(_column_value(row, 11, "is_active")),
        }
    return statuses


def apply_station_status(item, statuses):
    if not isinstance(item, dict):
        return item
    shop_key = item.get("shopKey")
    if shop_key is None:
        return item
    status = statuses.get(int(shop_key))
    if not status:
        return item
    item["status"] = status["status"]
    item["statusType"] = status["statusType"]
    item["statusLabel"] = status["statusLabel"]
    item["closedReason"] = status["closedReason"]
    item["affectsSales"] = status["affectsSales"]
    item["affectsInventory"] = status["affectsInventory"]
    item["suppressAlerts"] = status["suppressAlerts"]
    item["statusNote"] = status["note"]
    item["expectedResumeAt"] = status["expectedResumeAt"]
    return item


def enrich_retail_station_statuses(payload):
    if not isinstance(payload, dict):
        return payload
    conn = get_connection()
    try:
        cur = conn.cursor()
        statuses = active_station_statuses(cur)
    finally:
        conn.close()

    def sync_station(item):
        if not isinstance(item, dict):
            return item
        shop_key = item.get("shopKey")
        if shop_key is None:
            return item
        if int(shop_key) in statuses:
            return apply_station_status(item, statuses)
        item["status"] = "normal"
        item["statusType"] = "normal"
        item["statusLabel"] = "正常营业"
        item["closedReason"] = ""
        item["affectsSales"] = False
        item["affectsInventory"] = False
        item["suppressAlerts"] = False
        item["statusNote"] = ""
        item["expectedResumeAt"] = None
        return item

    if "stations" in payload:
        if isinstance(payload["stations"], list):
            payload["stations"] = [sync_station(item) for item in payload["stations"]]
        elif isinstance(payload["stations"], dict):
            for rows in payload["stations"].values():
                if isinstance(rows, list):
                    for item in rows:
                        sync_station(item)
    if "shopKey" in payload:
        sync_station(payload)
    payload["stationStatuses"] = list(statuses.values())
    return payload


def market_region_label(value):
    return {
        "Russia": "俄罗斯",
        "Uzbekistan": "乌兹别克",
        "Global": "国际",
    }.get(value, value or "国际")


def market_type_label(value):
    return {
        "crude": "原料油",
        "refined": "成品油",
        "policy": "政策",
        "logistics": "物流",
        "other": "其他",
    }.get(value, value or "其他")


def market_watch_rows(cur, limit=80):
    ensure_market_watch_schema(cur)
    cur.execute(
        """
        SELECT id, market_region, market_type, title, summary,
               price_text, source_name, source_url, observed_at, priority, is_active, created_at
        FROM market_watch_items
        WHERE market_region IN ('Russia', 'Uzbekistan', 'Global')
        ORDER BY observed_at DESC, priority ASC, id DESC
        LIMIT %s
        """,
        (limit,),
    )
    return [
        {
            "id": row[0],
            "region": row[1],
            "regionLabel": market_region_label(row[1]),
            "type": row[2],
            "typeLabel": market_type_label(row[2]),
            "title": row[3],
            "summary": row[4],
            "priceText": row[5] or "",
            "sourceName": row[6] or "",
            "sourceUrl": row[7] or "",
            "observedAt": row[8].isoformat() if row[8] else None,
            "priority": row[9],
            "isActive": bool(row[10]),
            "createdAt": row[11].isoformat() if row[11] else None,
        }
        for row in cur.fetchall()
    ]


def import_source_label(source_type):
    return {
        "export_sales_excel": "外运外销表",
        "contract_excel": "合同登记表",
        "manual": "人工录入",
    }.get(source_type, source_type or "--")

