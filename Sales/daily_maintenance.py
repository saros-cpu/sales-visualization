from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import subprocess
import sys

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
            status = "success" if not result.get("warnings") else "failed"
            error = "; ".join(result.get("warnings") or []) or None
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
        timeout=900,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    if completed.returncode != 0:
        raise RuntimeError(output[-1200:] or f"吉方会计日报脚本退出码 {completed.returncode}")
    try:
        return json.loads(output)
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
