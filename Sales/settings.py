from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent


def _load_env_files():
    """Load .env files before Settings reads os.environ."""
    for env_path in (BASE_DIR / ".env", BASE_DIR.parent / "OilStation" / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


_load_env_files()


class Settings(BaseSettings):
    model_config = {"env_file": None, "extra": "ignore"}

    # Server
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8900
    TITLE: str = "Sales Visualization API"

    # Database
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "reader"
    DB_PASSWORD: str = ""
    SALES_DB_NAME: str = "sales_visualization"
    DB_NAME: str = "ocw"
    DB_CHARSET: str = "utf8mb4"

    # Auth
    SALES_SECRET_KEY: str = ""
    SALES_JWT_SECRET: str = ""
    SALES_LOGIN_REMEMBER_DAYS: int = 14
    SALES_COOKIE_SECURE: str = ""

    # External URLs
    OILSTATION_BASE_URL: str = "http://127.0.0.1:8900"
    NBKR_DAILY_XML_URL: str = "https://www.nbkr.kg/XML/daily.xml"
    NBKR_RATES_PAGE_URL: str = "https://www.nbkr.kg/index1.jsp"

    # AI assistant (read-only). Only free OpenRouter models are allowed.
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1/chat/completions"
    OPENROUTER_MODEL: str = "openrouter/free"
    OPENROUTER_APP_TITLE: str = "Sales Visualization"
    OPENROUTER_HTTP_REFERER: str = ""
    OPENROUTER_TIMEOUT_SECONDS: int = 30
    OPENROUTER_MAX_TOKENS: int = 900
    OPENROUTER_TEMPERATURE: float = 0.2
    ASSISTANT_LLM_PROVIDER: str = "openrouter"
    LOCAL_LLM_BASE_URL: str = "http://127.0.0.1:11434/v1/chat/completions"
    LOCAL_LLM_MODEL: str = "qwen2.5:7b"
    LOCAL_LLM_API_KEY: str = ""
    LOCAL_LLM_TIMEOUT_SECONDS: int = 60

    # Logging
    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = ""
    LOG_ROTATION: str = "10 MB"
    LOG_RETENTION: str = "30 days"

    @property
    def DB_CONFIG(self) -> dict:
        db = self.SALES_DB_NAME or self.DB_NAME
        if db == "ocw":
            db = "sales_visualization"
        return {
            "host": self.DB_HOST,
            "port": self.DB_PORT,
            "user": self.DB_USER,
            "password": self.DB_PASSWORD,
            "database": db,
            "charset": self.DB_CHARSET,
            "use_unicode": True,
            "autocommit": False,
        }

    @property
    def resolved_log_dir(self) -> Path:
        if self.LOG_DIR:
            return Path(self.LOG_DIR)
        return BASE_DIR / "logs"

    @property
    def resolved_openrouter_model(self) -> str:
        model = (self.OPENROUTER_MODEL or "openrouter/free").strip()
        if model == "openrouter/free" or model.endswith(":free"):
            return model
        return "openrouter/free"

    @property
    def resolved_assistant_provider(self) -> str:
        provider = (self.ASSISTANT_LLM_PROVIDER or "openrouter").strip().lower()
        return "local" if provider in {"local", "ollama", "lmstudio", "vllm"} else "openrouter"

    @property
    def resolved_assistant_model(self) -> str:
        return self.LOCAL_LLM_MODEL if self.resolved_assistant_provider == "local" else self.resolved_openrouter_model


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
