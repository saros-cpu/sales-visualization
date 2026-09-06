import json
import time
from calendar import monthrange
from datetime import datetime, timedelta
from pathlib import Path

from export_excel import EXPORT_DIR, MONTH_NAMES_RU, openpyxl, os


REPORT_INDEX_PATH = Path(EXPORT_DIR) / ".monthly_report_index.json"
WEEKLY_REPORT_DIR = Path(EXPORT_DIR) / "weekly"
WEEKLY_REPORT_INDEX_PATH = Path(EXPORT_DIR) / ".weekly_report_index.json"
REPORT_DATA_VERSION = "db-true-mass-ai80-0.721-price-v8-report-half-up-rounding-hide-closed-stations-lpg-rsk-infer-fix-20260904-tank-map-pin"
WEEKLY_REPORT_NAME_PREFIX = "加油站零售周报表"


def _load_report_index():
    if not REPORT_INDEX_PATH.exists():
        return {}
    try:
        data = json.loads(REPORT_INDEX_PATH.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _load_weekly_report_index():
    if not WEEKLY_REPORT_INDEX_PATH.exists():
        return {}
    try:
        data = json.loads(WEEKLY_REPORT_INDEX_PATH.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _weekly_report_key(date_from, date_to):
    return f"{date_from}_to_{date_to}"


def _weekly_report_filename(date_from, date_to):
    return f"{WEEKLY_REPORT_NAME_PREFIX}_{date_from}_至_{date_to}.xlsx"


def _weekly_report_workbook(date_from, date_to):
    item = _load_weekly_report_index().get(_weekly_report_key(date_from, date_to)) or {}
    filename = item.get("file")
    if not filename or filename != _weekly_report_filename(date_from, date_to):
        return None
    if item.get("dataVersion") != REPORT_DATA_VERSION:
        return None
    path = WEEKLY_REPORT_DIR / filename
    return path if path.exists() else None


def _record_weekly_report_workbook(date_from, date_to, path, source="manual"):
    path = Path(path)
    data = _load_weekly_report_index()
    data[_weekly_report_key(date_from, date_to)] = {
        "file": path.name,
        "dateFrom": date_from,
        "dateTo": date_to,
        "updatedAt": path.stat().st_mtime if path.exists() else None,
        "source": source,
        "dataVersion": REPORT_DATA_VERSION,
    }
    try:
        WEEKLY_REPORT_DIR.mkdir(parents=True, exist_ok=True)
        temp_path = WEEKLY_REPORT_INDEX_PATH.with_suffix(WEEKLY_REPORT_INDEX_PATH.suffix + ".tmp")
        content = json.dumps(data, ensure_ascii=False, indent=2)
        for attempt in range(5):
            try:
                temp_path.write_text(content, encoding="utf-8")
                temp_path.replace(WEEKLY_REPORT_INDEX_PATH)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))
    except OSError:
        pass


def _record_report_workbook(year_month, path, last_nonempty_day=None, data_version=REPORT_DATA_VERSION):
    path = Path(path)
    data = _load_report_index()
    item = {
        "file": path.name,
        "updatedAt": path.stat().st_mtime if path.exists() else None,
    }
    try:
        rel_path = path.resolve().relative_to(Path(EXPORT_DIR).resolve())
        item["path"] = rel_path.as_posix()
    except (OSError, ValueError):
        item["path"] = path.name
    if last_nonempty_day is not None:
        item["lastNonemptyDay"] = int(last_nonempty_day)
    elif data.get(year_month, {}).get("file") == path.name:
        previous_day = data[year_month].get("lastNonemptyDay")
        if previous_day is not None:
            item["lastNonemptyDay"] = previous_day
    item["dataVersion"] = data_version
    data[year_month] = item
    try:
        temp_path = REPORT_INDEX_PATH.with_suffix(REPORT_INDEX_PATH.suffix + ".tmp")
        content = json.dumps(data, ensure_ascii=False, indent=2)
        for attempt in range(5):
            try:
                temp_path.write_text(content, encoding="utf-8")
                temp_path.replace(REPORT_INDEX_PATH)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))
    except OSError:
        pass


def _indexed_report_workbook(year_month):
    item = _load_report_index().get(year_month) or {}
    stored_path = item.get("path") or item.get("file")
    if not stored_path:
        return None
    export_dir = Path(EXPORT_DIR).resolve()
    path = (export_dir / stored_path).resolve()
    if path != export_dir and export_dir not in path.parents:
        return None
    return path if path.exists() else None


def _latest_report_workbook(year_month):
    try:
        year, month = [int(part) for part in year_month.split("-")]
    except (TypeError, ValueError):
        return None
    month_ru = MONTH_NAMES_RU.get(month, "")
    indexed_path = _indexed_report_workbook(year_month)
    if indexed_path:
        return indexed_path
    export_dir = Path(EXPORT_DIR)
    if not export_dir.exists():
        return None
    for path in sorted(export_dir.rglob("*.xlsx"), key=lambda item: item.stat().st_mtime, reverse=True):
        workbook = None
        try:
            workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
            sheet = workbook["总表"] if "总表" in workbook.sheetnames else workbook[workbook.sheetnames[0]]
            title = str(sheet.cell(1, 1).value or "")
            if str(year) in title and month_ru and month_ru in title:
                _record_report_workbook(year_month, path, data_version="legacy")
                return path
        except Exception:
            continue
        finally:
            if workbook is not None:
                workbook.close()
    return None


def _workbook_last_nonempty_day(path):
    workbook = None
    last_day = 0
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for sheet_name in workbook.sheetnames:
            if not sheet_name.endswith("日") or not sheet_name[:2].isdigit():
                continue
            sheet = workbook[sheet_name]
            for row in sheet.iter_rows(min_row=5, values_only=True):
                if float(row[18] or 0) or float(row[20] or 0):
                    last_day = max(last_day, int(sheet_name[:2]))
                    break
    except Exception:
        return 0
    finally:
        if workbook is not None:
            workbook.close()
    return last_day


def _can_reuse_report_workbook(year_month, path):
    try:
        year, month = [int(part) for part in year_month.split("-")]
    except (TypeError, ValueError):
        return False
    today = datetime.now().date()
    if (year, month) > (today.year, today.month):
        return False
    item = _load_report_index().get(year_month) or {}
    if item.get("dataVersion") != REPORT_DATA_VERSION:
        return False
    last_day = item.get("lastNonemptyDay") if item.get("file") == path.name else None
    if last_day is None:
        last_day = _workbook_last_nonempty_day(path)
        _record_report_workbook(year_month, path, last_day)
    if (year, month) < (today.year, today.month):
        expected_day = monthrange(year, month)[1]
    else:
        completed_day = today - timedelta(days=1)
        expected_day = completed_day.day if (completed_day.year, completed_day.month) == (year, month) else 0
    return int(last_day or 0) >= expected_day
