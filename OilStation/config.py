import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


def _load_env_file(path=BASE_DIR / ".env"):
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _get_int(name, default):
    value = os.getenv(name)
    if value in (None, ""):
        return default
    return int(value)


_load_env_file()


DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": _get_int("DB_PORT", 3306),
    "user": os.getenv("DB_USER", "reader"),
    "password": os.getenv("DB_PASSWORD", ""),
    "database": os.getenv("DB_NAME", "ocw"),
    "charset": os.getenv("DB_CHARSET", "utf8mb4"),
    "use_unicode": True,
}

SERVER_HOST = os.getenv("APP_HOST", "0.0.0.0")
SERVER_PORT = _get_int("APP_PORT", 8900)
