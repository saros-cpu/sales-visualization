import os
import secrets
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def _load_env_file(path):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _get_int(name, default):
    value = os.getenv(name)
    if value in (None, ""):
        return default
    return int(value)


# Prefer Sales/.env. Fall back to OilStation/.env so both projects can use the
# same MySQL account while keeping different default databases.
_load_env_file(BASE_DIR / ".env")
_load_env_file(ROOT_DIR / "OilStation" / ".env")


DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": _get_int("DB_PORT", 3306),
    "user": os.getenv("DB_USER", "reader"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("SALES_DB_NAME", os.getenv("DB_NAME", "sales_visualization")),
    "charset": os.getenv("DB_CHARSET", "utf8mb4"),
    "use_unicode": True,
    "autocommit": False,
}

if DB_CONFIG["database"] == "ocw":
    DB_CONFIG["database"] = "sales_visualization"

OILSTATION_BASE_URL = os.getenv("OILSTATION_BASE_URL", "http://127.0.0.1:8900").rstrip("/")
NBKR_DAILY_XML_URL = os.getenv("NBKR_DAILY_XML_URL", "https://www.nbkr.kg/XML/daily.xml")
NBKR_RATES_PAGE_URL = os.getenv("NBKR_RATES_PAGE_URL", "https://www.nbkr.kg/index1.jsp")
LOGIN_REMEMBER_DAYS = _get_int("SALES_LOGIN_REMEMBER_DAYS", 14)


def _get_secret_key():
    configured = os.getenv("SALES_SECRET_KEY")
    if configured:
        return configured

    secret_path = BASE_DIR / ".runtime" / "secret_key.txt"
    try:
        if secret_path.exists():
            value = secret_path.read_text(encoding="utf-8").strip()
            if len(value) >= 32:
                return value
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        value = secrets.token_urlsafe(64)
        secret_path.write_text(value, encoding="utf-8")
        return value
    except OSError:
        return secrets.token_urlsafe(64)


SECRET_KEY = _get_secret_key()
