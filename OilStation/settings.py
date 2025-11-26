from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent


def _load_env_file():
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_file()


class Settings(BaseSettings):
    model_config = {"env_file": None, "extra": "ignore"}

    # Server
    APP_HOST: str = "127.0.0.1"
    APP_PORT: int = 8900
    TITLE: str = "SNK-AZS Data API"

    # Database
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "reader"
    DB_PASSWORD: str = ""
    DB_NAME: str = "ocw"
    DB_CHARSET: str = "utf8mb4"

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = ""
    LOG_ROTATION: str = "10 MB"
    LOG_RETENTION: str = "30 days"

    @property
    def DB_CONFIG(self) -> dict:
        return {
            "host": self.DB_HOST,
            "port": self.DB_PORT,
            "user": self.DB_USER,
            "password": self.DB_PASSWORD,
            "database": self.DB_NAME,
            "charset": self.DB_CHARSET,
            "use_unicode": True,
        }

    @property
    def resolved_log_dir(self) -> Path:
        if self.LOG_DIR:
            return Path(self.LOG_DIR)
        return BASE_DIR / "logs"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
