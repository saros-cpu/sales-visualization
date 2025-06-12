from __future__ import annotations

import argparse
import logging
from pathlib import Path

from api import (
    record_automation_task,
    run_exchange_maintenance,
    run_market_watch_maintenance,
    run_retail_snapshot_maintenance,
)
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
            status = "success"
            error = None
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["exchange_rates", "market_watch", "retail_snapshots", "all"], default="all")
    args = parser.parse_args()
    tasks = ["exchange_rates", "market_watch", "retail_snapshots"] if args.task == "all" else [args.task]
    for task in tasks:
        run_task(task)


if __name__ == "__main__":
    main()
