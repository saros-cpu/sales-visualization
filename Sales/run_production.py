from __future__ import annotations

import os
from pathlib import Path
import threading
from datetime import datetime

from loguru import logger as log
from waitress import serve

from log_setup import setup_logging

setup_logging()

from api import app
from retail_internal import open_oilstation


APP_ROOT = Path(__file__).resolve().parent


def start_retail_cache_warmup():
    def worker():
        now = datetime.now()
        year_month = f"{now.year}-{now.month:02d}"
        paths = [
            ("/api/months", False, ""),
            ("/api/years", False, ""),
            (f"/api/dashboard/yearly", False, f"year={now.year}"),
            (f"/api/resources/yearly", False, f"year={now.year}"),
            (f"/api/monthly/{year_month}", False, ""),
            (f"/api/stations/{year_month}", False, ""),
            (f"/api/regions/{year_month}", False, ""),
            (f"/api/daily/{year_month}", False, ""),
        ]
        for path, refresh, query in paths:
            try:
                label = f"{path}?{query}" if query else path
                log.info("Retail cache warmup: {}", label)
                response = open_oilstation(
                    path,
                    query_string="&".join(part for part in (query, "refresh=1" if refresh else "") if part),
                )
                if response.status_code >= 400:
                    raise RuntimeError(response.get_data(as_text=True))
            except Exception:
                log.exception("Retail cache warmup failed: {}", path)

    thread = threading.Thread(target=worker, name="retail-cache-warmup", daemon=True)
    thread.start()


if __name__ == "__main__":
    host = os.getenv("SALES_HOST", "0.0.0.0")
    port = int(os.getenv("SALES_PORT", "8900"))
    log.info("Starting Sales Visualization on {}:{}", host, port)
    start_retail_cache_warmup()

    serve(app, host=host, port=port, threads=12)
