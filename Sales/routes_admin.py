from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import wraps
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import xml.etree.ElementTree as ET
import pandas as pd
from flask import jsonify, request, send_file
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash
from pymysql.err import IntegrityError

from shared_utils import (
    admin_required, log_operation, log_system_operation, session_user,
    recalculate_all_wholesale, recalculate_wholesale_references, reconcile_wholesale_product_ids,
    record_automation_task, ensure_auth_schema, ensure_market_watch_schema,
    ensure_operation_log_schema, ensure_automation_task_schema,
    ensure_station_status_schema, PROJECT_ROOT, OILSTATION_ROOT,
    STATION_STATUS_TYPES, retail_station_catalog,
    market_watch_rows, import_source_label,
    REFRESH_CACHE_STATUS, REFRESH_CACHE_LOCK,
)
from calculations import recalculate_wholesale_batch
from routes_data import run_exchange_maintenance, run_market_watch_maintenance
from summary_service import period_bounds
from db import get_connection
from import_helpers import (
    can_auto_approve_weigh_detail,
    classify_wholesale_movement,
    format_lpg_remark,
    get_or_create_customer,
    load_entity_lookup,
    load_product_lookup,
    lookup_entity,
    lookup_product,
)
from retail_internal import open_oilstation
from summary_service import available_periods, period_bounds
from text_utils import clean_str, normalize_station_name, normalize_text, parse_date, parse_decimal
from wholesale_service import exchange_rates
from wholesale_source_policy import (
    WHOLESALE_SOURCE_CUTOFF,
    clamp_weighing_detail_range,
)

WEIGH_COLUMNS = ["序号", "编号", "卡号", "车号", "服务区域", "运输单位", "发货单位",
    "收货单位", "货名", "规格", "毛重", "皮重", "净重", "扣重", "实重",
    "单价", "金额", "过磅费", "毛重司磅员", "皮重司磅员",
    "毛重日期", "毛重时间", "皮重日期", "皮重时间", "备注",
    "发货车辆", "作废", "上传"]
WEIGH_TEXT_COLUMNS = {
    "编号", "卡号", "车号", "服务区域", "运输单位", "发货单位", "收货单位",
    "货名", "规格", "毛重司磅员", "皮重司磅员", "毛重时间", "皮重时间",
    "备注", "发货车辆",
}

CUSTOMER_TYPES = {"local_wholesale", "export_wholesale", "unknown"}
WEIGH_SOURCE_STORAGE = "储运区"
WEIGH_SOURCE_LPG = "液化气罐区"
WEIGH_SOURCE_OPTIONS = (WEIGH_SOURCE_STORAGE, WEIGH_SOURCE_LPG)
WEIGH_SOURCE_ALIASES = {
    "": None,
    "储运区": WEIGH_SOURCE_STORAGE,
    "kj_weighing": WEIGH_SOURCE_STORAGE,
    "storage_district": WEIGH_SOURCE_STORAGE,
    "storagedistrict": WEIGH_SOURCE_STORAGE,
    "液化气罐区": WEIGH_SOURCE_LPG,
    "lpg": WEIGH_SOURCE_LPG,
    "lpg_weighing": WEIGH_SOURCE_LPG,
    "lpg_storage": WEIGH_SOURCE_LPG,
}


def _normalize_customer_type(value):
    return value if value in CUSTOMER_TYPES else "unknown"


def _json_text(column, key):
    return f"NULLIF(JSON_UNQUOTE(JSON_EXTRACT({column}, '$.{key}')), '')"


def _json_text_when_valid(column, key):
    return f"CASE WHEN JSON_VALID({column}) THEN {_json_text(column, key)} ELSE NULL END"


def _text_expr(expression):
    return f"{expression} COLLATE utf8mb4_unicode_ci"


def _null_text_expr():
    return _text_expr("CAST(NULL AS CHAR)")


def _kj_weigh_column_sql(alias="kj"):
    cols = []
    for col in WEIGH_COLUMNS:
        source = f"{alias}.`{col}`"
        if col == "毛重日期":
            cols.append(f"COALESCE(NULLIF({source}, '0000-00-00 00:00:00'), {alias}.`皮重日期`) AS `{col}`")
            continue
        if col in WEIGH_TEXT_COLUMNS:
            cols.append(f"{_text_expr(source)} AS `{col}`")
        else:
            cols.append(f"{source} AS `{col}`")
    return ", ".join(cols)


def _normalize_weigh_source_values(*values):
    selected = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            tokens = value
        else:
            tokens = str(value).split(",")
        for token in tokens:
            raw = str(token or "").strip()
            key = raw.lower()
            normalized = WEIGH_SOURCE_ALIASES.get(raw) or WEIGH_SOURCE_ALIASES.get(key)
            if normalized and normalized not in selected:
                selected.append(normalized)
    return selected


def _weigh_records_union_sql():
    kj_cols = _kj_weigh_column_sql()
    lpg_remark_text = _text_expr("NULLIF(lpg.remark, '')")
    storage_source = _text_expr(f"'{WEIGH_SOURCE_STORAGE}'")
    lpg_source = _text_expr(f"'{WEIGH_SOURCE_LPG}'")
    return f"""
        SELECT {storage_source} AS weigh_source, {kj_cols}, sync_date
        FROM kj_weighing kj
        WHERE (kj.`作废` IS NULL OR kj.`作废` = 0)
        UNION ALL
        SELECT
            {lpg_source} AS weigh_source,
            lpg.id AS `序号`,
            {_text_expr('lpg.weigh_serial_no')} AS `编号`,
            {_null_text_expr()} AS `卡号`,
            {_text_expr('lpg.vehicle_no')} AS `车号`,
            {_null_text_expr()} AS `服务区域`,
            {_null_text_expr()} AS `运输单位`,
            {_text_expr('lpg.sender_name')} AS `发货单位`,
            {_text_expr('lpg.receiver_name')} AS `收货单位`,
            {_text_expr('lpg.raw_product_name')} AS `货名`,
            {_text_expr(_json_text_when_valid('lpg.remark', 'spec_or_trailer'))} AS `规格`,
            lpg.gross_weight AS `毛重`,
            lpg.tare_weight AS `皮重`,
            lpg.net_weight AS `净重`,
            NULL AS `扣重`,
            lpg.net_weight AS `实重`,
            NULL AS `单价`,
            NULL AS `金额`,
            NULL AS `过磅费`,
            {_text_expr(_json_text_when_valid('lpg.remark', 'operator'))} AS `毛重司磅员`,
            {_text_expr(_json_text_when_valid('lpg.remark', 'tare_operator'))} AS `皮重司磅员`,
            lpg.business_date AS `毛重日期`,
            {_text_expr(_json_text_when_valid('lpg.remark', 'gross_time'))} AS `毛重时间`,
            {_json_text_when_valid('lpg.remark', 'tare_date')} AS `皮重日期`,
            {_text_expr(_json_text_when_valid('lpg.remark', 'tare_time'))} AS `皮重时间`,
            {lpg_remark_text} AS `备注`,
            {_null_text_expr()} AS `发货车辆`,
            0 AS `作废`,
            NULL AS `上传`,
            lpg.business_date AS sync_date
        FROM lpg_weighing lpg
    """


def _split_filter_values(value):
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _lookup_standard_name(lookup, value):
    match = lookup_entity(lookup, value or "")
    return match.get("standard_name") if match else None


def _lookup_standard_product(lookup, value):
    match = lookup_product(lookup, value or "")
    return match.get("display_name") if match else None


def _decorate_weigh_record(item, entity_lookup, product_lookup):
    raw_sender = item.get("发货单位") or ""
    raw_receiver = item.get("收货单位") or ""
    raw_product = item.get("货名") or ""
    standard_sender = _lookup_standard_name(entity_lookup, raw_sender)
    standard_receiver = _lookup_standard_name(entity_lookup, raw_receiver)
    standard_product = _lookup_standard_product(product_lookup, raw_product)
    item["原发货单位"] = raw_sender
    item["原收货单位"] = raw_receiver
    item["原货名"] = raw_product
    item["标准发货单位"] = standard_sender
    item["标准收货单位"] = standard_receiver
    item["标准货名"] = standard_product
    item["发货单位显示"] = standard_sender or raw_sender
    item["收货单位显示"] = standard_receiver or raw_receiver
    item["货名显示"] = standard_product or raw_product
    item["发货单位"] = item["发货单位显示"]
    item["收货单位"] = item["收货单位显示"]
    item["货名"] = item["货名显示"]
    if item.get("weigh_source") == WEIGH_SOURCE_LPG:
        item["备注"] = format_lpg_remark(item.get("备注"))
    return item


def _weigh_item_text(item, *keys):
    return " ".join(str(item.get(key) or "") for key in keys).lower()


def _matches_any_value(item, values, *keys):
    if not values:
        return True
    candidates = {str(item.get(key) or "").strip() for key in keys}
    return bool(candidates.intersection(values))


def register_admin_routes(app):
    """Register admin routes."""

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

    @app.route("/api/admin/users")
    @admin_required
    def api_admin_users():
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_auth_schema(cur)
            cur.execute(
                """
                SELECT id, username, display_name, role, is_active, must_change_password, created_at, last_login_at
                FROM system_users
                ORDER BY id
                """
            )
            rows = [
                {
                    "id": row[0],
                    "username": row[1],
                    "displayName": row[2],
                    "role": row[3],
                    "isActive": bool(row[4]),
                    "mustChangePassword": bool(row[5]),
                    "createdAt": row[6].isoformat() if row[6] else None,
                    "lastLoginAt": row[7].isoformat() if row[7] else None,
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": rows})
        finally:
            conn.close()


    @app.route("/api/admin/users", methods=["POST"])
    @admin_required
    def api_admin_create_user():
        payload = request.get_json(force=True)
        username = clean_str(payload.get("username"))
        password = payload.get("password") or ""
        display_name = clean_str(payload.get("displayName")) or username
        role = payload.get("role") if payload.get("role") in ("admin", "user") else "user"
        if password and len(password) < 8:
            return jsonify({"error": "密码长度不能少于8位"}), 400
        if not username or len(password) < 6:
            return jsonify({"error": "用户名和至少 6 位密码必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_auth_schema(cur)
            cur.execute(
                """
                INSERT INTO system_users
                    (username, password_hash, display_name, role, created_by, must_change_password, password_reset_at)
                VALUES (%s, %s, %s, %s, %s, TRUE, CURRENT_TIMESTAMP)
                """,
                (username, generate_password_hash(password), display_name, role, (session_user() or {}).get("id")),
            )
            user_id = cur.lastrowid
            log_operation(cur, "create_user", "system_users", user_id, {"username": username, "role": role})
            conn.commit()
            return jsonify({"ok": True, "id": user_id})
        except IntegrityError as exc:
            conn.rollback()
            if exc.args and exc.args[0] == 1062:
                return jsonify({"error": "用户名已存在，请更换用户名"}), 409
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()



    @app.route("/api/admin/retail-station-statuses")
    @admin_required
    def api_admin_retail_station_statuses():
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_station_status_schema(cur)
            catalog = retail_station_catalog()
            cur.execute(
                """
                SELECT id, shop_key, status_type, status_label, started_at, expected_resume_at,
                       ended_at, affects_sales, affects_inventory, suppress_alerts, note, is_active,
                       created_at, updated_at
                FROM retail_station_status
                WHERE NOT (status_type = 'normal' AND is_active = TRUE AND ended_at IS NULL)
                ORDER BY is_active DESC, ended_at IS NULL DESC, shop_key, started_at DESC, id DESC
                """
            )
            items = []
            for row in cur.fetchall():
                station = catalog.get(int(row[1]), {"name": f"Station-{row[1]}", "short": "", "region": ""})
                items.append({
                    "id": row[0],
                    "shopKey": int(row[1]),
                    "name": station["name"],
                    "short": station["short"],
                    "region": station["region"],
                    "statusType": row[2],
                    "statusLabel": row[3],
                    "startedAt": row[4].isoformat() if row[4] else None,
                    "expectedResumeAt": row[5].isoformat() if row[5] else None,
                    "endedAt": row[6].isoformat() if row[6] else None,
                    "affectsSales": bool(row[7]),
                    "affectsInventory": bool(row[8]),
                    "suppressAlerts": bool(row[9]),
                    "note": row[10] or "",
                    "isActive": bool(row[11]),
                    "createdAt": row[12].isoformat() if row[12] else None,
                    "updatedAt": row[13].isoformat() if row[13] else None,
                })
            return jsonify({"items": items, "statusTypes": STATION_STATUS_TYPES})
        finally:
            conn.close()


    @app.route("/api/admin/market-watch")
    @admin_required
    def api_admin_market_watch():
        conn = get_connection()
        try:
            cur = conn.cursor()
            return jsonify({"items": market_watch_rows(cur)})
        finally:
            conn.close()


    @app.route("/api/admin/market-watch", methods=["POST"])
    @admin_required
    def api_admin_save_market_watch():
        payload = request.get_json(force=True)
        title = clean_str(payload.get("title"))
        summary = clean_str(payload.get("summary"))
        observed_at = parse_date(payload.get("observedAt")) or date.today()
        region = payload.get("region") if payload.get("region") in {"Russia", "Uzbekistan", "Global"} else "Global"
        market_type = payload.get("type") if payload.get("type") in {"crude", "refined", "policy", "logistics", "other"} else "other"
        source_name = clean_str(payload.get("sourceName"))
        source_url = clean_str(payload.get("sourceUrl"))
        price_text = clean_str(payload.get("priceText"))
        priority = int(payload.get("priority") or 100)
        if not title or not summary:
            return jsonify({"error": "标题和摘要必填"}), 400
        if market_type == "refined" and price_text and "索姆/升" not in price_text:
            return jsonify({"error": "成品油价格请统一按索姆/升录入"}), 400

        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_market_watch_schema(cur)
            cur.execute(
                """
                INSERT INTO market_watch_items
                    (market_region, market_type, title, summary, price_text, source_name, source_url, observed_at, priority, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                """,
                (region, market_type, title, summary, price_text, source_name, source_url, observed_at, priority),
            )
            item_id = cur.lastrowid
            log_operation(cur, "save_market_watch", "market_watch_items", item_id, {"title": title})
            conn.commit()
            return jsonify({"ok": True, "id": item_id})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/market-watch/fetch", methods=["POST"])
    @admin_required
    def api_admin_fetch_market_watch():
        conn = get_connection()
        try:
            cur = conn.cursor()
            result = run_market_watch_maintenance(cur)
            log_operation(cur, "fetch_market_watch", "market_watch_items", None, result)
            record_automation_task(cur, "market_watch", "success" if not result["errors"] else "failed", result, "; ".join(result["errors"]) or None)
            conn.commit()
            return jsonify({"ok": True, **result, "items": market_watch_rows(cur, 20)})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/automation-tasks")
    @admin_required
    def api_admin_automation_tasks():
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_automation_task_schema(cur)
            cur.execute(
                """
                SELECT r.id, r.task_name, r.status, r.started_at, r.finished_at, r.summary, r.error
                FROM automation_task_runs r
                JOIN (
                    SELECT task_name, MAX(id) AS id
                    FROM automation_task_runs
                    GROUP BY task_name
                ) latest ON latest.id = r.id
                ORDER BY r.task_name
                """
            )
            latest = [
                {
                    "id": row[0],
                    "taskName": row[1],
                    "status": row[2],
                    "startedAt": row[3].isoformat() if row[3] else None,
                    "finishedAt": row[4].isoformat() if row[4] else None,
                    "summary": json.loads(row[5] or "{}"),
                    "error": row[6] or "",
                }
                for row in cur.fetchall()
            ]
            cur.execute(
                """
                SELECT id, task_name, status, started_at, finished_at, summary, error
                FROM automation_task_runs
                ORDER BY id DESC
                LIMIT 40
                """
            )
            recent = [
                {
                    "id": row[0],
                    "taskName": row[1],
                    "status": row[2],
                    "startedAt": row[3].isoformat() if row[3] else None,
                    "finishedAt": row[4].isoformat() if row[4] else None,
                    "summary": json.loads(row[5] or "{}"),
                    "error": row[6] or "",
                }
                for row in cur.fetchall()
            ]
            return jsonify({"latest": latest, "recent": recent})
        finally:
            conn.close()


    @app.route("/api/admin/automation-tasks/run", methods=["POST"])
    @admin_required
    def api_admin_run_automation_task():
        payload = request.get_json(force=True)
        task = payload.get("task")
        if task not in {"exchange_rates", "market_watch", "retail_snapshots", "all"}:
            return jsonify({"error": "请选择有效的自动任务"}), 400

        conn = get_connection()
        try:
            cur = conn.cursor()
            results = {}
            if task in {"exchange_rates", "all"}:
                result = run_exchange_maintenance(cur)
                status = "success" if not result["errors"] else "failed"
                record_automation_task(cur, "exchange_rates", status, result, json.dumps(result["errors"], ensure_ascii=False) if result["errors"] else None)
                results["exchangeRates"] = result
            if task in {"market_watch", "all"}:
                result = run_market_watch_maintenance(cur)
                status = "success" if not result["errors"] else "failed"
                record_automation_task(cur, "market_watch", status, result, "; ".join(result["errors"]) or None)
                results["marketWatch"] = result
            if task in {"retail_snapshots", "all"}:
                result = _queue_retail_cache_refresh()
                results["retailSnapshots"] = result
            log_operation(cur, "run_automation_task", "automation_task_runs", task, results)
            conn.commit()
            return jsonify({"ok": True, "results": results})
        except Exception as exc:
            conn.rollback()
            try:
                cur = conn.cursor()
                record_automation_task(cur, task if task != "all" else "automation_all", "failed", {}, str(exc))
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        finally:
            conn.close()

    @app.route("/api/admin/weigh/auto-audit", methods=["POST"])
    @admin_required
    def api_admin_weigh_auto_audit():
        payload = request.get_json(force=True)
        year = int(payload.get("year", str(date.today().year)))
        month = payload.get("month")
        conn = get_connection()
        try:
            cur = conn.cursor()
            start, end = period_bounds(year, month)
            cur.execute("""
                UPDATE wholesale_detail_records
                SET audit_status = 'approved', match_status = 'matched'
                WHERE audit_status = 'pending'
                  AND batch_id IS NULL
                  AND product_id IS NOT NULL
                  AND entity_code IS NOT NULL
                  AND classification NOT IN ('unknown', '')
                  AND business_date >= %s AND business_date < %s
            """, (start, end))
            conn.commit()
            updated = cur.rowcount
            cur.execute("""
                SELECT COUNT(*) FROM wholesale_detail_records
                WHERE audit_status = 'pending' AND batch_id IS NULL
                  AND business_date >= %s AND business_date < %s
            """, (start, end))
            remaining = cur.fetchone()[0]
            return jsonify({"ok": True, "updated": updated, "remaining": remaining})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()



    def _health_file_info(path):
        path = Path(path)
        if not path.exists():
            return {"exists": False, "size": 0, "updatedAt": None}
        stat = path.stat()
        return {
            "exists": True,
            "size": stat.st_size,
            "updatedAt": date.fromtimestamp(stat.st_mtime).isoformat(),
        }


    def _health_month_iter(start_ym, end_ym):
        year, month = [int(part) for part in start_ym.split("-")]
        end_year, end_month = [int(part) for part in end_ym.split("-")]
        while (year, month) <= (end_year, end_month):
            yield f"{year}-{month:02d}"
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1


    def _health_completed_month():
        today = date.today()
        year, month = today.year, today.month - 1
        if month == 0:
            year -= 1
            month = 12
        return f"{year}-{month:02d}"


    def _health_report_snapshot_status():
        completed_day = date.today() - timedelta(days=1)
        active_ym = f"{completed_day.year}-{completed_day.month:02d}"
        report_dir = OILSTATION_ROOT / "cache_snapshots" / "report_extras"
        # 仅检查最近 3 个月，历史月份快照非必需
        start_dt = completed_day.replace(day=1) - timedelta(days=60)
        start_ym = f"{start_dt.year}-{start_dt.month:02d}"
        end_ym = active_ym
        expected = list(_health_month_iter(start_ym, end_ym))
        missing = [
            ym for ym in expected
            if not (report_dir / ym.split("-")[0] / f"report_extras_{int(ym.split('-')[1]):02d}.json").exists()
        ]
        files = list(report_dir.rglob("report_extras_*.json")) if report_dir.exists() else []
        day_dir = OILSTATION_ROOT / "cache_snapshots" / "daily"
        day_start = date(completed_day.year, completed_day.month, 1)
        day_end = completed_day
        day_expected = []
        cursor = day_start
        while cursor <= day_end:
            day_expected.append(cursor.isoformat())
            cursor += timedelta(days=1)
        day_missing = [
            item for item in day_expected
            if not (day_dir / item[:4] / item[5:7] / f"day_{int(item[8:10]):02d}.json").exists()
        ]
        day_files = [
            path for item in day_expected
            if (path := day_dir / item[:4] / item[5:7] / f"day_{int(item[8:10]):02d}.json").exists()
        ] if day_dir.exists() else []
        current_ym = active_ym
        report_ym = active_ym
        monthly_dir = OILSTATION_ROOT / "cache_snapshots" / "monthly"
        current_files = {
            prefix: _health_file_info(monthly_dir / current_ym.split("-")[0] / f"{prefix}_{int(current_ym.split('-')[1]):02d}.json")
            for prefix in ("monthly", "stations", "regions", "daily")
        }
        report_workbook = {"exists": False, "file": None, "lastNonemptyDay": None, "updatedAt": None, "size": 0}
        report_index_path = OILSTATION_ROOT / "exports" / ".monthly_report_index.json"
        try:
            report_index = json.loads(report_index_path.read_text(encoding="utf-8-sig")) if report_index_path.exists() else {}
            report_item = report_index.get(report_ym) or {}
            report_file = report_item.get("file")
            report_stored_path = report_item.get("path") or report_file
            report_path = OILSTATION_ROOT / "exports" / report_stored_path if report_stored_path else None
            if report_path and report_path.exists():
                info = _health_file_info(report_path)
                report_workbook.update({
                    "exists": True,
                    "month": report_ym,
                    "file": report_file,
                    "lastNonemptyDay": report_item.get("lastNonemptyDay"),
                    "updatedAt": info.get("updatedAt"),
                    "size": info.get("size", 0),
                })
        except (OSError, json.JSONDecodeError):
            pass
        profit_snapshots = _health_profit_snapshot_status(active_ym)
        return {
            "expectedStart": start_ym,
            "expectedEnd": end_ym,
            "expectedCount": len(expected),
            "actualCount": len(files),
            "missing": missing,
            "dailyExpectedStart": day_start.isoformat(),
            "dailyExpectedEnd": day_end.isoformat() if day_expected else None,
            "dailyExpectedCount": len(day_expected),
            "dailyActualCount": len(day_files),
            "dailyMissing": day_missing,
            "currentMonth": current_ym,
            "currentMonthFiles": current_files,
            "reportWorkbook": report_workbook,
            "profitSnapshots": profit_snapshots,
        }


    def _health_profit_snapshot_status(active_ym):
        year = active_ym.split("-", 1)[0]
        expected = [
            ("month", active_ym, "月度利润快照", {"summary", "stations"}),
            ("year", year, "年度利润总表快照", {"summary", "months"}),
        ]
        rows = {}
        query_error = None
        try:
            conn = get_connection()
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    SELECT snapshot_type, period_key, payload_json, generated_at
                    FROM profit_report_snapshots
                    WHERE (snapshot_type=%s AND period_key=%s)
                       OR (snapshot_type=%s AND period_key=%s)
                    """,
                    ("month", active_ym, "year", year),
                )
                rows = {
                    (str(row[0]), str(row[1])): row
                    for row in cur.fetchall()
                }
            finally:
                conn.close()
        except Exception as exc:
            query_error = exc.__class__.__name__

        items = []
        for snapshot_type, period_key, label, required_keys in expected:
            item = {
                "type": snapshot_type,
                "period": period_key,
                "label": label,
                "exists": False,
                "valid": False,
                "generatedAt": None,
                "size": 0,
                "missingKeys": [],
                "error": query_error,
            }
            row = rows.get((snapshot_type, period_key))
            if not row:
                item["error"] = query_error or "missing"
                items.append(item)
                continue
            payload_text = row[2] or ""
            item["exists"] = True
            item["size"] = len(str(payload_text).encode("utf-8"))
            generated_at = row[3]
            item["generatedAt"] = generated_at.isoformat(sep=" ") if hasattr(generated_at, "isoformat") else generated_at
            try:
                payload = json.loads(payload_text)
                missing = sorted(required_keys - set(payload.keys())) if isinstance(payload, dict) else sorted(required_keys)
                item["missingKeys"] = missing
                item["valid"] = not missing
                item["error"] = "" if item["valid"] else "missing_keys"
            except (TypeError, json.JSONDecodeError) as exc:
                item["error"] = exc.__class__.__name__
            items.append(item)
        return {
            "month": active_ym,
            "year": year,
            "ok": all(item["exists"] and item["valid"] for item in items),
            "missing": [item["label"] for item in items if not item["exists"] or not item["valid"]],
            "items": items,
        }


    def _task_latest_record(automation_records, task_name):
        mapping = {
            "SalesVisualizationDailyExchangeRates": "exchange_rates",
            "SalesVisualizationDailyMarketWatch": "market_watch",
            "SalesVisualizationDailyRetailSnapshots": "retail_snapshots",
        }
        automation_name = mapping.get(task_name)
        if not automation_name:
            return None
        for item in automation_records or []:
            if item.get("taskName") == automation_name:
                return item
        return None


    def _health_task_fallback(task_name, detail, automation_records=None, service_running=True):
        if task_name == "SalesVisualizationProduction":
            return {
                "taskName": task_name,
                "ok": bool(service_running),
                "warning": True,
                "status": "服务运行中" if service_running else "服务需检查",
                "detail": f"计划任务读取受限；{detail}",
                "source": "service",
            }
        latest = _task_latest_record(automation_records, task_name)
        if not latest:
            return {
                "taskName": task_name,
                "ok": False,
                "warning": True,
                "status": "无执行记录",
                "detail": f"计划任务读取受限；{detail}",
                "source": "automation_log",
            }
        finished_at = latest.get("finishedAt") or latest.get("startedAt")
        is_success = latest.get("status") == "success"
        fresh = False
        if finished_at:
            try:
                finished_dt = datetime.fromisoformat(finished_at)
                fresh = datetime.now() - finished_dt <= timedelta(hours=36)
            except ValueError:
                fresh = False
        return {
            "taskName": task_name,
            "ok": bool(is_success and fresh),
            "warning": True,
            "status": "最近成功" if is_success and fresh else ("最近失败" if not is_success else "记录过期"),
            "detail": f"计划任务读取受限；最近记录 {finished_at or '--'}；{detail}",
            "source": "automation_log",
            "lastRunAt": finished_at,
        }


    def _health_task_status(task_name, automation_records=None, service_running=True):
        task_path = f"\\SalesVisualization\\{task_name}"
        try:
            completed = subprocess.run(
                ["schtasks", "/Query", "/TN", task_path, "/FO", "LIST"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return {"taskName": task_name, "ok": False, "status": "unknown", "detail": str(exc)}
        output = (completed.stdout or completed.stderr or "").strip()
        if completed.returncode != 0:
            detail = output.splitlines()[0] if output else "无法读取计划任务"
            return _health_task_fallback(task_name, detail, automation_records, service_running)
        status = "unknown"
        for line in output.splitlines():
            stripped = line.strip()
            if stripped.startswith("Status:") or stripped.startswith("状态:") or stripped.startswith("РЎС‚Р°С‚СѓСЃ:"):
                status = line.split(":", 1)[1].strip()
                break
        return {"taskName": task_name, "ok": True, "warning": False, "status": status, "detail": "", "source": "schtasks"}


    def _health_timed(label, fn):
        started = time.perf_counter()
        try:
            payload = fn()
            elapsed = int((time.perf_counter() - started) * 1000)
            return {"name": label, "ok": True, "elapsedMs": elapsed, "detail": payload}
        except Exception as exc:
            elapsed = int((time.perf_counter() - started) * 1000)
            return {"name": label, "ok": False, "elapsedMs": elapsed, "detail": str(exc)}


    def _current_month():
        today = date.today()
        return f"{today.year}-{today.month:02d}"


    def _refresh_retail_cache_worker():
        current_month = _current_month()
        steps = [
            {
                "label": "零售日快照与当前月汇总",
                "type": "command",
                "command": [
                    sys.executable,
                    str(OILSTATION_ROOT / "scripts" / "refresh_current_snapshots.py"),
                ],
                "cwd": str(OILSTATION_ROOT),
            },
            {"label": "年度总览预热", "type": "api", "path": "/api/dashboard/yearly", "query": f"year={date.today().year}"},
            {"label": "油品统计预热", "type": "api", "path": "/api/resources/yearly", "query": f"year={date.today().year}"},
            {"label": "月度快照预热", "type": "api", "path": f"/api/monthly/{current_month}", "query": ""},
            {"label": "站点快照预热", "type": "api", "path": f"/api/stations/{current_month}", "query": ""},
            {"label": "区域快照预热", "type": "api", "path": f"/api/regions/{current_month}", "query": ""},
            {"label": "日趋势快照预热", "type": "api", "path": f"/api/daily/{current_month}", "query": ""},
        ]
        items = []
        with REFRESH_CACHE_LOCK:
            REFRESH_CACHE_STATUS.update({
                "running": True,
                "startedAt": datetime.now().isoformat(timespec="seconds"),
                "finishedAt": None,
                "status": "running",
                "message": "正在刷新当前月缓存",
                "items": items,
            })
        try:
            for step in steps:
                started = time.perf_counter()
                item = {
                    "label": step["label"],
                    "path": step.get("path") or step.get("command", [""])[-1],
                    "query": step.get("query", ""),
                    "status": "running",
                    "elapsedMs": None,
                    "error": "",
                }
                items.append(item)
                if step["type"] == "command":
                    completed = subprocess.run(
                        step["command"],
                        cwd=step["cwd"],
                        capture_output=True,
                        text=True,
                        timeout=900,
                        check=False,
                    )
                    item["elapsedMs"] = int((time.perf_counter() - started) * 1000)
                    if completed.returncode:
                        item["status"] = "failed"
                        item["error"] = (completed.stderr or completed.stdout or "")[-1000:]
                    else:
                        item["status"] = "success"
                    continue
                response = open_oilstation(step["path"], query_string=step.get("query") or "")
                item["elapsedMs"] = int((time.perf_counter() - started) * 1000)
                if response.status_code >= 400:
                    item["status"] = "failed"
                    item["error"] = response.get_data(as_text=True)[:300]
                else:
                    item["status"] = "success"
            status = "success" if all(item["status"] == "success" for item in items) else "failed"
            message = "当前月缓存刷新完成" if status == "success" else "当前月缓存刷新存在失败项"
        except Exception as exc:
            status = "failed"
            message = str(exc)
            logging.exception("Retail cache refresh failed")
        with REFRESH_CACHE_LOCK:
            REFRESH_CACHE_STATUS.update({
                "running": False,
                "finishedAt": datetime.now().isoformat(timespec="seconds"),
                "status": status,
                "message": message,
                "items": items,
            })
        conn = get_connection()
        try:
            cur = conn.cursor()
            record_automation_task(
                cur,
                "retail_snapshots",
                status,
                {"items": items, "message": message},
                message if status == "failed" else None,
            )
            conn.commit()
        finally:
            conn.close()


    def _queue_retail_cache_refresh():
        with REFRESH_CACHE_LOCK:
            if REFRESH_CACHE_STATUS.get("running"):
                return {"status": "running", "message": "零售快照刷新正在后台运行"}
            REFRESH_CACHE_STATUS.update({
                "running": True,
                "startedAt": datetime.now().isoformat(timespec="seconds"),
                "finishedAt": None,
                "status": "queued",
                "message": "零售快照刷新已加入后台执行",
                "items": [],
            })
        thread = threading.Thread(target=_refresh_retail_cache_worker, name="retail-cache-refresh", daemon=True)
        thread.start()
        return {"status": "queued", "message": "零售快照刷新已加入后台执行"}


    @app.route("/api/admin/system-health")
    @admin_required
    def api_admin_system_health():
        checks = []
        checks.append(_health_timed("主项目服务", lambda: {"ok": True}))
        checks.append(_health_timed("零售嵌入接口", lambda: open_oilstation("/api/health").get_json(silent=True)))

        conn = get_connection()
        try:
            cur = conn.cursor()
            checks.append(_health_timed("销售数据库", lambda: (cur.execute("SELECT 1"), {"ok": True})[1]))
            ensure_automation_task_schema(cur)
            cur.execute(
                """
                SELECT task_name, status, started_at, finished_at, summary, error
                FROM automation_task_runs
                ORDER BY id DESC
                LIMIT 8
                """
            )
            automation = [
                {
                    "taskName": row[0],
                    "status": row[1],
                    "startedAt": row[2].isoformat() if row[2] else None,
                    "finishedAt": row[3].isoformat() if row[3] else None,
                    "summary": json.loads(row[4] or "{}"),
                    "error": row[5] or "",
                }
                for row in cur.fetchall()
            ]
            cur.execute(
                """
                SELECT rate_date, usd_kgs, cny_kgs, source, is_manual, fetched_at
                FROM exchange_rates
                WHERE rate_date <= CURDATE()
                ORDER BY rate_date DESC
                LIMIT 1
                """
            )
            rate_row = cur.fetchone()
            latest_exchange = {
                "date": rate_row[0].isoformat() if rate_row and rate_row[0] else None,
                "usdKgs": float(rate_row[1]) if rate_row and rate_row[1] is not None else None,
                "cnyKgs": float(rate_row[2]) if rate_row and rate_row[2] is not None else None,
                "source": rate_row[3] if rate_row else None,
                "isManual": bool(rate_row[4]) if rate_row else False,
                "fetchedAt": rate_row[5].isoformat() if rate_row and rate_row[5] else None,
            }
            ensure_market_watch_schema(cur)
            cur.execute(
                """
                SELECT observed_at, title, source_name, created_at
                FROM market_watch_items
                WHERE is_active = TRUE
                ORDER BY observed_at DESC, priority ASC, id DESC
                LIMIT 1
                """
            )
            market_row = cur.fetchone()
            latest_market = {
                "observedAt": market_row[0].isoformat() if market_row and market_row[0] else None,
                "title": market_row[1] if market_row else None,
                "sourceName": market_row[2] if market_row else None,
                "createdAt": market_row[3].isoformat() if market_row and market_row[3] else None,
            }
        finally:
            conn.close()

        snapshots = _health_report_snapshot_status()
        logs = []
        for path in (
            PROJECT_ROOT / "logs" / "production.log",
            PROJECT_ROOT / "logs" / "production-error.log",
            PROJECT_ROOT / "logs" / "daily_maintenance.log",
        ):
            info = _health_file_info(path)
            info["name"] = path.name
            if info["exists"]:
                text = path.read_text(encoding="utf-8", errors="ignore")[-2000:]
                lowered = text.lower()
                last_traceback = lowered.rfind("traceback")
                last_success = max(lowered.rfind("finished with success"), lowered.rfind("starting sales visualization"))
                info["hasTraceback"] = last_traceback != -1 and last_traceback > last_success
                info["tail"] = text.splitlines()[-8:]
            logs.append(info)

        service_running = all(item["ok"] for item in checks[:2])
        tasks = [
            _health_task_status("SalesVisualizationProduction", automation, service_running),
            _health_task_status("SalesVisualizationDailyExchangeRates", automation, service_running),
            _health_task_status("SalesVisualizationDailyMarketWatch", automation, service_running),
            _health_task_status("SalesVisualizationDailyRetailSnapshots", automation, service_running),
        ]
        security = {
            "runtimeSecret": (PROJECT_ROOT / ".runtime" / "secret_key.txt").exists(),
            "cookieSecure": bool(app.config.get("SESSION_COOKIE_SECURE")),
            "cookieHttpOnly": bool(app.config.get("SESSION_COOKIE_HTTPONLY")),
            "sameSite": app.config.get("SESSION_COOKIE_SAMESITE"),
        }
        ok = (
            all(item["ok"] for item in checks)
            and not snapshots["missing"]
            and not snapshots["dailyMissing"]
            and snapshots.get("profitSnapshots", {}).get("ok", True)
            and all(not item.get("hasTraceback") for item in logs)
            and all(item["ok"] for item in tasks)
        )
        return jsonify({
            "ok": ok,
            "generatedAt": date.today().isoformat(),
            "checks": checks,
            "snapshots": snapshots,
            "logs": logs,
            "tasks": tasks,
            "automation": automation,
            "security": security,
            "latestExchange": latest_exchange,
            "latestMarket": latest_market,
            "cacheRefresh": REFRESH_CACHE_STATUS,
        })


    @app.route("/api/admin/system-health/refresh-cache", methods=["POST"])
    @admin_required
    def api_admin_refresh_retail_cache():
        queued = _queue_retail_cache_refresh()
        log_system_operation("refresh_retail_cache", "cache", _current_month(), {"month": _current_month()})
        return jsonify({"ok": True, "status": REFRESH_CACHE_STATUS, "message": queued["message"]})


    @app.route("/api/admin/system/restart", methods=["POST"])
    @admin_required
    def api_admin_restart_service():
        script = PROJECT_ROOT / "scripts" / "restart_production_task.ps1"
        if not script.exists():
            return jsonify({"error": "重启脚本不存在"}), 500
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.Popen(
            [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
            ],
            cwd=str(PROJECT_ROOT.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
        log_system_operation("restart_service", "scheduled_task", "SalesVisualizationProduction", {"script": str(script)})
        return jsonify({"ok": True, "message": "已提交重启请求，约 20 秒后刷新页面。"})


    @app.route("/api/admin/retail-station-statuses", methods=["POST"])
    @admin_required
    def api_admin_create_retail_station_status():
        payload = request.get_json(force=True)
        shop_key = int(payload.get("shopKey") or 0)
        status_type = payload.get("statusType") if payload.get("statusType") in STATION_STATUS_TYPES else "other"
        status_label = clean_str(payload.get("statusLabel")) or STATION_STATUS_TYPES[status_type]
        started_at = payload.get("startedAt") or None
        expected_resume_at = payload.get("expectedResumeAt") or None
        if started_at:
            started_at = started_at.replace("T", " ")
        if expected_resume_at:
            expected_resume_at = expected_resume_at.replace("T", " ")
        note = clean_str(payload.get("note"))
        affects_sales = bool(payload.get("affectsSales"))
        affects_inventory = bool(payload.get("affectsInventory"))
        suppress_alerts = bool(payload.get("suppressAlerts"))
        if not shop_key:
            return jsonify({"error": "请选择加油站"}), 400
        if status_type == "normal":
            affects_sales = False
            affects_inventory = False
            suppress_alerts = False
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_station_status_schema(cur)
            cur.execute(
                """
                UPDATE retail_station_status
                SET is_active = FALSE, ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
                WHERE shop_key = %s AND is_active = TRUE AND ended_at IS NULL
                """,
                (shop_key,),
            )
            if status_type == "normal":
                log_operation(
                    cur,
                    "restore_station_normal",
                    "retail_station_status",
                    shop_key,
                    {"shopKey": shop_key, "statusType": status_type, "statusLabel": status_label},
                )
                conn.commit()
                return jsonify({"ok": True, "id": None})
            cur.execute(
                """
                INSERT INTO retail_station_status
                    (shop_key, status_type, status_label, started_at, expected_resume_at,
                     affects_sales, affects_inventory, suppress_alerts, note, created_by)
                VALUES (%s, %s, %s, COALESCE(%s, CURRENT_TIMESTAMP), %s, %s, %s, %s, %s, %s)
                """,
                (
                    shop_key,
                    status_type,
                    status_label,
                    started_at,
                    expected_resume_at,
                    affects_sales,
                    affects_inventory,
                    suppress_alerts,
                    note,
                    session_user()["id"],
                ),
            )
            status_id = cur.lastrowid
            log_operation(
                cur,
                "update_station_status",
                "retail_station_status",
                status_id,
                {"shopKey": shop_key, "statusType": status_type, "statusLabel": status_label},
            )
            conn.commit()
            return jsonify({"ok": True, "id": status_id})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/retail-station-statuses/<int:status_id>/close", methods=["POST"])
    @admin_required
    def api_admin_close_retail_station_status(status_id):
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_station_status_schema(cur)
            cur.execute(
                """
                UPDATE retail_station_status
                SET is_active = FALSE, ended_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (status_id,),
            )
            log_operation(cur, "close_station_status", "retail_station_status", status_id)
            conn.commit()
            return jsonify({"ok": True})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()



    @app.route("/api/admin/exchange-rates")
    @admin_required
    def api_admin_exchange_rates():
        year = int(request.args.get("year", str(date.today().year)))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    dates.rate_date,
                    er.usd_kgs,
                    er.cny_kgs,
                    er.source,
                    er.is_manual,
                    er.fetched_at,
                    er.note,
                    COALESCE(g.status, IF(er.rate_date IS NULL OR er.usd_kgs IS NULL OR er.cny_kgs IS NULL, 'open', 'resolved')) AS gap_status,
                    COALESCE(g.missing_usd, er.usd_kgs IS NULL) AS missing_usd,
                    COALESCE(g.missing_cny, er.cny_kgs IS NULL) AS missing_cny
                FROM (
                    SELECT rate_date
                    FROM exchange_rates
                    WHERE rate_date >= %s AND rate_date < %s
                    UNION
                    SELECT rate_date
                    FROM exchange_rate_gaps
                    WHERE rate_date >= %s AND rate_date < %s
                    UNION
                    SELECT exchange_rate_date AS rate_date
                    FROM calculation_results
                    WHERE exchange_rate_date >= %s AND exchange_rate_date < %s
                      AND exchange_missing = TRUE
                    UNION
                    SELECT issue_date AS rate_date
                    FROM data_quality_issues
                    WHERE issue_type = 'missing_exchange_rate'
                      AND issue_date >= %s AND issue_date < %s
                ) dates
                LEFT JOIN exchange_rates er ON er.rate_date = dates.rate_date
                LEFT JOIN exchange_rate_gaps g ON g.rate_date = dates.rate_date
                WHERE dates.rate_date IS NOT NULL
                ORDER BY dates.rate_date DESC
                """,
                (start, end, start, end, start, end, start, end),
            )
            items = [
                {
                    "date": row[0].isoformat(),
                    "usdKgs": float(row[1]) if row[1] is not None else None,
                    "cnyKgs": float(row[2]) if row[2] is not None else None,
                    "source": row[3],
                    "isManual": bool(row[4]),
                    "fetchedAt": row[5].isoformat() if row[5] else None,
                    "note": row[6] or "",
                    "gapStatus": row[7],
                    "missingUsd": bool(row[8]),
                    "missingCny": bool(row[9]),
                }
                for row in cur.fetchall()
            ]
            return jsonify({
                "items": items,
                "total": len(items),
                "openGaps": sum(1 for item in items if item["gapStatus"] == "open"),
            })
        finally:
            conn.close()


    @app.route("/api/admin/exchange-rates/fetch-missing", methods=["POST"])
    @admin_required
    def api_admin_fetch_missing_exchange_rates():
        payload = request.get_json(silent=True) or {}
        year = int(payload.get("year") or date.today().year)
        month_raw = payload.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            dates = missing_exchange_dates(cur, start, end)
            fetched = []
            unresolved = []
            errors = []
            for rate_date in dates:
                try:
                    usd, cny, source_url = fetch_nbkr_daily_rates(rate_date)
                    if usd is None or cny is None:
                        unresolved.append({
                            "date": rate_date.isoformat(),
                            "missingUsd": usd is None,
                            "missingCny": cny is None,
                        })
                    resolved = upsert_exchange_rate(
                        cur,
                        rate_date,
                        usd,
                        cny,
                        f"NBKR 自动获取：{source_url}",
                    )
                    fetched.append({
                        "date": rate_date.isoformat(),
                        "usdKgs": float(usd) if usd is not None else None,
                        "cnyKgs": float(cny) if cny is not None else None,
                        "resolved": resolved,
                    })
                except RuntimeError as exc:
                    errors.append({"date": rate_date.isoformat(), "error": str(exc)})

            recalculation = recalculate_all_wholesale(cur) if fetched else {"matched": 0, "unmatched": 0, "missing_rates": 0}
            log_operation(
                cur,
                "fetch_missing_exchange_rates",
                "exchange_rates",
                f"{start.isoformat()}..{end.isoformat()}",
                {
                    "requested": len(dates),
                    "fetched": len(fetched),
                    "unresolved": len(unresolved),
                    "errors": len(errors),
                },
            )
            conn.commit()
            return jsonify({
                "ok": True,
                "requested": len(dates),
                "fetched": fetched,
                "updated": len(fetched),
                "resolved": sum(1 for item in fetched if item["resolved"]),
                "unresolved": unresolved,
                "errors": errors,
                "recalculation": recalculation,
            })
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/exchange-rates", methods=["POST"])
    @admin_required
    def api_admin_save_exchange_rate():
        payload = request.get_json(force=True)
        rate_date = parse_date(payload.get("rateDate"))
        usd = parse_decimal(payload.get("usdKgs"))
        cny = parse_decimal(payload.get("cnyKgs"))
        note = clean_str(payload.get("note"))
        if not rate_date:
            return jsonify({"error": "请选择汇率日期"}), 400
        if usd is None and cny is None:
            return jsonify({"error": "至少录入 USD/KGS 或 CNY/KGS 中的一项"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO exchange_rates
                    (rate_date, usd_kgs, cny_kgs, source, is_manual, fetched_at, note)
                VALUES (%s, %s, %s, 'manual', TRUE, CURRENT_TIMESTAMP, %s)
                ON DUPLICATE KEY UPDATE
                    usd_kgs = COALESCE(VALUES(usd_kgs), usd_kgs),
                    cny_kgs = COALESCE(VALUES(cny_kgs), cny_kgs),
                    source = 'manual',
                    is_manual = TRUE,
                    fetched_at = CURRENT_TIMESTAMP,
                    note = COALESCE(VALUES(note), note)
                """,
                (rate_date, usd, cny, note),
            )
            cur.execute("SELECT usd_kgs, cny_kgs FROM exchange_rates WHERE rate_date = %s", (rate_date,))
            saved = cur.fetchone()
            missing_usd = saved[0] is None
            missing_cny = saved[1] is None
            if missing_usd or missing_cny:
                cur.execute(
                    """
                    INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, status, note)
                    VALUES (%s, %s, %s, 'open', 'Manual rate still incomplete.')
                    ON DUPLICATE KEY UPDATE
                        missing_usd = VALUES(missing_usd),
                        missing_cny = VALUES(missing_cny),
                        status = 'open',
                        note = VALUES(note)
                    """,
                    (rate_date, missing_usd, missing_cny),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, status, resolved_at, note)
                    VALUES (%s, FALSE, FALSE, 'resolved', CURRENT_TIMESTAMP, 'Resolved by manual rate entry.')
                    ON DUPLICATE KEY UPDATE
                        missing_usd = FALSE,
                        missing_cny = FALSE,
                        status = 'resolved',
                        resolved_at = CURRENT_TIMESTAMP,
                        note = VALUES(note)
                    """,
                    (rate_date,),
                )
            result = recalculate_all_wholesale(cur)
            log_operation(
                cur,
                "save_exchange_rate",
                "exchange_rates",
                rate_date.isoformat(),
                {"usdKgs": str(usd) if usd is not None else None, "cnyKgs": str(cny) if cny is not None else None},
            )
            conn.commit()
            return jsonify({"ok": True, "recalculation": result})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/products")
    @admin_required
    def api_admin_products():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, product_code, display_name, category, retail_resource_key, is_active, created_at
                FROM products
                ORDER BY category, product_code
                """
            )
            products = []
            by_id = {}
            for row in cur.fetchall():
                item = {
                    "id": row[0],
                    "code": row[1],
                    "name": row[2],
                    "category": row[3],
                    "retailResourceKey": row[4],
                    "isActive": bool(row[5]),
                    "createdAt": row[6].isoformat() if row[6] else None,
                    "aliases": [],
                }
                products.append(item)
                by_id[item["id"]] = item
            cur.execute(
                """
                SELECT id, product_id, alias_name, source, created_at
                FROM product_aliases
                ORDER BY product_id, alias_name
                """
            )
            for row in cur.fetchall():
                if row[1] in by_id:
                    by_id[row[1]]["aliases"].append({
                        "id": row[0],
                        "name": row[2],
                        "source": row[3],
                        "createdAt": row[4].isoformat() if row[4] else None,
                    })
            return jsonify({"items": products})
        finally:
            conn.close()


    @app.route("/api/admin/product-aliases", methods=["POST"])
    @admin_required
    def api_admin_create_product_alias():
        payload = request.get_json(force=True)
        product_code = clean_str(payload.get("productCode"))
        alias_name = clean_str(payload.get("aliasName"))
        if not product_code or not alias_name:
            return jsonify({"error": "请选择油品并填写别名"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM products WHERE product_code = %s", (product_code,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "油品不存在"}), 404
            normalized = normalize_text(alias_name)
            cur.execute(
                """
                INSERT INTO product_aliases (product_id, alias_name, normalized_alias, source)
                VALUES (%s, %s, %s, 'admin')
                ON DUPLICATE KEY UPDATE
                    product_id = VALUES(product_id),
                    alias_name = VALUES(alias_name),
                    source = 'admin'
                """,
                (row[0], alias_name, normalized),
            )
            log_operation(cur, "create_product_alias", "product_aliases", cur.lastrowid, {"productCode": product_code, "alias": alias_name})
            conn.commit()
            return jsonify({"ok": True})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/customers")
    @admin_required
    def api_admin_customers():
        customer_type = request.args.get("customerType")
        keyword = clean_str(request.args.get("keyword"))
        filters = []
        params = []
        if customer_type in CUSTOMER_TYPES:
            if customer_type == "unknown":
                filters.append("c.customer_type NOT IN ('local_wholesale', 'export_wholesale')")
            else:
                filters.append("c.customer_type = %s")
                params.append(customer_type)
        if keyword:
            filters.append("c.standard_name LIKE %s")
            params.append(f"%{keyword}%")
        where = "WHERE " + " AND ".join(filters) if filters else ""
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT
                    c.id,
                    c.standard_name,
                    c.customer_type,
                    c.created_at,
                    c.updated_at,
                    COUNT(DISTINCT ct.id) AS contract_count,
                    COUNT(DISTINCT d.id) AS detail_count,
                    COALESCE(SUM(d.weight_tons), 0) AS detail_tons
                FROM customers c
                LEFT JOIN contracts ct ON ct.customer_id = c.id
                LEFT JOIN wholesale_detail_records d
                    ON d.entity_type = 'wholesale_customer'
                   AND d.raw_entity_name IS NOT NULL
                   AND d.raw_entity_name <> ''
                   AND d.standard_entity_name = c.standard_name
                {where}
                GROUP BY c.id, c.standard_name, c.customer_type, c.created_at, c.updated_at
                ORDER BY
                    CASE WHEN c.customer_type IN ('local_wholesale', 'export_wholesale') THEN 1 ELSE 0 END,
                    c.updated_at DESC,
                    c.created_at DESC,
                    c.standard_name
                LIMIT 500
                """,
                tuple(params),
            )
            items = [
                {
                    "id": row[0],
                    "name": row[1],
                    "customerType": _normalize_customer_type(row[2]),
                    "createdAt": row[3].isoformat() if row[3] else None,
                    "updatedAt": row[4].isoformat() if row[4] else None,
                    "contractCount": int(row[5] or 0),
                    "detailCount": int(row[6] or 0),
                    "detailTons": round(float(row[7] or 0), 3),
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": items, "total": len(items)})
        finally:
            conn.close()


    @app.route("/api/admin/customers", methods=["POST"])
    @admin_required
    def api_admin_save_customer():
        payload = request.get_json(force=True)
        name = clean_str(payload.get("name"))
        customer_type = payload.get("customerType") if payload.get("customerType") in CUSTOMER_TYPES else "unknown"
        if not name:
            return jsonify({"error": "客户名称必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            customer_id = get_or_create_customer(cur, name, customer_type)
            cur.execute(
                """
                UPDATE customers
                SET standard_name = %s,
                    customer_type = %s
                WHERE id = %s
                """,
                (name, customer_type, customer_id),
            )
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES ('wholesale_customer', %s, %s, %s, %s, 100, 'customer_maintenance')
                ON DUPLICATE KEY UPDATE
                    entity_type = 'wholesale_customer',
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = GREATEST(confidence, VALUES(confidence)),
                    source = VALUES(source)
                """,
                (str(customer_id), name, name, normalize_text(name)),
            )
            recalculation = recalculate_wholesale_references(cur)
            log_operation(cur, "save_customer", "customers", customer_id, {"name": name, "customerType": customer_type})
            conn.commit()
            return jsonify({"ok": True, "id": customer_id, "recalculation": recalculation})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/entity-options")
    @admin_required
    def api_admin_entity_options():
        catalog = retail_station_catalog()
        retail = [
            {
                "entityType": "retail_station",
                "entityCode": str(item["shopKey"]),
                "name": item["name"],
                "label": f"{item['shopKey']} · {item['name']}（{item['short']}）",
            }
            for item in catalog.values()
        ]
        depots = [
            {"entityType": "own_depot", "entityCode": "north_CTY-22-LAT_depot", "name": "S-66", "label": "S-66"},
            {"entityType": "own_depot", "entityCode": "south_CTY-30_depot", "name": "S-64", "label": "S-64"},
            {"entityType": "own_depot", "entityCode": "hq_depot", "name": "STN-61", "label": "STN-61"},
        ]
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT standard_name, customer_type FROM customers ORDER BY standard_name LIMIT 1000")
            customers = [
                {
                    "entityType": "wholesale_customer",
                    "entityCode": None,
                    "name": row[0],
                    "label": f"{row[0]} · {row[1]}",
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": retail + depots + customers})
        finally:
            conn.close()


    @app.route("/api/admin/entity-aliases")
    @admin_required
    def api_admin_entity_aliases():
        entity_type = request.args.get("entityType")
        keyword = clean_str(request.args.get("keyword"))
        filters = []
        params = []
        if entity_type:
            filters.append("entity_type = %s")
            params.append(entity_type)
        if keyword:
            filters.append("(standard_name LIKE %s OR alias_name LIKE %s)")
            params.extend([f"%{keyword}%", f"%{keyword}%"])
        where = "WHERE " + " AND ".join(filters) if filters else ""
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT id, entity_type, entity_code, standard_name, alias_name, confidence, source, created_at
                FROM entity_aliases
                {where}
                ORDER BY entity_type, standard_name, confidence DESC, alias_name
                LIMIT 800
                """,
                tuple(params),
            )
            items = [
                {
                    "id": row[0],
                    "entityType": row[1],
                    "entityCode": row[2],
                    "standardName": row[3],
                    "aliasName": row[4],
                    "confidence": int(row[5] or 0),
                    "source": row[6],
                    "createdAt": row[7].isoformat() if row[7] else None,
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": items, "total": len(items)})
        finally:
            conn.close()


    @app.route("/api/admin/entity-aliases", methods=["POST"])
    @admin_required
    def api_admin_save_entity_alias():
        payload = request.get_json(force=True)
        entity_type = payload.get("entityType") if payload.get("entityType") in ("retail_station", "own_depot", "wholesale_customer", "unknown") else "unknown"
        entity_code = clean_str(payload.get("entityCode"))
        standard_name = clean_str(payload.get("standardName"))
        alias_name = clean_str(payload.get("aliasName"))
        confidence = int(payload.get("confidence") or 100)
        confidence = min(100, max(1, confidence))
        if not standard_name or not alias_name:
            return jsonify({"error": "标准名称和别名必填"}), 400
        normalized = normalize_station_name(alias_name) if entity_type == "retail_station" else normalize_text(alias_name)
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES (%s, %s, %s, %s, %s, %s, 'admin')
                ON DUPLICATE KEY UPDATE
                    entity_type = VALUES(entity_type),
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = VALUES(confidence),
                    source = 'admin'
                """,
                (entity_type, entity_code, standard_name, alias_name, normalized, confidence),
            )
            if entity_type == "wholesale_customer":
                get_or_create_customer(cur, standard_name, "unknown")
                recalculation = recalculate_wholesale_references(cur)
            else:
                recalculation = None
            log_operation(
                cur,
                "save_entity_alias",
                "entity_aliases",
                cur.lastrowid,
                {"entityType": entity_type, "standardName": standard_name, "aliasName": alias_name},
            )
            conn.commit()
            return jsonify({"ok": True, "recalculation": recalculation})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/contracts")
    @admin_required
    def api_admin_contracts():
        year_raw = request.args.get("year")
        month_raw = request.args.get("month")
        sales_type = request.args.get("salesType")
        product_code = clean_str(request.args.get("productCode"))
        customer = clean_str(request.args.get("customer"))
        params = []
        filters = []
        if year_raw:
            start, end = period_bounds(int(year_raw), int(month_raw) if month_raw else None)
            filters.append("(c.effective_end IS NULL OR c.effective_end >= %s)")
            filters.append("(c.effective_start IS NULL OR c.effective_start < %s)")
            params.extend([start, end])
        if sales_type:
            filters.append("c.sales_type = %s")
            params.append(sales_type)
        if product_code:
            filters.append("p.product_code = %s")
            params.append(product_code)
        if customer:
            filters.append("(c.raw_customer_name LIKE %s OR cu.standard_name LIKE %s)")
            params.extend([f"%{customer}%", f"%{customer}%"])
        where = "WHERE " + " AND ".join(filters) if filters else ""
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT
                    c.id,
                    c.raw_customer_name,
                    COALESCE(cu.standard_name, c.raw_customer_name) AS customer_name,
                    c.contract_no,
                    c.appendix_no,
                    c.signed_date,
                    c.effective_start,
                    c.effective_end,
                    p.product_code,
                    COALESCE(p.display_name, c.raw_product_name) AS product_name,
                    c.raw_product_name,
                    c.destination,
                    c.sales_type,
                    c.price_with_logistics,
                    c.price_without_logistics,
                    c.contract_quantity_tons,
                    c.contract_amount_original,
                    c.currency_code,
                    c.remark,
                    COUNT(d.id) AS matched_rows,
                    COALESCE(SUM(d.weight_tons), 0) AS matched_tons,
                    COALESCE(SUM(cr.amount_cny), 0) AS amount_cny
                FROM contracts c
                LEFT JOIN customers cu ON cu.id = c.customer_id
                LEFT JOIN products p ON p.id = c.product_id
                LEFT JOIN wholesale_detail_records d ON d.contract_id = c.id
                LEFT JOIN calculation_results cr ON cr.detail_id = d.id
                {where}
                GROUP BY
                    c.id, c.raw_customer_name, cu.standard_name, c.contract_no, c.appendix_no,
                    c.signed_date, c.effective_start, c.effective_end, p.product_code, p.display_name,
                    c.raw_product_name, c.destination, c.sales_type, c.price_with_logistics,
                    c.price_without_logistics, c.contract_quantity_tons, c.contract_amount_original,
                    c.currency_code, c.remark
                ORDER BY COALESCE(c.effective_start, c.signed_date, c.created_at) DESC, c.id DESC
                LIMIT 500
                """,
                tuple(params),
            )
            items = [
                {
                    "id": row[0],
                    "rawCustomerName": row[1],
                    "customerName": row[2],
                    "contractNo": row[3],
                    "appendixNo": row[4],
                    "signedDate": row[5].isoformat() if row[5] else None,
                    "effectiveStart": row[6].isoformat() if row[6] else None,
                    "effectiveEnd": row[7].isoformat() if row[7] else None,
                    "productCode": row[8],
                    "productName": row[9],
                    "rawProductName": row[10],
                    "destination": row[11],
                    "salesType": row[12],
                    "priceWithLogistics": float(row[13]) if row[13] is not None else None,
                    "priceWithoutLogistics": float(row[14]) if row[14] is not None else None,
                    "quantityTons": float(row[15]) if row[15] is not None else None,
                    "amountOriginal": float(row[16]) if row[16] is not None else None,
                    "currencyCode": row[17],
                    "remark": row[18] or "",
                    "matchedRows": int(row[19] or 0),
                    "matchedTons": round(float(row[20] or 0), 3),
                    "amountCny": round(float(row[21] or 0), 2),
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": items, "total": len(items)})
        finally:
            conn.close()


    @app.route("/api/admin/contracts/execution")
    @admin_required
    def api_admin_contracts_execution():
        status_filter = request.args.get("status")
        lifecycle_filter = request.args.get("lifecycle")
        customer_id = clean_str(request.args.get("customerId"))
        year_raw = request.args.get("year")
        month_raw = request.args.get("month")
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("perPage", 50))
        params = []
        filters = []
        if year_raw:
            start, end = period_bounds(int(year_raw), int(month_raw) if month_raw else None)
            filters.append("(c.effective_end IS NULL OR c.effective_end >= %s)")
            filters.append("(c.effective_start IS NULL OR c.effective_start < %s)")
            params.extend([start, end])
        if lifecycle_filter:
            today_str = date.today().isoformat()
            if lifecycle_filter == "active":
                filters.append("(c.effective_start IS NULL OR c.effective_start <= %s) AND (c.effective_end IS NULL OR c.effective_end >= %s)")
                params.extend([today_str, today_str])
            elif lifecycle_filter == "expired":
                filters.append("c.effective_end < %s")
                params.append(today_str)
            elif lifecycle_filter == "future":
                filters.append("c.effective_start > %s")
                params.append(today_str)
        if customer_id:
            filters.append("c.customer_id = %s")
            params.append(customer_id)
        where = "WHERE " + " AND ".join(filters) if filters else ""
        conn = get_connection()
        try:
            cur = conn.cursor()
            today = date.today()
            base_query = f"""
                SELECT
                    c.id, c.contract_no, c.appendix_no, c.raw_customer_name,
                    COALESCE(cu.standard_name, c.raw_customer_name) AS customer_name,
                    c.signed_date, c.effective_start, c.effective_end,
                    COALESCE(p.display_name, c.raw_product_name) AS product_name,
                    c.sales_type, c.contract_quantity_tons, c.contract_amount_original, c.currency_code,
                    COALESCE(SUM(d.weight_tons), 0) AS executed_tons,
                    COUNT(d.id) AS matched_rows
                FROM contracts c
                LEFT JOIN customers cu ON cu.id = c.customer_id
                LEFT JOIN products p ON p.id = c.product_id
                LEFT JOIN calculation_results cr ON cr.contract_id = c.id
                LEFT JOIN wholesale_detail_records d ON cr.detail_id = d.id
                {where}
                GROUP BY c.id, c.contract_no, c.appendix_no, c.raw_customer_name,
                    cu.standard_name, c.signed_date, c.effective_start, c.effective_end,
                    p.display_name, c.raw_product_name, c.sales_type, c.contract_quantity_tons,
                    c.contract_amount_original, c.currency_code
            """
            today = date.today()
            cur.execute(base_query, tuple(params))
            all_rows = cur.fetchall()
            all_items = []
            for row in all_rows:
                (
                    c_id, contract_no, appendix_no, raw_customer, customer_name,
                    signed_date, eff_start, eff_end, product_name,
                    sales_type, qty_tons, amt_original, currency,
                    executed_tons, matched_rows
                ) = row
                qty = float(qty_tons) if qty_tons is not None else None
                executed = float(executed_tons or 0)
                remaining = round(qty - executed, 3) if qty is not None else None
                fulfillment = round(executed / qty * 100, 1) if qty and qty > 0 else (100.0 if executed > 0 else 0.0)
                days_remaining = (eff_end - today).days if eff_end else None
                if eff_start and eff_start > today:
                    lifecycle = "future"
                elif eff_end and eff_end < today:
                    lifecycle = "expired"
                else:
                    lifecycle = "active"
                if qty is not None and executed > qty:
                    execution_status = "over_executed"
                elif lifecycle == "expired" and (qty is None or executed < qty):
                    execution_status = "expired_incomplete"
                elif lifecycle == "expired" or (qty is not None and executed >= qty):
                    execution_status = "completed"
                else:
                    execution_status = "in_progress"
                all_items.append({
                    "id": c_id, "contractNo": contract_no, "appendixNo": appendix_no or "",
                    "rawCustomerName": raw_customer, "customerName": customer_name,
                    "signedDate": signed_date.isoformat() if signed_date else None,
                    "effectiveStart": eff_start.isoformat() if eff_start else None,
                    "effectiveEnd": eff_end.isoformat() if eff_end else None,
                    "productName": product_name or "", "salesType": sales_type,
                    "quantityTons": qty, "amountOriginal": float(amt_original) if amt_original else None,
                    "currencyCode": currency, "executedTons": executed, "remainingTons": remaining,
                    "fulfillmentPct": fulfillment, "daysRemaining": days_remaining,
                    "matchedRows": int(matched_rows or 0), "lifecycleStatus": lifecycle,
                    "executionStatus": execution_status,
                })
            stats = {"all": 0, "in_progress": 0, "completed": 0, "over_executed": 0, "expired_incomplete": 0}
            for item in all_items:
                s = item["executionStatus"]
                stats[s] = stats.get(s, 0) + 1
                stats["all"] += 1
            total_count = len(all_items)
            if status_filter:
                all_items = [it for it in all_items if it["executionStatus"] == status_filter]
            offset = (page - 1) * per_page
            page_items = all_items[offset:offset + per_page]
            return jsonify({"items": page_items, "stats": stats, "total": total_count, "page": page})
        finally:
            conn.close()


    @app.route("/api/admin/contracts/<int:contract_id>", methods=["PATCH"])
    @admin_required
    def api_admin_update_contract(contract_id):
        payload = request.get_json(force=True)
        customer = clean_str(payload.get("customerName"))
        contract_no = clean_str(payload.get("contractNo"))
        raw_product = clean_str(payload.get("productName"))
        product_code = clean_str(payload.get("productCode"))
        sales_type = payload.get("salesType") if payload.get("salesType") in ("local_wholesale", "export_wholesale", "internal", "unknown") else "unknown"
        if not customer or not contract_no or (not raw_product and not product_code):
            return jsonify({"error": "客户、合同号、油品必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            product = None
            if product_code:
                cur.execute("SELECT id, display_name FROM products WHERE product_code = %s", (product_code,))
                row = cur.fetchone()
                if row:
                    product = {"id": row[0], "display_name": row[1]}
                    raw_product = raw_product or row[1]
            if not product:
                product = lookup_product(load_product_lookup(cur), raw_product)
            customer_id = get_or_create_customer(cur, customer, sales_type if sales_type != "internal" else "unknown")
            cur.execute(
                """
                UPDATE contracts
                SET customer_id = %s,
                    raw_customer_name = %s,
                    contract_no = %s,
                    appendix_no = %s,
                    signed_date = %s,
                    effective_start = %s,
                    effective_end = %s,
                    product_id = %s,
                    raw_product_name = %s,
                    destination = %s,
                    sales_type = %s,
                    price_with_logistics = %s,
                    price_without_logistics = %s,
                    contract_quantity_tons = %s,
                    contract_amount_original = %s,
                    currency_code = %s,
                    remark = %s
                WHERE id = %s
                """,
                (
                    customer_id,
                    customer,
                    contract_no,
                    clean_str(payload.get("appendixNo")),
                    parse_date(payload.get("signedDate")),
                    parse_date(payload.get("effectiveStart")),
                    parse_date(payload.get("effectiveEnd")),
                    product["id"] if product else None,
                    raw_product,
                    clean_str(payload.get("destination")),
                    sales_type,
                    parse_decimal(payload.get("priceWithLogistics")),
                    parse_decimal(payload.get("priceWithoutLogistics")),
                    parse_decimal(payload.get("quantityTons")),
                    parse_decimal(payload.get("amountOriginal")),
                    (payload.get("currencyCode") or "KGS").upper(),
                    clean_str(payload.get("remark")),
                    contract_id,
                ),
            )
            if cur.rowcount == 0:
                conn.rollback()
                return jsonify({"error": "合同不存在"}), 404
            result = recalculate_all_wholesale(cur)
            log_operation(
                cur,
                "update_contract",
                "contracts",
                contract_id,
                {"customerName": customer, "contractNo": contract_no, "salesType": sales_type, "productCode": product_code},
            )
            conn.commit()
            return jsonify({"ok": True, "recalculation": result})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/admin/operation-logs")
    @admin_required
    def api_admin_operation_logs():
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_operation_log_schema(cur)
            cur.execute(
                """
                SELECT id, username, action, target_type, target_id, detail, created_at
                FROM operation_logs
                ORDER BY created_at DESC, id DESC
                LIMIT 120
                """
            )
            items = [
                {
                    "id": row[0],
                    "username": row[1] or "system",
                    "action": row[2],
                    "targetType": row[3],
                    "targetId": row[4],
                    "detail": row[5],
                    "createdAt": row[6].isoformat() if row[6] else None,
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": items})
        finally:
            conn.close()



    @app.route("/api/admin/import-batches")
    @admin_required
    def api_admin_import_batches():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    b.id,
                    b.source_type,
                    b.original_filename,
                    b.period_year,
                    b.period_month,
                    b.status,
                    b.created_at,
                    b.imported_at,
                    b.note,
                    COALESCE(rr.raw_rows, 0),
                    COALESCE(d.detail_rows, 0),
                    COALESCE(d.detail_tons, 0),
                    COALESCE(s.summary_rows, 0),
                    COALESCE(c.contract_rows, 0)
                FROM import_batches b
                LEFT JOIN (
                    SELECT batch_id, COUNT(*) raw_rows
                    FROM import_raw_rows
                    GROUP BY batch_id
                ) rr ON rr.batch_id = b.id
                LEFT JOIN (
                    SELECT batch_id, COUNT(*) detail_rows, COALESCE(SUM(weight_tons), 0) detail_tons
                    FROM wholesale_detail_records
                    GROUP BY batch_id
                ) d ON d.batch_id = b.id
                LEFT JOIN (
                    SELECT batch_id, COUNT(*) summary_rows
                    FROM wholesale_summary_records
                    GROUP BY batch_id
                ) s ON s.batch_id = b.id
                LEFT JOIN (
                    SELECT batch_id, COUNT(*) contract_rows
                    FROM contracts
                    GROUP BY batch_id
                ) c ON c.batch_id = b.id
                ORDER BY COALESCE(b.imported_at, b.created_at) DESC, b.id DESC
                LIMIT 200
                """
            )
            items = []
            for row in cur.fetchall():
                period = ""
                if row[3]:
                    period = f"{row[3]}-{int(row[4] or 0):02d}" if row[4] else str(row[3])
                items.append(
                    {
                        "id": row[0],
                        "sourceType": row[1],
                        "sourceLabel": import_source_label(row[1]),
                        "filename": row[2],
                        "period": period,
                        "status": row[5],
                        "createdAt": row[6].isoformat() if row[6] else None,
                        "importedAt": row[7].isoformat() if row[7] else None,
                        "note": row[8],
                        "rawRows": int(row[9] or 0),
                        "detailRows": int(row[10] or 0),
                        "detailTons": round(float(row[11] or 0), 3),
                        "summaryRows": int(row[12] or 0),
                        "contractRows": int(row[13] or 0),
                    }
                )
            return jsonify({"items": items})
        finally:
            conn.close()


    @app.route("/api/admin/import-batches/<int:batch_id>/rollback", methods=["POST"])
    @admin_required
    def api_admin_rollback_import_batch(batch_id):
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT source_type, original_filename, status FROM import_batches WHERE id = %s",
                (batch_id,),
            )
            batch = cur.fetchone()
            if not batch:
                return jsonify({"error": "导入批次不存在"}), 404

            source_type, filename, status = batch
            cur.execute("SELECT COUNT(*) FROM wholesale_detail_records WHERE batch_id = %s", (batch_id,))
            detail_rows = int(cur.fetchone()[0] or 0)
            cur.execute("SELECT COUNT(*) FROM wholesale_summary_records WHERE batch_id = %s", (batch_id,))
            summary_rows = int(cur.fetchone()[0] or 0)
            cur.execute("SELECT COUNT(*) FROM contracts WHERE batch_id = %s", (batch_id,))
            contract_rows = int(cur.fetchone()[0] or 0)
            cur.execute("SELECT COUNT(*) FROM import_raw_rows WHERE batch_id = %s", (batch_id,))
            raw_rows = int(cur.fetchone()[0] or 0)

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
            cur.execute("DELETE FROM wholesale_summary_records WHERE batch_id = %s", (batch_id,))
            cur.execute("DELETE FROM wholesale_detail_records WHERE batch_id = %s", (batch_id,))
            cur.execute("DELETE FROM contracts WHERE batch_id = %s", (batch_id,))
            cur.execute("DELETE FROM import_raw_rows WHERE batch_id = %s", (batch_id,))
            rollback_note = f"\nRolled back by {session_user().get('username', 'system')}."
            cur.execute(
                """
                UPDATE import_batches
                SET status = 'failed',
                    note = CONCAT(COALESCE(note, ''), %s)
                WHERE id = %s
                """,
                (rollback_note, batch_id),
            )
            recalculation = recalculate_all_wholesale(cur)
            log_operation(
                cur,
                "rollback_import_batch",
                "import_batches",
                batch_id,
                {
                    "sourceType": source_type,
                    "filename": filename,
                    "previousStatus": status,
                    "rawRows": raw_rows,
                    "detailRows": detail_rows,
                    "summaryRows": summary_rows,
                    "contractRows": contract_rows,
                },
            )
            conn.commit()
            return jsonify(
                {
                    "ok": True,
                    "batchId": batch_id,
                    "removed": {
                        "rawRows": raw_rows,
                        "detailRows": detail_rows,
                        "summaryRows": summary_rows,
                        "contractRows": contract_rows,
                    },
                    "recalculation": recalculation,
                }
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    def rollback_import_batch_records(cur, batch_id, *, reason="Rolled back by organizer."):
        cur.execute(
            "SELECT source_type, original_filename, status, period_year, period_month FROM import_batches WHERE id = %s",
            (batch_id,),
        )
        batch = cur.fetchone()
        if not batch:
            return None

        source_type, filename, status, period_year, period_month = batch
        period = f"{period_year}-{int(period_month or 0):02d}" if period_year and period_month else (str(period_year) if period_year else "")
        cur.execute("SELECT COUNT(*) FROM wholesale_detail_records WHERE batch_id = %s", (batch_id,))
        detail_rows = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM wholesale_summary_records WHERE batch_id = %s", (batch_id,))
        summary_rows = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM contracts WHERE batch_id = %s", (batch_id,))
        contract_rows = int(cur.fetchone()[0] or 0)
        cur.execute("SELECT COUNT(*) FROM import_raw_rows WHERE batch_id = %s", (batch_id,))
        raw_rows = int(cur.fetchone()[0] or 0)
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
        cur.execute("DELETE FROM wholesale_summary_records WHERE batch_id = %s", (batch_id,))
        cur.execute("DELETE FROM wholesale_detail_records WHERE batch_id = %s", (batch_id,))
        cur.execute("DELETE FROM contracts WHERE batch_id = %s", (batch_id,))
        cur.execute("DELETE FROM import_raw_rows WHERE batch_id = %s", (batch_id,))
        cur.execute(
            """
            UPDATE import_batches
            SET status = 'failed',
                note = CONCAT(COALESCE(note, ''), %s)
            WHERE id = %s
            """,
            (f"\n{reason}", batch_id),
        )
        return {
            "batchId": batch_id,
            "sourceType": source_type,
            "filename": filename,
            "period": period,
            "previousStatus": status,
            "rawRows": raw_rows,
            "detailRows": detail_rows,
            "summaryRows": summary_rows,
            "contractRows": contract_rows,
        }


    @app.route("/api/admin/wholesale/organize", methods=["POST"])
    @admin_required
    def api_admin_organize_wholesale():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT id, period_year, period_month, original_filename, imported_at, created_at
                FROM import_batches
                WHERE source_type = 'export_sales_excel'
                  AND status = 'imported'
                  AND period_year IS NOT NULL
                ORDER BY period_year, period_month, imported_at DESC, created_at DESC, id DESC
                """
            )
            keep_by_period = {}
            rolled_back = []
            for batch_id, period_year, period_month, filename, imported_at, created_at in cur.fetchall():
                period = f"{period_year}-{int(period_month or 0):02d}" if period_month else str(period_year)
                if period not in keep_by_period:
                    keep_by_period[period] = {
                        "batchId": batch_id,
                        "period": period,
                        "filename": filename,
                        "importedAt": imported_at.isoformat() if imported_at else None,
                        "createdAt": created_at.isoformat() if created_at else None,
                    }
                    continue
                rollback = rollback_import_batch_records(
                    cur,
                    batch_id,
                    reason=f"Rolled back duplicate period {period} by wholesale organizer.",
                )
                if rollback:
                    rolled_back.append(rollback)

            product_reconciliation = reconcile_wholesale_product_ids(cur)
            recalculation = recalculate_all_wholesale(cur)
            cur.execute(
                """
                SELECT match_status, classification, COUNT(*) AS rows_count, COALESCE(SUM(weight_tons), 0) AS tons
                FROM wholesale_detail_records
                GROUP BY match_status, classification
                ORDER BY match_status, classification
                """
            )
            status_rows = [
                {
                    "matchStatus": row[0] or "unknown",
                    "classification": row[1] or "unknown",
                    "rows": int(row[2] or 0),
                    "tons": round(float(row[3] or 0), 3),
                }
                for row in cur.fetchall()
            ]
            cur.execute(
                """
                SELECT issue_type, COUNT(*) AS rows_count
                FROM data_quality_issues
                WHERE related_table = 'wholesale_detail_records'
                  AND status = 'open'
                GROUP BY issue_type
                ORDER BY rows_count DESC, issue_type
                """
            )
            issue_rows = [
                {"issueType": row[0] or "unknown", "rows": int(row[1] or 0)}
                for row in cur.fetchall()
            ]
            log_operation(
                cur,
                "organize_wholesale_data",
                "wholesale",
                None,
                {
                    "keptBatches": list(keep_by_period.values()),
                    "rolledBack": rolled_back,
                    "productReconciliation": product_reconciliation,
                    "recalculation": recalculation,
                    "statusRows": status_rows,
                    "issueRows": issue_rows,
                },
            )
            conn.commit()
            return jsonify({
                "ok": True,
                "keptBatches": list(keep_by_period.values()),
                "rolledBack": rolled_back,
                "productReconciliation": product_reconciliation,
                "recalculation": recalculation,
                "statusRows": status_rows,
                "issueRows": issue_rows,
            })
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    def scan_wholesale_duplicate_product_conflicts(cur):
        issue_type = "possible_duplicate_conflicting_product"
        ensure_data_quality_issue_schema(cur)
        cur.execute(
            """
            UPDATE data_quality_issues
            SET status = 'resolved',
                resolved_at = CURRENT_TIMESTAMP
            WHERE issue_type = %s
              AND related_table = 'wholesale_detail_records'
              AND status = 'open'
            """,
            (issue_type,),
        )
        resolved_previous = cur.rowcount
        cur.execute(
            """
            SELECT
                business_date,
                entity_key,
                vehicle_key,
                tons_key,
                MIN(entity_name) AS entity_name,
                MIN(vehicle_no) AS vehicle_no,
                COUNT(*) AS row_count,
                COUNT(DISTINCT product_key) AS product_count,
                GROUP_CONCAT(DISTINCT raw_product_name ORDER BY raw_product_name SEPARATOR ' / ') AS products
            FROM (
                SELECT
                    id,
                    business_date,
                    COALESCE(NULLIF(TRIM(standard_entity_name), ''), TRIM(raw_entity_name)) AS entity_name,
                    LOWER(COALESCE(NULLIF(TRIM(standard_entity_name), ''), TRIM(raw_entity_name))) AS entity_key,
                    LOWER(REPLACE(REPLACE(TRIM(COALESCE(vehicle_no, '')), ' ', ''), '-', '')) AS vehicle_key,
                    vehicle_no,
                    raw_product_name,
                    LOWER(TRIM(raw_product_name)) AS product_key,
                    ROUND(weight_tons, 3) AS tons_key
                FROM wholesale_detail_records
                WHERE business_date IS NOT NULL
                  AND weight_tons IS NOT NULL
                  AND vehicle_no IS NOT NULL
                  AND TRIM(vehicle_no) <> ''
                  AND raw_entity_name IS NOT NULL
                  AND TRIM(raw_entity_name) <> ''
            ) grouped
            WHERE entity_key <> ''
              AND vehicle_key <> ''
            GROUP BY business_date, entity_key, vehicle_key, tons_key
            HAVING row_count > 1
               AND product_count > 1
            ORDER BY business_date DESC, row_count DESC
            LIMIT 500
            """
        )
        groups = []
        issue_rows = []
        for row in cur.fetchall():
            business_date, entity_key, vehicle_key, tons_key, entity_name, vehicle_no, row_count, product_count, products = row
            cur.execute(
                """
                SELECT id, raw_product_name, classification, match_status, batch_id
                FROM wholesale_detail_records
                WHERE business_date = %s
                  AND LOWER(COALESCE(NULLIF(TRIM(standard_entity_name), ''), TRIM(raw_entity_name))) = %s
                  AND LOWER(REPLACE(REPLACE(TRIM(COALESCE(vehicle_no, '')), ' ', ''), '-', '')) = %s
                  AND ROUND(weight_tons, 3) = %s
                ORDER BY id
                """,
                (business_date, entity_key, vehicle_key, tons_key),
            )
            details = [
                {
                    "id": detail[0],
                    "product": detail[1],
                    "classification": detail[2],
                    "matchStatus": detail[3],
                    "batchId": detail[4],
                }
                for detail in cur.fetchall()
            ]
            message = (
                f"同一天、同一家公司、同一个车号与同一重量存在重复记录，但油品名称不一致。"
                f"请核对是否重复录入或油品录入错误。客户/去向：{entity_name or '--'}；"
                f"车号：{vehicle_no or '--'}；重量：{float(tons_key or 0):.3f} 吨；油品：{products or '--'}。"
            )
            for detail in details:
                cur.execute(
                    """
                    INSERT INTO data_quality_issues
                        (issue_type, severity, related_table, related_id, issue_date, message)
                    VALUES (%s, 'warning', 'wholesale_detail_records', %s, %s, %s)
                    """,
                    (issue_type, detail["id"], business_date, message),
                )
                issue_rows.append({"issueId": cur.lastrowid, "detailId": detail["id"]})
            groups.append(
                {
                    "date": business_date.isoformat() if business_date else None,
                    "entity": entity_name,
                    "vehicleNo": vehicle_no,
                    "tons": round(float(tons_key or 0), 3),
                    "rows": int(row_count or 0),
                    "productCount": int(product_count or 0),
                    "products": products,
                    "details": details,
                }
            )
        return {
            "groups": groups,
            "groupCount": len(groups),
            "issueRows": len(issue_rows),
            "resolvedPrevious": int(resolved_previous or 0),
        }


    @app.route("/api/admin/wholesale/deduplicate", methods=["POST"])
    @admin_required
    def api_admin_deduplicate_wholesale():
        conn = get_connection()
        try:
            cur = conn.cursor()
            result = scan_wholesale_duplicate_product_conflicts(cur)
            log_operation(
                cur,
                "detect_wholesale_duplicates",
                "wholesale",
                None,
                {
                    "groupCount": result["groupCount"],
                    "issueRows": result["issueRows"],
                    "resolvedPrevious": result["resolvedPrevious"],
                    "sampleGroups": result["groups"][:10],
                },
            )
            conn.commit()
            return jsonify({"ok": True, **result})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    # ── 称重管理 ──
    # 使用 entity_aliases / product_aliases 表做映射，不再使用独立的 weigh_*_mappings 表

    @app.route("/api/admin/weigh/mappings/entities", methods=["GET", "POST"])
    @admin_required
    def api_admin_weigh_entity_mappings():
        conn = get_connection()
        try:
            cur = conn.cursor()
            if request.method == "GET":
                keyword = request.args.get("keyword", "").strip()
                unmapped = request.args.get("unmapped", "").strip()
                if keyword:
                    cur.execute("SELECT id, entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source, created_at FROM entity_aliases WHERE alias_name LIKE %s ORDER BY alias_name LIMIT 200", (f"%{keyword}%",))
                else:
                    cur.execute("SELECT id, entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source, created_at FROM entity_aliases ORDER BY alias_name LIMIT 200")
                items = []
                for r in cur.fetchall():
                    items.append({"id": r[0], "entityType": r[1], "entityCode": r[2], "standardName": r[3], "aliasName": r[4], "normalizedAlias": r[5], "confidence": r[6], "source": r[7], "createdAt": r[8].isoformat() if r[8] else None})
                suggest = None
                if unmapped:
                    entity_lookup = load_entity_lookup(cur)
                    match = lookup_entity(entity_lookup, unmapped)
                    if match:
                        suggest = {"entityCode": match["entity_code"], "standardName": match["standard_name"], "source": "alias"}
                return jsonify({"items": items, "suggest": suggest})
            payload = request.get_json(force=True)
            alias_name = payload.get("aliasName") or payload.get("rawName") or ""  # accept both for backward compat
            alias_name = alias_name.strip()
            if not alias_name:
                return jsonify({"error": "aliasName is required"}), 400
            normalized = normalize_text(alias_name)
            entity_type = payload.get("entityType", "unknown")
            entity_code = payload.get("entityCode")
            standard_name = payload.get("standardName")
            confidence = int(payload.get("confidence", 80))
            source = payload.get("source") or "weigh_储运区"
            cur.execute("SELECT id FROM entity_aliases WHERE normalized_alias = %s", (normalized,))
            existing = cur.fetchone()
            if existing:
                cur.execute("UPDATE entity_aliases SET entity_type=%s, entity_code=%s, standard_name=%s, confidence=%s, source=%s WHERE id=%s",
                    (entity_type, entity_code, standard_name, confidence, source, existing[0]))
                conn.commit()
                return jsonify({"ok": True, "id": existing[0]})
            cur.execute("INSERT INTO entity_aliases (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (entity_type, entity_code, standard_name, alias_name, normalized, confidence, source))
            conn.commit()
            return jsonify({"ok": True, "id": cur.lastrowid})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.route("/api/admin/weigh/mappings/entities/<int:mapping_id>", methods=["DELETE"])
    @admin_required
    def api_admin_delete_weigh_entity_mapping(mapping_id):
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM entity_aliases WHERE id = %s", (mapping_id,))
            conn.commit()
            return jsonify({"ok": True})
        finally:
            conn.close()

    @app.route("/api/admin/weigh/mappings/products", methods=["GET", "POST"])
    @admin_required
    def api_admin_weigh_product_mappings():
        conn = get_connection()
        try:
            cur = conn.cursor()
            if request.method == "GET":
                keyword = request.args.get("keyword", "").strip()
                unmapped = request.args.get("unmapped", "").strip()
                if keyword:
                    cur.execute("""
                        SELECT a.id, a.product_id, a.alias_name, a.normalized_alias, a.confidence, a.source, a.created_at,
                               p.product_code, p.display_name
                        FROM product_aliases a
                        LEFT JOIN products p ON p.id = a.product_id
                        WHERE a.alias_name LIKE %s ORDER BY a.alias_name LIMIT 200
                    """, (f"%{keyword}%",))
                else:
                    cur.execute("""
                        SELECT a.id, a.product_id, a.alias_name, a.normalized_alias, a.confidence, a.source, a.created_at,
                               p.product_code, p.display_name
                        FROM product_aliases a
                        LEFT JOIN products p ON p.id = a.product_id
                        ORDER BY a.alias_name LIMIT 200
                    """)
                items = []
                for r in cur.fetchall():
                    items.append({"id": r[0], "productId": r[1], "aliasName": r[2], "normalizedAlias": r[3], "confidence": r[4], "source": r[5], "createdAt": r[6].isoformat() if r[6] else None, "productCode": r[7], "productName": r[8]})
                suggest = None
                if unmapped:
                    product_lookup = load_product_lookup(cur)
                    match = lookup_product(product_lookup, unmapped)
                    if match:
                        suggest = {"productId": match["id"], "productCode": match["code"], "productName": match["display_name"], "source": "alias"}
                return jsonify({"items": items, "suggest": suggest})
            payload = request.get_json(force=True)
            alias_name = payload.get("aliasName") or payload.get("rawName") or ""
            alias_name = alias_name.strip()
            if not alias_name:
                return jsonify({"error": "aliasName is required"}), 400
            normalized = normalize_text(alias_name)
            product_id = payload.get("productId")
            confidence = int(payload.get("confidence", 80))
            source = payload.get("source") or "weigh_储运区"
            cur.execute("SELECT id FROM product_aliases WHERE normalized_alias = %s", (normalized,))
            existing = cur.fetchone()
            if existing:
                cur.execute("UPDATE product_aliases SET product_id=%s, confidence=%s, source=%s WHERE id=%s",
                    (product_id, confidence, source, existing[0]))
                conn.commit()
                return jsonify({"ok": True, "id": existing[0]})
            cur.execute("INSERT INTO product_aliases (product_id, alias_name, normalized_alias, confidence, source) VALUES (%s,%s,%s,%s,%s)",
                (product_id, alias_name, normalized, confidence, source))
            conn.commit()
            return jsonify({"ok": True, "id": cur.lastrowid})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.route("/api/admin/weigh/mappings/products/<int:mapping_id>", methods=["DELETE"])
    @admin_required
    def api_admin_delete_weigh_product_mapping(mapping_id):
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM product_aliases WHERE id = %s", (mapping_id,))
            conn.commit()
            return jsonify({"ok": True})
        finally:
            conn.close()

    @app.route("/api/admin/weigh/records")
    @admin_required
    def api_admin_weigh_records():
        conn = get_connection()
        try:
            cur = conn.cursor()
            page = int(request.args.get("page", "1"))
            size = int(request.args.get("size", "50"))
            offset = (page - 1) * size
            vehicle = request.args.get("vehicle", "").strip()
            entity = request.args.get("entity", "").strip()
            product = request.args.get("product", "").strip()
            date_from = request.args.get("dateFrom", "").strip()
            date_to = request.args.get("dateTo", "").strip()
            source = request.args.get("source", "").strip()
            col_sender = request.args.get("col_sender", "").strip()
            col_receiver = request.args.get("col_receiver", "").strip()
            col_product = request.args.get("col_product", "").strip()
            col_source = request.args.get("col_source", "").strip()

            where = ["1=1"]
            params = []
            if vehicle:
                where.append("`车号` LIKE %s")
                params.append(f"%{vehicle}%")
            if date_from:
                where.append("`毛重日期` >= %s")
                params.append(date_from)
            if date_to:
                where.append("`毛重日期` <= %s")
                params.append(date_to)
            selected_sources = _normalize_weigh_source_values(source, col_source)
            if selected_sources:
                placeholders = ",".join(["%s"] * len(selected_sources))
                where.append(f"weigh_source IN ({placeholders})")
                params.extend(selected_sources)

            where_clause = " AND ".join(where)
            union_sql = _weigh_records_union_sql()
            col_names = WEIGH_COLUMNS + ["sync_date"]
            select_cols = ", ".join(f"`{col}`" for col in col_names)
            cur.execute(
                f"""
                SELECT weigh_source, {select_cols}
                FROM ({union_sql}) combined
                WHERE {where_clause}
                ORDER BY `毛重日期` DESC, `序号` DESC
                """,
                params,
            )
            entity_lookup = load_entity_lookup(cur)
            product_lookup = load_product_lookup(cur)
            sender_values = set(_split_filter_values(col_sender))
            receiver_values = set(_split_filter_values(col_receiver))
            product_values = set(_split_filter_values(col_product))
            items = []
            for r in cur.fetchall():
                item = dict(zip(["weigh_source"] + col_names, r))
                item = _decorate_weigh_record(item, entity_lookup, product_lookup)
                if entity:
                    text = _weigh_item_text(
                        item,
                        "发货单位显示", "收货单位显示", "标准发货单位", "标准收货单位",
                        "原发货单位", "原收货单位",
                    )
                    if entity.lower() not in text:
                        continue
                if product:
                    text = _weigh_item_text(item, "货名显示", "标准货名", "原货名")
                    if product.lower() not in text:
                        continue
                if not _matches_any_value(item, sender_values, "发货单位显示", "标准发货单位", "原发货单位"):
                    continue
                if not _matches_any_value(item, receiver_values, "收货单位显示", "标准收货单位", "原收货单位"):
                    continue
                if not _matches_any_value(item, product_values, "货名显示", "标准货名", "原货名"):
                    continue
                items.append(item)
            total = len(items)
            items = items[offset:offset + size]
            return jsonify({"items": items, "total": total, "page": page, "size": size})
        finally:
            conn.close()

    @app.route("/api/admin/weigh/records/filter-options")
    @admin_required
    def api_admin_weigh_records_filter_options():
        conn = get_connection()
        try:
            cur = conn.cursor()
            union_sql = _weigh_records_union_sql()
            col_names = ["发货单位", "收货单位", "货名"]
            select_cols = ", ".join(f"`{col}`" for col in col_names)
            cur.execute(
                f"""
                SELECT {select_cols}
                FROM ({union_sql}) combined
                """
            )
            entity_lookup = load_entity_lookup(cur)
            product_lookup = load_product_lookup(cur)
            sender_values = set()
            receiver_values = set()
            product_values = set()
            for sender, receiver, raw_product in cur.fetchall():
                sender_display = _lookup_standard_name(entity_lookup, sender) or sender
                receiver_display = _lookup_standard_name(entity_lookup, receiver) or receiver
                product_display = _lookup_standard_product(product_lookup, raw_product) or raw_product
                if sender_display and str(sender_display).strip():
                    sender_values.add(sender_display)
                if receiver_display and str(receiver_display).strip():
                    receiver_values.add(receiver_display)
                if product_display and str(product_display).strip():
                    product_values.add(product_display)

            return jsonify({
                "sender": sorted(sender_values),
                "receiver": sorted(receiver_values),
                "product": sorted(product_values),
                "source": list(WEIGH_SOURCE_OPTIONS),
            })
        finally:
            conn.close()

    @app.route("/api/admin/weigh/generate", methods=["POST"])
    @admin_required
    def api_admin_weigh_generate():
        conn = get_connection()
        try:
            cur = conn.cursor()
            payload = request.get_json(force=True)
            date_from = payload.get("dateFrom", "").strip()
            date_to = payload.get("dateTo", "").strip()
            selected_sources = _normalize_weigh_source_values(payload.get("source", WEIGH_SOURCE_STORAGE)) or [WEIGH_SOURCE_STORAGE]
            if not date_from:
                date_from = (date.today() - timedelta(days=7)).isoformat()
            try:
                start_date = date.fromisoformat(date_from)
                end_date = date.fromisoformat(date_to) if date_to else WHOLESALE_SOURCE_CUTOFF - timedelta(days=1)
            except ValueError:
                return jsonify({"ok": False, "error": "invalid_date"}), 400
            effective_range = clamp_weighing_detail_range(start_date, end_date)
            if effective_range is None:
                return jsonify({
                    "ok": True,
                    "generated": 0,
                    "skipped": 0,
                    "autoEntityMappings": 0,
                    "autoProductMappings": 0,
                    "cutoffDate": WHOLESALE_SOURCE_CUTOFF.isoformat(),
                    "message": "称重业务明细只生成 2026-06-01 之前的数据；之后请走上传或手工录入。",
                })
            start_date, end_date = effective_range
            placeholders = ",".join(["%s"] * len(selected_sources))
            where = ["`毛重日期` >= %s", "`毛重日期` <= %s", f"weigh_source IN ({placeholders})"]
            params = [start_date, end_date, *selected_sources]
            col_names = WEIGH_COLUMNS + ["sync_date"]
            select_cols = ", ".join(f"`{col}`" for col in col_names)
            union_sql = _weigh_records_union_sql()
            cur.execute(
                f"""
                SELECT weigh_source, {select_cols}
                FROM ({union_sql}) combined
                WHERE {' AND '.join(where)}
                ORDER BY `毛重日期`, `序号`
                """,
                params,
            )
            rows = cur.fetchall()
            generated = 0
            skipped = 0
            auto_entity = 0
            auto_product = 0
            entity_lookup = load_entity_lookup(cur)
            product_lookup = load_product_lookup(cur)
            for r in rows:
                row_source = r[0]
                record = dict(zip(col_names, r[1:]))
                raw_entity = (record.get("收货单位") or record.get("发货单位") or "").strip()
                raw_product = (record.get("货名") or "").strip()
                vehicle_no = (record.get("车号") or "").strip()
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
                business_date = gross_date if gross_date else date.today()
                row_number = int(record.get("序号", 0) or 0)
                cur.execute(
                    """
                    SELECT id FROM wholesale_detail_records
                    WHERE batch_id IS NULL AND weigh_source = %s AND source_row_number = %s
                    LIMIT 1
                    """,
                    (row_source, row_number),
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
                        entity_lookup = load_entity_lookup(cur)  # refresh

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
                        product_lookup = load_product_lookup(cur)  # refresh

                weigh_serial_no = str(record.get("编号") or "")
                sender_name = (record.get("发货单位") or "").strip()
                remark = (record.get("备注") or "").strip()
                if row_source == WEIGH_SOURCE_LPG:
                    remark = format_lpg_remark(remark)
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

                cur.execute("""
                    INSERT INTO wholesale_detail_records
                    (batch_id, source_row_number, business_date, raw_product_name, product_id, vehicle_no,
                     weigh_serial_no, raw_entity_name, sender_name, entity_type, entity_code, standard_entity_name,
                     classification, weight_kg, match_status, audit_status, weigh_source, remark)
                    VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (row_number, business_date, raw_product, product_id, vehicle_no,
                      weigh_serial_no, raw_entity, sender_name, entity_type, entity_code,
                      standard_name, classification, weight_kg, match_status, audit_status, row_source, remark))
                generated += 1
            conn.commit()
            return jsonify({
                "ok": True,
                "generated": generated,
                "skipped": skipped,
                "autoEntityMappings": auto_entity,
                "autoProductMappings": auto_product,
            })
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
