from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from shared_utils import record_automation_task
from shared_utils import OILSTATION_ROOT
from routes_data import (
    run_exchange_maintenance,
    run_market_watch_maintenance,
    run_retail_snapshot_maintenance,
)
from services.retail_alert_service import generate_retail_alert_insights
from db import get_connection


APP_ROOT = Path(__file__).resolve().parent
LOG_DIR = APP_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    filename=LOG_DIR / "daily_maintenance.log",
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)


def _accounting_station_no(shop_key: int) -> str:
    return str(shop_key).zfill(3)


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


def normalize_accounting_text(value: Any) -> Any:
    if isinstance(value, str):
        return _decode_utf8_mojibake_text(value)
    if isinstance(value, list):
        return [normalize_accounting_text(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_accounting_text(item) for key, item in value.items()}
    return value


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


def accounting_failed_items_from_summary(summary: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(summary, dict):
        return []
    summary = normalize_accounting_text(summary)

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
            item["shopKey"] = shop_key
            item["stationNo"] = _accounting_station_no(shop_key)
        items.append(item)

    for warning in summary.get("warnings") or []:
        text = str(warning or "").strip()
        if not text:
            continue
        item: dict[str, Any] = {"type": "warning", "reason": text, "message": text}
        match = re.match(r"^(\d{1,3})\s*[:：]\s*(.+)$", text)
        if match:
            shop_key = int(match.group(1))
            item.update({
                "shopKey": shop_key,
                "stationNo": _accounting_station_no(shop_key),
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
        items.append(item)

    return _dedupe_accounting_failed_items(items)


def _accounting_failure_error(failed_items: list[dict[str, Any]]) -> str | None:
    messages = [
        str(item.get("reason") or item.get("message") or item.get("type"))
        for item in failed_items[:8]
        if item.get("reason") or item.get("message") or item.get("type")
    ]
    return "; ".join(messages) or None


def run_task(task_name: str):
    conn = get_connection()
    try:
        cur = conn.cursor()
        if task_name == "exchange_rates":
            result = run_exchange_maintenance(cur)
            status = "success" if not result["errors"] else "failed"
            error = str(result["errors"]) if result["errors"] else None
        elif task_name == "market_watch":
            result = run_market_watch_maintenance(cur)
            status = "success" if not result["errors"] else "failed"
            error = "; ".join(result["errors"]) if result["errors"] else None
        elif task_name == "retail_snapshots":
            result = run_retail_snapshot_maintenance()
            result = {
                "retailSnapshots": result,
                "retailAlertInsights": {
                    "zh": generate_retail_alert_insights(use_ai=True, language="zh"),
                    "ru": generate_retail_alert_insights(use_ai=True, language="ru"),
                },
            }
            status = "success"
            error = None
        elif task_name == "retail_accounting_reports":
            result = run_retail_accounting_report_maintenance()
            failed_items = accounting_failed_items_from_summary(result)
            result["failedItems"] = failed_items
            result["failedCount"] = len(failed_items)
            status = "success" if not failed_items else "failed"
            error = _accounting_failure_error(failed_items)
        else:
            raise ValueError(f"Unknown task: {task_name}")
        record_automation_task(cur, task_name, status, result, error)
        conn.commit()
        logging.info("%s finished with %s: %s", task_name, status, result)
        return result
    except Exception:
        conn.rollback()
        logging.exception("%s failed", task_name)
        raise
    finally:
        conn.close()


def run_retail_accounting_report_maintenance():
    script = OILSTATION_ROOT / "scripts" / "generate_accounting_handover_reports.py"
    if not script.exists():
        raise RuntimeError(f"吉方会计日报脚本不存在：{script}")
    completed = subprocess.run(
        [sys.executable, str(script), "--archive"],
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
        return normalize_accounting_text(json.loads(output))
    except Exception:
        return {
            "returnCode": completed.returncode,
            "outputTail": output[-1200:],
            "warnings": ["日报任务执行成功，但返回内容不是 JSON"],
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--task",
        choices=["exchange_rates", "market_watch", "retail_snapshots", "retail_accounting_reports", "all"],
        default="all",
    )
    args = parser.parse_args()
    tasks = ["exchange_rates", "market_watch", "retail_snapshots", "retail_accounting_reports"] if args.task == "all" else [args.task]
    for task in tasks:
        run_task(task)


if __name__ == "__main__":
    main()
