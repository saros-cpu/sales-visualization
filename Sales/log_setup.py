from __future__ import annotations

import atexit
import logging
import sys
import warnings

from loguru import logger

from settings import get_settings

_handlers: list[int] = []


class InterceptHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def _cleanup():
    global _handlers
    for hid in _handlers:
        try:
            logger.remove(hid)
        except ValueError:
            pass
    _handlers.clear()


def setup_logging():
    global _handlers
    _cleanup()
    logger.remove()
    warnings.filterwarnings("ignore", category=DeprecationWarning)

    settings = get_settings()
    fmt = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
    )
    file_fmt = (
        "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | "
        "{name}:{function}:{line} | {message}"
    )

    hid = logger.add(sys.stdout, format=fmt, level=settings.LOG_LEVEL, colorize=True)
    _handlers.append(hid)

    log_dir = settings.resolved_log_dir
    log_dir.mkdir(parents=True, exist_ok=True)

    hid = logger.add(
        str(log_dir / "info.log"),
        format=file_fmt,
        level="INFO",
        rotation=settings.LOG_ROTATION,
        retention=settings.LOG_RETENTION,
        encoding="utf-8",
    )
    _handlers.append(hid)

    hid = logger.add(
        str(log_dir / "error.log"),
        format=file_fmt,
        level="ERROR",
        rotation=settings.LOG_ROTATION,
        retention=settings.LOG_RETENTION,
        encoding="utf-8",
        backtrace=True,
        diagnose=True,
    )
    _handlers.append(hid)

    logging.basicConfig(handlers=[InterceptHandler()], level=settings.LOG_LEVEL, force=True)
    for name in logging.root.manager.loggerDict:
        std = logging.getLogger(name)
        std.handlers = [InterceptHandler()]
        std.propagate = False

    atexit.register(_cleanup)
