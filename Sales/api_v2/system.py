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
    ensure_automation_task_schema,
    ensure_station_status_schema,
    record_automation_task,
    retail_station_catalog_cached,
)
from .assistant import ensure_ai_call_schema
from .audit_logs import ensure_audit_schema
from .authz import permission_required
from .permission_service import has_permission


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
DESKTOP_ROOT = WORKSPACE_ROOT / "SalesDesktop"
DESKTOP_DOWNLOAD_ROOT = DESKTOP_ROOT / "download"
REPORT_COMPARE_ROOT = WORKSPACE_ROOT / "report_compare_outputs"
AUTOMATION_TASK_KEYS = {
    "exchange_rates",
    "market_watch",
    "retail_snapshots",
    "retail_accounting_reports",
}
API_HEALTH_FAILURE_CONDITION = "success = 0 AND status_code NOT IN (401, 403)"


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


def _parse_latest_yml(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(r"^\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$", line)
        if not match:
            continue
        value = match.group(2).strip().strip("\"'")
        if value:
            result[match.group(1)] = value
    return result


def _desktop_update_status() -> dict[str, Any]:
    latest_path = DESKTOP_DOWNLOAD_ROOT / "latest.yml"
    files: list[dict[str, Any]] = []
    latest_info = _file_info(latest_path)
    latest_info.update({"key": "latest", "label": "latest.yml"})
    files.append(latest_info)
    metadata: dict[str, str] = {}
    error = None
    try:
        if latest_path.exists():
            metadata = _parse_latest_yml(latest_path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        error = exc.__class__.__name__

    version = metadata.get("version")
    installer_name = Path(metadata.get("path") or "").name
    installer_path = DESKTOP_DOWNLOAD_ROOT / installer_name if installer_name else None
    blockmap_path = DESKTOP_DOWNLOAD_ROOT / f"{installer_name}.blockmap" if installer_name else None

    if installer_path:
        installer_info = _file_info(installer_path)
        installer_info.update({"key": "installer", "label": installer_name})
        files.append(installer_info)
    if blockmap_path:
        blockmap_info = _file_info(blockmap_path)
        blockmap_info.update({"key": "blockmap", "label": blockmap_path.name})
        files.append(blockmap_info)

    expected_name = f"SalesDesktop Setup {version}.exe" if version else None
    warnings: list[str] = []
    if not latest_path.exists():
        warnings.append("latest.yml_missing")
    if not version:
        warnings.append("version_missing")
    if not installer_path or not installer_path.exists():
        warnings.append("installer_missing")
    if not blockmap_path or not blockmap_path.exists():
        warnings.append("blockmap_missing")
    if expected_name and installer_name and installer_name != expected_name:
        warnings.append("installer_version_mismatch")
    if error:
        warnings.append(error)

    return {
        "status": "ok" if not warnings else "warning",
        "downloadRoot": str(DESKTOP_DOWNLOAD_ROOT),
        "version": version,
        "path": installer_name or None,
        "sha512": metadata.get("sha512"),
        "files": files,
        "warnings": warnings,
    }


def _knowledge_index_status(cur) -> dict[str, Any]:
    from .knowledge import KNOWLEDGE_UPLOAD_ROOT, ensure_knowledge_schema

    ensure_knowledge_schema(cur)
    cur.execute("""
        SELECT extraction_status, COUNT(*) AS total
        FROM knowledge_attachments
        GROUP BY extraction_status
    """)
    counts = {
        str(row.get("extraction_status") or "pending"): int(row.get("total") or 0)
        for row in cur.fetchall()
    }
    cur.execute("SELECT COUNT(*) AS total FROM knowledge_attachments")
    total_row = cur.fetchone() or {}
    cur.execute("SELECT MAX(extracted_at) AS last_extracted_at FROM knowledge_attachments")
    last_row = cur.fetchone() or {}
    cur.execute("SELECT id, article_id, stored_name FROM knowledge_attachments")
    missing_files = []
    for row in cur.fetchall():
        path = KNOWLEDGE_UPLOAD_ROOT / str(row.get("article_id")) / str(row.get("stored_name") or "")
        if not path.exists():
            missing_files.append(int(row.get("id") or 0))

    failed = counts.get("failed", 0)
    pending = counts.get("pending", 0)
    missing = counts.get("missing", 0) + len(missing_files)
    last_extracted_at = last_row.get("last_extracted_at")
    warnings = []
    if pending:
        warnings.append("pending")
    if failed:
        warnings.append("failed")
    if missing:
        warnings.append("missing_files")

    return {
        "status": "ok" if not warnings else "warning",
        "attachmentCount": int(total_row.get("total") or 0),
        "indexedCount": counts.get("ok", 0),
        "pendingCount": pending,
        "failedCount": failed,
        "emptyCount": counts.get("empty", 0),
        "unsupportedCount": counts.get("unsupported", 0),
        "missingFileCount": missing,
        "counts": counts,
        "lastExtractedAt": last_extracted_at.isoformat(sep=" ") if isinstance(last_extracted_at, datetime) else None,
        "warnings": warnings,
    }


def _load_json_file(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _latest_report_audit_status() -> dict[str, Any]:
    if not REPORT_COMPARE_ROOT.exists():
        return {"status": "unknown", "found": False, "warnings": ["report_compare_outputs_missing"]}

    summaries = sorted(
        REPORT_COMPARE_ROOT.rglob("对比摘要.json"),
        key=lambda item: item.stat().st_mtime if item.exists() else 0,
        reverse=True,
    )
    if not summaries:
        return {"status": "unknown", "found": False, "warnings": ["report_audit_summary_missing"]}

    summary_path = summaries[0]
    data = _load_json_file(summary_path) or {}
    diff_counts = data.get("diffCounts") if isinstance(data.get("diffCounts"), dict) else {}
    period = data.get("period") if isinstance(data.get("period"), dict) else {}
    try:
        month_vs_254 = int(diff_counts.get("monthVs254") or 0)
    except (TypeError, ValueError):
        month_vs_254 = 0

    workbook = data.get("comparisonWorkbook")
    workbook_path = Path(str(workbook)) if workbook else None
    original_workbook = data.get("originalPathWorkbook")
    warnings: list[str] = []
    if month_vs_254 > 0:
        warnings.append("month_vs_254_pending")
    if workbook_path and not workbook_path.exists():
        warnings.append("comparison_workbook_missing")

    return {
        "status": "ok" if not warnings else "warning",
        "found": True,
        "summaryPath": str(summary_path),
        "periodStart": period.get("start"),
        "periodEnd": period.get("endInclusive"),
        "monthVs254": month_vs_254,
        "day20Vs84": int(diff_counts.get("day20Vs84") or 0),
        "selfUseVs24": int(diff_counts.get("selfUseVs24") or 0),
        "accountingVs84": int(diff_counts.get("accountingVs84") or 0),
        "comparisonWorkbook": workbook,
        "comparisonWorkbookExists": bool(workbook_path and workbook_path.exists()),
        "originalPathWorkbook": original_workbook,
        "updatedAt": datetime.fromtimestamp(summary_path.stat().st_mtime).isoformat(sep=" ", timespec="seconds"),
        "warnings": warnings,
    }


def _retail_alert_status(cur) -> dict[str, Any]:
    period = _active_month()
    try:
        cur.execute("""
            SELECT insight_date, period_key, language, trend_anomalies, suggestions, source_summary, ai_status, generated_at
            FROM retail_alert_insights
            WHERE period_key = %s AND language = 'zh'
            ORDER BY generated_at DESC
            LIMIT 1
        """, (period,))
        row = cur.fetchone()
    except pymysql.err.MySQLError as exc:
        return {
            "status": "unknown",
            "periodKey": period,
            "anomalyCount": 0,
            "suggestions": [],
            "warnings": [exc.__class__.__name__],
        }
    if not row:
        return {
            "status": "warning",
            "periodKey": period,
            "anomalyCount": 0,
            "suggestions": [],
            "warnings": ["retail_alert_insight_missing"],
        }

    try:
        anomalies = json.loads(row.get("trend_anomalies") or "[]")
    except Exception:
        anomalies = []
    try:
        suggestions = json.loads(row.get("suggestions") or "[]")
    except Exception:
        suggestions = []
    anomaly_count = len(anomalies) if isinstance(anomalies, list) else 0
    generated_at = row.get("generated_at")
    return {
        "status": "warning" if anomaly_count else "ok",
        "periodKey": row.get("period_key") or period,
        "insightDate": row.get("insight_date").isoformat() if hasattr(row.get("insight_date"), "isoformat") else row.get("insight_date"),
        "anomalyCount": anomaly_count,
        "suggestions": suggestions[:5] if isinstance(suggestions, list) else [],
        "aiStatus": row.get("ai_status"),
        "generatedAt": generated_at.isoformat(sep=" ") if isinstance(generated_at, datetime) else str(generated_at) if generated_at else None,
        "warnings": [],
    }


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


def _text_quality_score(text: str) -> int:
    return (
        len(re.findall(r"[\u4e00-\u9fff]", text)) * 5
        + len(re.findall(r"[А-Яа-яЁё]", text)) * 2
        - len(re.findall(r"[ÐÑÃÂ�]|Р[\u00a0-\u00bf]|С[\u0080-\u00bf]", text)) * 8
        - len(re.findall(r"[\u00c0-\u00ff]", text)) * 2
    )


def _decode_utf8_mojibake_text(value: Any) -> Any:
    if not isinstance(value, str) or not value:
        return value
    best = value
    best_score = _text_quality_score(value)
    for encoding in ("cp1251", "latin1", "cp1252"):
        try:
            candidate = value.encode(encoding).decode("utf-8")
        except UnicodeError:
            continue
        score = _text_quality_score(candidate)
        if score > best_score:
            best = candidate
            best_score = score
    return best


def _normalize_accounting_text(value: Any) -> Any:
    if isinstance(value, str):
        return _decode_utf8_mojibake_text(value)
    if isinstance(value, list):
        return [_normalize_accounting_text(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_accounting_text(item) for key, item in value.items()}
    return value


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


def _row_value(row: Any, key: str, index: int) -> Any:
    return row.get(key) if isinstance(row, dict) else row[index]


def _iso_or_none(value: Any) -> str | None:
    if not value:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _accounting_station_statuses_for_day(cur, target_day: date) -> dict[int, dict[str, Any]]:
    ensure_station_status_schema(cur)
    day_start = datetime.combine(target_day, datetime.min.time())
    day_end = day_start + timedelta(days=1)
    cur.execute(
        """
        SELECT id, shop_key, status_type, status_label, started_at, expected_resume_at,
               ended_at, affects_sales, affects_inventory, suppress_alerts, note, is_active
        FROM retail_station_status
        WHERE status_type <> 'normal'
          AND started_at < %s
          AND (ended_at IS NULL OR ended_at >= %s)
        ORDER BY shop_key, started_at DESC, id DESC
        """,
        (day_end, day_start),
    )
    catalog = retail_station_catalog_cached()
    statuses: dict[int, dict[str, Any]] = {}
    for row in cur.fetchall():
        shop_key = int(_row_value(row, "shop_key", 1))
        if shop_key in statuses:
            continue
        status_type = _row_value(row, "status_type", 2)
        status_label = _row_value(row, "status_label", 3)
        note = _row_value(row, "note", 10) or ""
        affects_sales = bool(_row_value(row, "affects_sales", 7))
        station = catalog.get(shop_key, {"name": f"Station-{shop_key}", "short": "", "region": ""})
        statuses[shop_key] = {
            "id": _row_value(row, "id", 0),
            "shopKey": shop_key,
            "name": station.get("name") or f"Station-{shop_key}",
            "short": station.get("short") or "",
            "region": station.get("region") or "",
            "status": "closed" if affects_sales else "warning",
            "statusType": status_type,
            "statusLabel": status_label,
            "closedReason": note or status_label or status_type,
            "note": note,
            "startedAt": _iso_or_none(_row_value(row, "started_at", 4)),
            "expectedResumeAt": _iso_or_none(_row_value(row, "expected_resume_at", 5)),
            "endedAt": _iso_or_none(_row_value(row, "ended_at", 6)),
            "affectsSales": affects_sales,
            "affectsInventory": bool(_row_value(row, "affects_inventory", 8)),
            "suppressAlerts": bool(_row_value(row, "suppress_alerts", 9)),
            "isActive": bool(_row_value(row, "is_active", 11)),
        }
    return statuses


def _accounting_failed_item_key(item: dict[str, Any]) -> tuple[Any, ...]:
    return (
        item.get("type"),
        item.get("shopKey"),
        item.get("file"),
        tuple(item.get("shiftKeys") or []),
        item.get("reason") or item.get("message"),
    )


def _dedupe_accounting_failed_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        key = _accounting_failed_item_key(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _accounting_failed_items_from_summary(
    summary: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(summary, dict):
        return []
    summary = _normalize_accounting_text(summary)
    catalog = catalog or retail_station_catalog_cached()
    items: list[dict[str, Any]] = []
    for skipped in summary.get("skipped") or []:
        if not isinstance(skipped, dict):
            continue
        shop_key = skipped.get("shopKey")
        try:
            shop_key = int(shop_key)
        except (TypeError, ValueError):
            shop_key = None
        item: dict[str, Any] = {
            "type": "skipped",
            "reason": skipped.get("reason") or "skipped",
        }
        for key in ("file", "shiftKeys", "shiftBegin", "shiftEnd"):
            if skipped.get(key) not in (None, "", []):
                item[key] = skipped.get(key)
        if shop_key is not None:
            item.update({
                "shopKey": shop_key,
                "stationNo": _accounting_station_no(shop_key),
                "station": _station_payload(shop_key, catalog),
            })
        items.append(item)

    for warning in summary.get("warnings") or []:
        text = str(warning or "").strip()
        if not text:
            continue
        item = {"type": "warning", "reason": text, "message": text}
        match = re.match(r"^(\d{1,3})\s*[:：]\s*(.+)$", text)
        if match:
            shop_key = int(match.group(1))
            item.update({
                "shopKey": shop_key,
                "stationNo": _accounting_station_no(shop_key),
                "station": _station_payload(shop_key, catalog),
                "reason": match.group(2).strip() or text,
            })
        items.append(item)

    for failed_item in summary.get("failedItems") or []:
        if not isinstance(failed_item, dict):
            continue
        item = dict(failed_item)
        item.setdefault("type", "failed")
        if not item.get("reason") and item.get("message"):
            item["reason"] = item["message"]
        shop_key = item.get("shopKey")
        try:
            shop_key = int(shop_key)
        except (TypeError, ValueError):
            shop_key = None
        if shop_key is not None:
            item["shopKey"] = shop_key
            item.setdefault("stationNo", _accounting_station_no(shop_key))
            item.setdefault("station", _station_payload(shop_key, catalog))
        items.append(item)
    return _dedupe_accounting_failed_items(items)


def _accounting_missing_failed_items(
    missing_shop_keys: list[int],
    catalog: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        {
            "type": "missing",
            "shopKey": shop_key,
            "stationNo": _accounting_station_no(shop_key),
            "station": _station_payload(shop_key, catalog),
            "reason": "expected station report file missing",
        }
        for shop_key in missing_shop_keys
    ]


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


def _parse_accounting_status_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("T", " "))
    except ValueError:
        return None


def _accounting_summary_artifact_updated_at(
    summary: dict[str, Any] | None,
    output_dir: Path,
    archive: dict[str, Any] | None,
) -> datetime | None:
    if not isinstance(summary, dict):
        return None
    updated_at: list[datetime] = []
    for item in summary.get("generated") or []:
        if not isinstance(item, dict):
            continue
        file_name = Path(str(item.get("file") or "")).name
        if not file_name:
            continue
        path = output_dir / file_name
        if path.exists():
            updated_at.append(datetime.fromtimestamp(path.stat().st_mtime))
    if not updated_at and archive and archive.get("path"):
        archive_path = Path(str(archive["path"]))
        if archive_path.exists():
            updated_at.append(datetime.fromtimestamp(archive_path.stat().st_mtime))
    return max(updated_at) if updated_at else None


def _accounting_report_status(cur, target_day: date) -> dict[str, Any]:
    catalog = retail_station_catalog_cached()
    statuses = _accounting_station_statuses_for_day(cur, target_day)
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

    if generated_shop_keys:
        closed_statuses = {
            shop_key: status
            for shop_key, status in closed_statuses.items()
            if shop_key not in generated_shop_keys
        }
        for item in generated_files:
            if item.get("shopKey"):
                item["closed"] = int(item["shopKey"]) in closed_statuses
        expected_shop_keys = [
            shop_key
            for shop_key in sorted(catalog)
            if shop_key not in closed_statuses
        ]
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
    latest_summary = _normalize_accounting_text(latest.get("summary")) if isinstance(latest, dict) else None
    if isinstance(latest, dict) and isinstance(latest_summary, dict):
        latest = {**latest, "summary": latest_summary}
    latest_summary_for_target = latest_summary if (
        isinstance(latest_summary, dict)
        and latest_summary.get("targetDate") == target_day.isoformat()
    ) else None
    latest_artifact_at = _accounting_summary_artifact_updated_at(latest_summary_for_target, output_dir, archive)
    latest_run_at = _parse_accounting_status_datetime(
        latest.get("finished_at") or latest.get("started_at")
    ) if isinstance(latest, dict) else None
    if (
        latest_summary_for_target
        and latest_artifact_at
        and latest_run_at
        and latest_artifact_at > latest_run_at + timedelta(seconds=1)
    ):
        latest_summary_for_target = None
        if isinstance(latest, dict):
            latest = {
                **latest,
                "stale": True,
                "artifactUpdatedAt": latest_artifact_at.isoformat(sep=" ", timespec="seconds"),
                "ignoredReason": "report files were updated after this automation run",
            }
    if latest_summary_for_target:
        warnings = list(latest_summary_for_target.get("warnings") or [])
        skipped = list(latest_summary_for_target.get("skipped") or [])

    failed_items = _dedupe_accounting_failed_items(
        _accounting_failed_items_from_summary(latest_summary_for_target, catalog)
        + _accounting_missing_failed_items(missing_shop_keys, catalog)
    )
    if missing_shop_keys:
        status = "warning"
    elif failed_items:
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
        "failedCount": len(failed_items),
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
        "failedItems": failed_items,
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
        encoding="utf-8",
        errors="replace",
        timeout=900,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    if completed.returncode != 0:
        raise RuntimeError(output[-1200:] or f"吉方会计日报脚本退出码 {completed.returncode}")
    try:
        return _normalize_accounting_text(json.loads(output))
    except Exception as exc:
        raise RuntimeError("吉方会计日报脚本返回内容不是 JSON") from exc


def _overall_status(
    cache_items: list[dict[str, Any]],
    api_summary: dict[str, Any],
    automation: list[dict[str, Any]],
    knowledge: dict[str, Any] | None = None,
    updater: dict[str, Any] | None = None,
    action_items: list[dict[str, Any]] | None = None,
) -> str:
    if any(not item.get("exists") or not item.get("valid") for item in cache_items):
        return "warning"
    if api_summary.get("failed24h", 0) > 0:
        return "warning"
    if any(item.get("status") == "failed" for item in automation[:10]):
        return "warning"
    if any(item and item.get("status") != "ok" for item in (knowledge, updater)):
        return "warning"
    if any(item.get("severity") in {"danger", "warning"} for item in (action_items or [])):
        return "warning"
    return "ok"


def _action_center(
    cache_items: list[dict[str, Any]],
    api_summary: dict[str, Any],
    automation: list[dict[str, Any]],
    ai: dict[str, Any],
    knowledge: dict[str, Any],
    updater: dict[str, Any],
    accounting: dict[str, Any],
    retail_alerts: dict[str, Any],
    report_audit: dict[str, Any],
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []

    def add(
        code: str,
        severity: str,
        category: str,
        title: str,
        detail: str,
        owner: str,
        action: str,
        *,
        count: int | None = None,
        updated_at: str | None = None,
    ) -> None:
        items.append({
            "code": code,
            "severity": severity,
            "category": category,
            "title": title,
            "detail": detail,
            "owner": owner,
            "action": action,
            "count": count,
            "updatedAt": updated_at,
        })

    invalid_cache = [item for item in cache_items if not item.get("exists") or not item.get("valid")]
    if invalid_cache:
        add(
            "cache_invalid",
            "warning",
            "cache",
            "缓存快照需要刷新",
            f"{len(invalid_cache)} 个快照缺失或结构异常：{', '.join(item.get('label') or item.get('key') or '-' for item in invalid_cache[:4])}",
            "运维/数据",
            "补跑零售/自用油快照，或检查报表索引文件。",
            count=len(invalid_cache),
        )

    failed_api = int(api_summary.get("failed24h") or 0)
    if failed_api:
        add(
            "api_failed_24h",
            "danger" if failed_api >= 5 else "warning",
            "api",
            "24 小时内存在接口失败",
            f"最近 24 小时失败接口 {failed_api} 次，请优先查看 API 调用页签的失败路径。",
            "运维",
            "按失败路径检查后端日志、token 过期、下载白名单或网络状态。",
            count=failed_api,
        )

    failed_tasks = [
        item for item in automation
        if item.get("task_name") in AUTOMATION_TASK_KEYS and item.get("status") == "failed"
    ]
    if failed_tasks:
        add(
            "automation_failed",
            "danger",
            "automation",
            "自动任务最近执行失败",
            f"{len(failed_tasks)} 个任务失败：{', '.join(str(item.get('task_name') or '-') for item in failed_tasks[:4])}",
            "运维",
            "查看自动任务页签错误信息，修复后按需手动补跑。",
            count=len(failed_tasks),
        )

    missing_count = int(accounting.get("missingCount") or 0)
    if missing_count:
        add(
            "accounting_reports_missing",
            "warning",
            "report",
            "吉方交接日报缺站",
            f"{accounting.get('targetDate') or '上一业务日'} 有 {missing_count} 个应生成站点缺少日报。",
            "财务/运维",
            "进入吉方日报页签确认缺站，必要时重新生成。",
            count=missing_count,
            updated_at=accounting.get("checkedAt"),
        )

    knowledge_issues = int(knowledge.get("failedCount") or 0) + int(knowledge.get("missingFileCount") or 0)
    pending_count = int(knowledge.get("pendingCount") or 0)
    if knowledge_issues or pending_count:
        add(
            "knowledge_index_attention",
            "danger" if knowledge_issues else "warning",
            "knowledge",
            "知识库附件索引需要处理",
            f"失败/缺失 {knowledge_issues} 个，待索引 {pending_count} 个。",
            "管理员",
            "进入知识库执行附件重建索引，失败附件需检查源文件。",
            count=knowledge_issues + pending_count,
            updated_at=knowledge.get("lastExtractedAt"),
        )

    updater_warnings = list(updater.get("warnings") or [])
    if updater_warnings:
        add(
            "desktop_update_attention",
            "danger" if any("missing" in str(item) for item in updater_warnings) else "warning",
            "release",
            "客户端更新源需要检查",
            f"更新源提醒：{', '.join(str(item) for item in updater_warnings)}。",
            "发布维护",
            "确认 latest.yml、安装包、blockmap 三件套版本和文件大小一致。",
            count=len(updater_warnings),
        )

    ai_failed = int(ai.get("failed7d") or 0)
    if ai_failed:
        add(
            "ai_failed_7d",
            "warning",
            "ai",
            "AI 助手近期调用失败",
            f"最近 7 天 AI 调用失败 {ai_failed} 次。",
            "运维",
            "检查 OpenRouter 配置、模型可用性和网络访问；业务接口保持只读。",
            count=ai_failed,
            updated_at=ai.get("lastCalledAt"),
        )

    anomaly_count = int(retail_alerts.get("anomalyCount") or 0)
    if anomaly_count:
        add(
            "retail_trend_anomaly",
            "warning",
            "retail",
            "零售趋势存在异常提醒",
            f"{retail_alerts.get('periodKey') or _active_month()} 检测到 {anomaly_count} 条趋势异常。",
            "销售管理",
            "进入零售预警页核查异常日期、站点营业状态、库存和价格调整。",
            count=anomaly_count,
            updated_at=retail_alerts.get("generatedAt"),
        )
    elif retail_alerts.get("warnings"):
        add(
            "retail_alert_insight_missing",
            "warning",
            "retail",
            "零售预警洞察未生成",
            f"{retail_alerts.get('periodKey') or _active_month()} 暂未找到零售预警洞察记录。",
            "销售管理/运维",
            "补跑零售/自用油快照，或进入零售预警页刷新洞察。",
            count=1,
        )

    month_vs_254 = int(report_audit.get("monthVs254") or 0)
    if report_audit.get("found") and month_vs_254:
        add(
            "report_254_pending",
            "warning",
            "report",
            "零售总表 254 差异待确认",
            f"{report_audit.get('periodStart') or '-'} 至 {report_audit.get('periodEnd') or '-'} 机器摘要仍有 {month_vs_254} 个差异项。",
            "报表维护",
            "打开综合对比工作簿逐项确认，并把结论写入报表验数记录。",
            count=month_vs_254,
            updated_at=report_audit.get("updatedAt"),
        )

    severity_order = {"danger": 0, "warning": 1, "info": 2}
    items.sort(key=lambda item: (severity_order.get(item["severity"], 9), item["category"], item["code"]))
    summary = {
        "openCount": len(items),
        "dangerCount": sum(1 for item in items if item["severity"] == "danger"),
        "warningCount": sum(1 for item in items if item["severity"] == "warning"),
        "infoCount": sum(1 for item in items if item["severity"] == "info"),
        "status": "ok" if not items else "warning",
    }
    return {"summary": summary, "items": items}


def _api_summary(cur) -> dict[str, Any]:
    ensure_audit_schema(cur)
    cur.execute("""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN {failure_condition} THEN 1 ELSE 0 END) AS failed,
               AVG(duration_ms) AS avg_duration_ms
        FROM system_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
    """.format(failure_condition=API_HEALTH_FAILURE_CONDITION))
    row = cur.fetchone() or {}
    cur.execute("""
        SELECT path, COUNT(*) AS calls,
               SUM(CASE WHEN {failure_condition} THEN 1 ELSE 0 END) AS failed,
               AVG(duration_ms) AS avg_duration_ms, MAX(created_at) AS last_called_at
        FROM system_operation_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        GROUP BY path
        ORDER BY calls DESC
        LIMIT 20
    """.format(failure_condition=API_HEALTH_FAILURE_CONDITION))
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
        if item.get("task_name") not in AUTOMATION_TASK_KEYS:
            continue
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
        failed_items = _accounting_failed_items_from_summary(result)
        result["failedItems"] = failed_items
        result["failedCount"] = len(failed_items)
        status = "success" if not failed_items else "failed"
        error = "; ".join(str(item.get("reason") or item.get("message") or item.get("type")) for item in failed_items[:8]) or None
        record_automation_task(cur, "retail_accounting_reports", status, result, error)
        return {"status": status, "summary": result, "error": error, "failedItems": failed_items, "failedCount": len(failed_items)}
    except Exception as exc:
        failed_items = [{"type": "exception", "reason": str(exc), "message": str(exc)}]
        record_automation_task(
            cur,
            "retail_accounting_reports",
            "failed",
            {"failedItems": failed_items, "failedCount": len(failed_items)},
            str(exc),
        )
        payload = _automation_error_payload(exc)
        payload.update({"failedItems": failed_items, "failedCount": len(failed_items)})
        return payload


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
            knowledge = _knowledge_index_status(cur)
            updater = _desktop_update_status()
            accounting = _accounting_report_status(cur, date.today() - timedelta(days=1))
            retail_alerts = _retail_alert_status(cur)
            report_audit = _latest_report_audit_status()
            action_center = _action_center(
                cache_items,
                api,
                automation,
                ai,
                knowledge,
                updater,
                accounting,
                retail_alerts,
                report_audit,
            )
            status = _overall_status(cache_items, api, automation, knowledge, updater, action_center["items"])
            return jsonify({"code": 0, "message": "success", "data": {
                "status": status,
                "checkedAt": datetime.now().isoformat(sep=" "),
                "durationMs": int((time.perf_counter() - started_at) * 1000),
                "services": {
                    "backend": {"status": "ok"},
                    "database": {"status": "ok" if db_ok else "error"},
                    "openrouter": {"status": "ok" if ai["configured"] else "warning"},
                    "knowledgeIndex": {"status": knowledge["status"]},
                    "desktopUpdate": {"status": updater["status"]},
                },
                "api": api,
                "cache": {"items": cache_items, "refresh": dict(REFRESH_CACHE_STATUS)},
                "automation": automation,
                "ai": ai,
                "knowledge": knowledge,
                "updater": updater,
                "accountingLatest": accounting,
                "retailAlerts": retail_alerts,
                "reportAudit": report_audit,
                "actionCenter": action_center,
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
    allowed = set(AUTOMATION_TASK_KEYS) | {"all"}
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
