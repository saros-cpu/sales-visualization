from __future__ import annotations

import json
import re
import subprocess
import sys
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from routes_data import run_exchange_maintenance, run_market_watch_maintenance, run_retail_snapshot_maintenance
from services.retail_alert_service import generate_retail_alert_insights
from shared_utils import (
    OILSTATION_ROOT,
    REFRESH_CACHE_LOCK,
    REFRESH_CACHE_STATUS,
    active_station_statuses,
    ensure_automation_task_schema,
    record_automation_task,
    retail_station_catalog_cached,
)
from .assistant import ensure_ai_call_schema
from .audit_logs import ensure_audit_schema
from .authz import permission_required
from .permission_service import has_permission


def _file_info(path: Path, required_keys: set[str] | None = None) -> dict[str, Any]:
    result = {
        "path": str(path),
        "exists": path.exists(),
        "size": 0,
        "updatedAt": None,
        "valid": False,
        "missingKeys": [],
        "error": None,
    }
    if not path.exists():
        result["error"] = "missing"
        return result
    try:
        stat = path.stat()
        result["size"] = stat.st_size
        result["updatedAt"] = datetime.fromtimestamp(stat.st_mtime).isoformat(sep=" ")
        if path.suffix.lower() == ".json":
            data = json.loads(path.read_text(encoding="utf-8-sig"))
            if required_keys:
                missing = sorted(required_keys - set(data.keys())) if isinstance(data, dict) else sorted(required_keys)
                result["missingKeys"] = missing
                result["valid"] = not missing
            else:
                result["valid"] = True
            if isinstance(data, dict):
                for key in ("records", "daily", "stations", "byResource"):
                    if isinstance(data.get(key), list):
                        result[f"{key}Count"] = len(data[key])
        else:
            result["valid"] = True
    except Exception as exc:
        result["error"] = exc.__class__.__name__
    return result


def _active_month() -> str:
    completed_day = date.today() - timedelta(days=1)
    return f"{completed_day.year}-{completed_day.month:02d}"


def _cache_items() -> list[dict[str, Any]]:
    ym = _active_month()
    year, month = ym.split("-")
    monthly_dir = OILSTATION_ROOT / "cache_snapshots" / "monthly" / year
    daily_dir = OILSTATION_ROOT / "cache_snapshots" / "daily" / year / month
    yearly_dir = OILSTATION_ROOT / "cache_snapshots" / "yearly"
    report_dir = OILSTATION_ROOT / "cache_snapshots" / "report_extras" / year
    items = [
        ("retail_monthly", "零售月度快照", monthly_dir / f"monthly_{int(month):02d}.json", {"summary", "stations", "regions", "byResource", "daily"}),
        ("retail_stations", "零售站点快照", monthly_dir / f"stations_{int(month):02d}.json", {"stations"}),
        ("retail_regions", "零售区域快照", monthly_dir / f"regions_{int(month):02d}.json", {"regions"}),
        ("retail_daily_trend", "零售日趋势快照", monthly_dir / f"daily_{int(month):02d}.json", {"daily"}),
        ("self_use", "自用油月度快照", OILSTATION_ROOT / "cache_snapshots" / "monthly" / f"self_use_{ym}.json", {"records", "summary", "comparison", "byStation", "byResource", "byRegion", "daily"}),
        ("dashboard_yearly", "年度看板快照", yearly_dir / f"dashboard_yearly_{year}.json", {"stations", "regions", "byResource"}),
        ("resources_yearly", "年度油品快照", yearly_dir / f"resources_yearly_{year}_{int(month)}.json", {"resources", "summary"}),
        ("kpi_yearly", "年度 KPI 快照", yearly_dir / f"kpi_yearly_{year}_summary.json", {"summary"}),
        ("report_extras", "报表附加快照", report_dir / f"report_extras_{int(month):02d}.json", None),
    ]
    result = []
    for key, label, path, required in items:
        info = _file_info(path, required)
        info.update({"key": key, "label": label, "month": ym})
        result.append(info)

    completed_day = date.today() - timedelta(days=1)
    day_path = daily_dir / f"day_{completed_day.day:02d}.json"
    day_info = _file_info(day_path, {"summary", "stations", "daily"})
    day_info.update({"key": "retail_day", "label": "零售每日快照", "date": completed_day.isoformat()})
    result.append(day_info)

    report_index = OILSTATION_ROOT / "exports" / ".monthly_report_index.json"
    workbook_info = {"key": "report_workbook", "label": "报表文件状态", "month": ym, "exists": False, "valid": False, "file": None}
    try:
        index = json.loads(report_index.read_text(encoding="utf-8-sig")) if report_index.exists() else {}
        file_name = (index.get(ym) or {}).get("file")
        workbook_path = OILSTATION_ROOT / "exports" / file_name if file_name else None
        if workbook_path:
            workbook_info.update(_file_info(workbook_path))
            workbook_info["file"] = file_name
    except Exception as exc:
        workbook_info["error"] = exc.__class__.__name__
    result.append(workbook_info)
    return result


ACCOUNTING_REPORT_ROOT = Path(r"D:\每日销量日报")
ACCOUNTING_REPORT_FILE_RE = re.compile(r"^(?:20\d{6})?(\d{3})(?:-(\d+))?\.xlsx$", re.IGNORECASE)


def _parse_date_arg(value: str | None, default_day: date | None = None) -> date:
    if not value:
        return default_day or (date.today() - timedelta(days=1))
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("日期格式应为 YYYY-MM-DD") from exc


def _accounting_day_folder(target_day: date) -> str:
    return target_day.strftime("%Y%m%d")


def _accounting_station_no(shop_key: int) -> str:
    return f"{shop_key:03d}"


def _accounting_file_station(file_name: str) -> tuple[int, int] | None:
    match = ACCOUNTING_REPORT_FILE_RE.fullmatch(file_name)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2) or 0)


def _station_payload(shop_key: int, catalog: dict[int, dict[str, Any]], status: dict[str, Any] | None = None) -> dict[str, Any]:
    station = catalog.get(shop_key) or {"name": f"Station-{shop_key}", "short": "", "region": ""}
    payload = {
        "shopKey": shop_key,
        "stationNo": _accounting_station_no(shop_key),
        "name": station.get("name") or f"Station-{shop_key}",
        "short": station.get("short") or "",
        "region": station.get("region") or "",
    }
    if status:
        payload.update({
            "status": status.get("status"),
            "statusType": status.get("statusType"),
            "statusLabel": status.get("statusLabel"),
            "closedReason": status.get("closedReason") or status.get("note") or "",
            "expectedResumeAt": status.get("expectedResumeAt"),
            "startedAt": status.get("startedAt"),
        })
    return payload


def _latest_automation_row(cur, task_name: str) -> dict[str, Any] | None:
    ensure_automation_task_schema(cur)
    cur.execute(
        """
        SELECT task_name, status, started_at, finished_at, summary, error
        FROM automation_task_runs
        WHERE task_name = %s
        ORDER BY started_at DESC, id DESC
        LIMIT 1
        """,
        (task_name,),
    )
    row = cur.fetchone()
    if not row:
        return None
    item = dict(row)
    for key in ("started_at", "finished_at"):
        value = item.get(key)
        item[key] = value.isoformat(sep=" ") if isinstance(value, datetime) else str(value) if value else None
    try:
        item["summary"] = json.loads(item["summary"]) if item.get("summary") else None
    except Exception:
        pass
    return item


def _accounting_report_status(cur, target_day: date) -> dict[str, Any]:
    catalog = retail_station_catalog_cached()
    statuses = active_station_statuses(cur)
    closed_statuses = {
        int(shop_key): status
        for shop_key, status in statuses.items()
        if status.get("affectsSales")
    }
    expected_shop_keys = [
        shop_key
        for shop_key in sorted(catalog)
        if shop_key not in closed_statuses
    ]
    output_dir = ACCOUNTING_REPORT_ROOT / _accounting_day_folder(target_day)
    archive_candidates = [
        ACCOUNTING_REPORT_ROOT / f"{_accounting_day_folder(target_day)}.rar",
        ACCOUNTING_REPORT_ROOT / f"{_accounting_day_folder(target_day)}.zip",
    ]
    generated_files: list[dict[str, Any]] = []
    generated_shop_keys: set[int] = set()
    unrecognized_files: list[str] = []
    if output_dir.exists():
        for path in sorted(output_dir.glob("*.xlsx"), key=lambda p: p.name):
            parsed = _accounting_file_station(path.name)
            stat = path.stat()
            file_info = {
                "file": path.name,
                "path": str(path),
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(sep=" ", timespec="seconds"),
            }
            if parsed:
                shop_key, sequence = parsed
                generated_shop_keys.add(shop_key)
                file_info.update({
                    "shopKey": shop_key,
                    "stationNo": _accounting_station_no(shop_key),
                    "sequence": sequence,
                    "station": _station_payload(shop_key, catalog),
                    "closed": shop_key in closed_statuses,
                })
            else:
                unrecognized_files.append(path.name)
            generated_files.append(file_info)

    missing_shop_keys = [shop_key for shop_key in expected_shop_keys if shop_key not in generated_shop_keys]
    closed_stations = [_station_payload(shop_key, catalog, status) for shop_key, status in sorted(closed_statuses.items())]
    unexpected_files = [
        item
        for item in generated_files
        if item.get("shopKey") and int(item["shopKey"]) not in expected_shop_keys
    ]
    archive = None
    for path in archive_candidates:
        if path.exists():
            stat = path.stat()
            archive = {
                "file": path.name,
                "path": str(path),
                "size": stat.st_size,
                "updatedAt": datetime.fromtimestamp(stat.st_mtime).isoformat(sep=" ", timespec="seconds"),
            }
            break

    latest = _latest_automation_row(cur, "retail_accounting_reports")
    warnings: list[str] = []
    skipped: list[dict[str, Any]] = []
    latest_summary = latest.get("summary") if isinstance(latest, dict) else None
    if isinstance(latest_summary, dict) and latest_summary.get("targetDate") == target_day.isoformat():
        warnings = list(latest_summary.get("warnings") or [])
        skipped = list(latest_summary.get("skipped") or [])

    if missing_shop_keys:
        status = "warning"
    elif not output_dir.exists():
        status = "pending"
    else:
        status = "ok"

    return {
        "targetDate": target_day.isoformat(),
        "checkedAt": datetime.now().isoformat(sep=" ", timespec="seconds"),
        "status": status,
        "reportRoot": str(ACCOUNTING_REPORT_ROOT),
        "outputDir": str(output_dir),
        "outputExists": output_dir.exists(),
        "archive": archive,
        "expectedCount": len(expected_shop_keys),
        "generatedStationCount": len(generated_shop_keys & set(expected_shop_keys)),
        "generatedFileCount": len(generated_files),
        "missingCount": len(missing_shop_keys),
        "closedCount": len(closed_stations),
        "unexpectedFileCount": len(unexpected_files),
        "expectedStations": [_station_payload(shop_key, catalog) for shop_key in expected_shop_keys],
        "missingStations": [_station_payload(shop_key, catalog) for shop_key in missing_shop_keys],
        "closedStations": closed_stations,
        "generatedFiles": generated_files,
        "unexpectedFiles": unexpected_files,
        "unrecognizedFiles": unrecognized_files,
        "warnings": warnings,
        "skipped": skipped,
        "latestRun": latest,
    }


def _run_retail_accounting_report_task(target_day: date | None = None, force: bool = True) -> dict[str, Any]:
    script = OILSTATION_ROOT / "scripts" / "generate_accounting_handover_reports.py"
    if not script.exists():
        raise RuntimeError(f"吉方会计日报脚本不存在：{script}")
    args = [sys.executable, str(script), "--archive"]
    if target_day:
        args.extend(["--date", target_day.isoformat()])
    if force:
        args.append("--force")
    completed = subprocess.run(
        args,
        cwd=str(OILSTATION_ROOT),
        capture_output=True,
        text=True,
        timeout=900,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    if completed.returncode != 0:
        raise RuntimeError(output[-1200:] or f"吉方会计日报脚本退出码 {completed.returncode}")
    try:
        return json.loads(output)
    except Exception as exc:
        raise RuntimeError("吉方会计日报脚本返回内容不是 JSON") from exc


def _overall_status(cache_items: list[dict[str, Any]], api_summary: dict[str, Any], automation: list[dict[str, Any]]) -> str:
    if any(not item.get("exists") or not item.get("valid") for item in cache_items):
        return "warning"
    if api_summary.get("failed24h", 0) > 0:
        return "warning"
    if any(item.get("status") == "failed" for item in automation[:10]):
        return "warning"
    return "ok"


def _api_summary(cur) -> dict[str, Any]:
    ensure_audit_schema(cur)
    cur.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
               AVG(duration_ms) AS avg_duration_ms
        FROM system_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
    """)
    row = cur.fetchone() or {}
    cur.execute("""
        SELECT path, COUNT(*) AS calls, SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
               AVG(duration_ms) AS avg_duration_ms, MAX(created_at) AS last_called_at
        FROM system_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        GROUP BY path
        ORDER BY calls DESC
        LIMIT 20
    """)
    top = [dict(item) for item in cur.fetchall()]
    cur.execute("""
        SELECT id, username, module_key, action_key, method, path, status_code, success, duration_ms, created_at
        FROM system_operation_logs
        ORDER BY created_at DESC, id DESC
        LIMIT 80
    """)
    recent = []
    for item in cur.fetchall():
        row_item = dict(item)
        value = row_item.get("created_at")
        row_item["created_at"] = value.isoformat(sep=" ") if isinstance(value, datetime) else str(value)
        recent.append(row_item)
    return {
        "total24h": int(row.get("total") or 0),
        "failed24h": int(row.get("failed") or 0),
        "avgDurationMs24h": int(row.get("avg_duration_ms") or 0),
        "topPaths24h": top,
        "recent": recent,
    }


def _automation_rows(cur) -> list[dict[str, Any]]:
    ensure_automation_task_schema(cur)
    cur.execute("""
        SELECT r.task_name, r.status, r.started_at, r.finished_at, r.summary, r.error
        FROM automation_task_runs r
        JOIN (
            SELECT task_name, MAX(started_at) AS latest
            FROM automation_task_runs
            GROUP BY task_name
        ) x ON x.task_name = r.task_name AND x.latest = r.started_at
        ORDER BY r.started_at DESC
    """)
    result = []
    for row in cur.fetchall():
        item = dict(row)
        for key in ("started_at", "finished_at"):
            value = item.get(key)
            item[key] = value.isoformat(sep=" ") if isinstance(value, datetime) else str(value) if value else None
        try:
            item["summary"] = json.loads(item["summary"]) if item.get("summary") else None
        except Exception:
            pass
        result.append(item)
    return result


def _ai_status(cur) -> dict[str, Any]:
    from settings import get_settings

    settings = get_settings()
    ensure_ai_call_schema(cur)
    cur.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
               SUM(CASE WHEN status IN ('failed','source_query_failed') THEN 1 ELSE 0 END) AS failed_count,
               AVG(duration_ms) AS avg_duration_ms,
               MAX(created_at) AS last_called_at
        FROM ai_agent_call_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    """)
    row = cur.fetchone() or {}
    return {
        "configured": bool(settings.OPENROUTER_API_KEY),
        "provider": "openrouter",
        "model": settings.resolved_openrouter_model,
        "freeOnly": True,
        "total7d": int(row.get("total") or 0),
        "ok7d": int(row.get("ok_count") or 0),
        "failed7d": int(row.get("failed_count") or 0),
        "avgDurationMs": int(row.get("avg_duration_ms") or 0),
        "lastCalledAt": row["last_called_at"].isoformat(sep=" ") if isinstance(row.get("last_called_at"), datetime) else None,
    }


def _require_system_manage(cur, user_id: int):
    cur.execute(
        "SELECT id, username, role FROM system_users WHERE id = %s AND is_active = TRUE",
        (user_id,),
    )
    user = cur.fetchone()
    if not user:
        return None, (jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401)
    if user["role"] != "admin" and not has_permission(cur, user_id, "system_health:manage", user["role"]):
        return None, (jsonify({"code": 4003, "message": "forbidden", "data": None}), 403)
    return user, None


def _automation_error_payload(exc: Exception) -> dict[str, Any]:
    return {"status": "failed", "summary": {}, "error": str(exc)}


def _run_exchange_task(cur) -> dict[str, Any]:
    try:
        result = run_exchange_maintenance(cur)
        status = "success" if not result.get("errors") else "failed"
        error = json.dumps(result["errors"], ensure_ascii=False) if result.get("errors") else None
        record_automation_task(cur, "exchange_rates", status, result, error)
        return {"status": status, "summary": result, "error": error}
    except Exception as exc:
        record_automation_task(cur, "exchange_rates", "failed", {}, str(exc))
        return _automation_error_payload(exc)


def _run_market_watch_task(cur) -> dict[str, Any]:
    try:
        result = run_market_watch_maintenance(cur)
        status = "success" if not result.get("errors") else "failed"
        error = "; ".join(result["errors"]) if result.get("errors") else None
        record_automation_task(cur, "market_watch", status, result, error)
        return {"status": status, "summary": result, "error": error}
    except Exception as exc:
        record_automation_task(cur, "market_watch", "failed", {}, str(exc))
        return _automation_error_payload(exc)


def _run_retail_accounting_reports_task(cur, target_day: date | None = None, force: bool = True) -> dict[str, Any]:
    try:
        result = _run_retail_accounting_report_task(target_day=target_day, force=force)
        status = "success" if not result.get("warnings") else "failed"
        error = "; ".join(result.get("warnings") or []) or None
        record_automation_task(cur, "retail_accounting_reports", status, result, error)
        return {"status": status, "summary": result, "error": error}
    except Exception as exc:
        record_automation_task(cur, "retail_accounting_reports", "failed", {}, str(exc))
        return _automation_error_payload(exc)


def _retail_snapshot_worker():
    status = "success"
    error = None
    summary: dict[str, Any] = {}
    try:
        snapshot_result = run_retail_snapshot_maintenance()
        summary = {
            "retailSnapshots": snapshot_result,
            "retailAlertInsights": {
                "zh": generate_retail_alert_insights(use_ai=True, language="zh"),
                "ru": generate_retail_alert_insights(use_ai=True, language="ru"),
            },
        }
        message = "零售快照刷新完成"
    except Exception as exc:
        status = "failed"
        error = str(exc)
        message = error
    finally:
        with REFRESH_CACHE_LOCK:
            REFRESH_CACHE_STATUS.update({
                "running": False,
                "finishedAt": datetime.now().isoformat(timespec="seconds"),
                "status": status,
                "message": message,
                "items": summary.get("retailSnapshots", {}),
            })
        conn = get_connection()
        try:
            with conn.cursor() as cur:
                record_automation_task(cur, "retail_snapshots", status, summary, error)
                conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _queue_retail_snapshot_task() -> dict[str, Any]:
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
    thread = threading.Thread(target=_retail_snapshot_worker, name="retail-snapshot-refresh-v2", daemon=True)
    thread.start()
    return {"status": "queued", "message": "零售快照刷新已加入后台执行"}


@bp_v2.route("/system/health", methods=["GET"])
@jwt_required()
@permission_required("system_health:view")
def system_health():
    started_at = time.perf_counter()
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT 1 AS ok")
            db_ok = bool(cur.fetchone())
            cache_items = _cache_items()
            api = _api_summary(cur)
            automation = _automation_rows(cur)
            ai = _ai_status(cur)
            status = _overall_status(cache_items, api, automation)
            return jsonify({"code": 0, "message": "success", "data": {
                "status": status,
                "checkedAt": datetime.now().isoformat(sep=" "),
                "durationMs": int((time.perf_counter() - started_at) * 1000),
                "services": {
                    "backend": {"status": "ok"},
                    "database": {"status": "ok" if db_ok else "error"},
                    "openrouter": {"status": "ok" if ai["configured"] else "warning"},
                },
                "api": api,
                "cache": {"items": cache_items, "refresh": dict(REFRESH_CACHE_STATUS)},
                "automation": automation,
                "ai": ai,
            }})
    finally:
        conn.close()


@bp_v2.route("/system/accounting-reports/status", methods=["GET"])
@jwt_required()
@permission_required("system_health:view")
def accounting_report_status():
    try:
        target_day = _parse_date_arg(request.args.get("date"))
    except ValueError as exc:
        return jsonify({"code": 4221, "message": str(exc), "data": None}), 422
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            data = _accounting_report_status(cur, target_day)
            return jsonify({"code": 0, "message": "success", "data": data})
    finally:
        conn.close()


@bp_v2.route("/system/accounting-reports/generate", methods=["POST"])
@jwt_required()
def generate_accounting_reports():
    payload = request.get_json(silent=True) or {}
    try:
        target_day = _parse_date_arg(payload.get("date"))
    except ValueError as exc:
        return jsonify({"code": 4221, "message": str(exc), "data": None}), 422

    user_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _, error_response = _require_system_manage(cur, user_id)
            if error_response:
                return error_response
            result = _run_retail_accounting_reports_task(cur, target_day=target_day, force=True)
            conn.commit()
            status_data = _accounting_report_status(cur, target_day)
            return jsonify({"code": 0, "message": "success", "data": {"run": result, "status": status_data}})
    except Exception as exc:
        conn.rollback()
        return jsonify({"code": 5001, "message": str(exc), "data": None}), 500
    finally:
        conn.close()


@bp_v2.route("/system/automation-tasks/run", methods=["POST"])
@jwt_required()
def run_automation_task():
    payload = request.get_json(silent=True) or {}
    task = payload.get("task")
    allowed = {"exchange_rates", "market_watch", "retail_snapshots", "retail_accounting_reports", "all"}
    if task not in allowed:
        return jsonify({"code": 4221, "message": "请选择有效的自动任务", "data": None}), 422

    user_id = int(get_jwt_identity())
    results: dict[str, Any] = {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _, error_response = _require_system_manage(cur, user_id)
            if error_response:
                return error_response
            ensure_automation_task_schema(cur)
            if task in {"exchange_rates", "all"}:
                results["exchangeRates"] = _run_exchange_task(cur)
            if task in {"market_watch", "all"}:
                results["marketWatch"] = _run_market_watch_task(cur)
            if task in {"retail_accounting_reports", "all"}:
                results["retailAccountingReports"] = _run_retail_accounting_reports_task(cur, force=True)
            conn.commit()
    except Exception as exc:
        conn.rollback()
        return jsonify({"code": 5001, "message": str(exc), "data": None}), 500
    finally:
        conn.close()

    if task in {"retail_snapshots", "all"}:
        results["retailSnapshots"] = _queue_retail_snapshot_task()

    return jsonify({"code": 0, "message": "success", "data": {"task": task, "results": results}})


@bp_v2.route("/system/devtools-open", methods=["POST"])
@jwt_required()
def record_devtools_open():
    user_id = int(get_jwt_identity())
    try:
        conn = get_connection(autocommit=True)
        try:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                ensure_audit_schema(cur)
                cur.execute("SELECT username, display_name, role FROM system_users WHERE id = %s", (user_id,))
                user = cur.fetchone() or {}
                cur.execute("""
                    INSERT INTO system_operation_logs
                        (user_id, username, display_name, module_key, action_key, method, path,
                         endpoint, resource_type, status_code, success, request_body)
                    VALUES (%s, %s, %s, 'system_health', 'open_devtools', 'IPC', '/electron/devtools',
                            'electron_devtools', 'devtools', 200, 1, %s)
                """, (
                    user_id,
                    user.get("username"),
                    user.get("display_name"),
                    json.dumps({"role": user.get("role")}, ensure_ascii=False),
                ))
        finally:
            conn.close()
    except Exception:
        pass
    return jsonify({"code": 0, "message": "success", "data": None})
