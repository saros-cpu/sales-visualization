from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from shared_utils import OILSTATION_ROOT, ensure_automation_task_schema, REFRESH_CACHE_STATUS
from .assistant import ensure_ai_call_schema
from .audit_logs import ensure_audit_schema
from .authz import permission_required


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
