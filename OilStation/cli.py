from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from loguru import logger

cli = typer.Typer(name="oilstation", help="SNK-AZS 数据 API 命令行工具")

APP_ROOT = Path(__file__).resolve().parent


def _init_env():
    from log_setup import setup_logging
    setup_logging()


@cli.command(help="启动开发服务器")
def run(
    host: str = "0.0.0.0",
    port: int = 8900,
    debug: bool = False,
):
    _init_env()
    os.environ["APP_HOST"] = host
    os.environ["APP_PORT"] = str(port)
    sys.path.insert(0, str(APP_ROOT))
    from api import app
    logger.info("Starting OilStation dev server on {}:{}", host, port)
    app.run(host=host, port=port, debug=debug)


@cli.command(help="预热零售缓存")
def cache_warm():
    _init_env()
    sys.path.insert(0, str(APP_ROOT))
    from api import _warm_cache_background
    logger.info("Starting cache warmup...")
    _warm_cache_background()
    logger.info("Cache warmup complete")


if __name__ == "__main__":
    cli()
