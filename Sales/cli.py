from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from loguru import logger

cli = typer.Typer(name="sales", help="Sales Visualization 命令行工具")

APP_ROOT = Path(__file__).resolve().parent


def _init_env():
    from log_setup import setup_logging
    setup_logging()


@cli.command(help="启动开发服务器")
def run(
    host: str = "0.0.0.0",
    port: int = 8900,
    debug: bool = True,
):
    _init_env()
    os.environ["SALES_HOST"] = host
    os.environ["SALES_PORT"] = str(port)
    sys.path.insert(0, str(APP_ROOT))
    from api import app
    logger.info("Starting dev server on {}:{}", host, port)
    app.run(host=host, port=port, debug=debug)


@cli.command(help="启动生产服务器 (Waitress)")
def serve(
    host: str = "0.0.0.0",
    port: int = 8900,
    threads: int = 12,
):
    _init_env()
    os.environ["SALES_HOST"] = host
    os.environ["SALES_PORT"] = str(port)
    sys.path.insert(0, str(APP_ROOT))
    from waitress import serve as wsgi_serve
    from api import app
    from run_production import start_retail_cache_warmup

    start_retail_cache_warmup()
    logger.info("Starting production server on {}:{} ({} threads)", host, port, threads)
    wsgi_serve(app, host=host, port=port, threads=threads)


@cli.command(help="预热零售缓存")
def cache_warm():
    _init_env()
    sys.path.insert(0, str(APP_ROOT))
    from retail_internal import open_oilstation
    from datetime import datetime

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
        label = f"{path}?{query}" if query else path
        logger.info("Cache warmup: {}", label)
        qs = "&".join(p for p in (query, "refresh=1" if refresh else "") if p)
        response = open_oilstation(path, query_string=qs)
        if response.status_code >= 400:
            logger.error("Cache warmup failed: {} ({} {})", path, response.status_code, response.get_data(as_text=True))
        else:
            logger.info("Cache warmup OK: {}", label)
    logger.info("Cache warmup complete")


if __name__ == "__main__":
    cli()
