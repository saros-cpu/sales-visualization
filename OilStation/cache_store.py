import json
import time
from datetime import date
from pathlib import Path


CACHE_TTL = {
    "monthly": 3600,
    "station": 1800,
    "kpi": 300,
    "kpi_yearly": 3600,
    "inventory": 600,
    "years": 3600,
    "months": 3600,
    "stations": 1800,
    "regions": 1800,
    "daily": 1800,
    "dashboard": 3600,
    "dashboard_yearly": 3600,
    "resources_yearly": 3600,
    "self_use": 1800,
}
CURRENT_MONTH_MAX_TTL = 108000

_cache = {}
ROOT = Path(__file__).resolve().parent
SNAPSHOT_DIR = ROOT / "cache_snapshots" / "monthly"
YEARLY_DIR = ROOT / "cache_snapshots" / "yearly"
SNAPSHOT_PREFIXES = {
    "monthly",
    "stations",
    "regions",
    "daily",
    "dashboard_yearly",
    "resources_yearly",
    "kpi_yearly",
    "self_use",
}
YEARLY_SNAPSHOT_PREFIXES = {"dashboard_yearly", "resources_yearly", "kpi_yearly"}


def _month_from_key(key):
    parts = key.split(":", 1)
    if len(parts) != 2 or parts[0] not in SNAPSHOT_PREFIXES or parts[0] in YEARLY_SNAPSHOT_PREFIXES:
        return None
    ym = parts[1].split(":", 1)[0]
    try:
        year, month = [int(part) for part in ym.split("-")]
    except (TypeError, ValueError):
        return None
    return year, month


def _year_from_key(key):
    parts = key.split(":", 1)
    if len(parts) != 2 or parts[0] not in YEARLY_SNAPSHOT_PREFIXES:
        return None
    try:
        return int(parts[1].split(":", 1)[0])
    except (TypeError, ValueError):
        return None


def _is_completed_month(key):
    ym = _month_from_key(key)
    if ym is None:
        return False
    year, month = ym
    today = date.today()
    return (year, month) < (today.year, today.month)


def _is_completed_year(key):
    year = _year_from_key(key)
    if year is None:
        return False
    return year < date.today().year


def _is_current_month_key(key):
    parts = key.split(":")
    if len(parts) < 2:
        return False
    today = date.today()
    prefix = parts[0]
    if prefix in {"monthly", "stations", "regions", "daily", "station", "self_use"}:
        ym = parts[1]
    elif prefix == "resources" and len(parts) >= 4:
        ym = f"{parts[2]}-{int(parts[3]):02d}" if parts[3].isdigit() else ""
    else:
        return False
    try:
        year, month = [int(part) for part in ym.split("-")]
    except (TypeError, ValueError):
        return False
    return (year, month) == (today.year, today.month)


def _is_current_year_key(key):
    year = _year_from_key(key)
    return year == date.today().year if year is not None else False


def _snapshot_path(key):
    prefix, value = key.split(":", 1)
    if prefix in {"monthly", "stations", "regions", "daily"}:
        year, month = value.split("-")[:2]
        return SNAPSHOT_DIR / str(year) / f"{prefix}_{int(month):02d}.json"
    if prefix in YEARLY_SNAPSHOT_PREFIXES:
        value = value.replace(":", "_")
        return YEARLY_DIR / f"{prefix}_{value}.json"
    return SNAPSHOT_DIR / f"{prefix}_{value}.json"


def _snapshot_mtime(key):
    try:
        path = _snapshot_path(key)
    except ValueError:
        return None
    if not path.exists():
        return None
    return path.stat().st_mtime


def _is_fresh_current_snapshot(key, path):
    is_current = _is_current_year_key(key) if key.split(":", 1)[0] in YEARLY_SNAPSHOT_PREFIXES else _is_current_month_key(key)
    if not is_current or not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age <= CURRENT_MONTH_MAX_TTL


def _read_snapshot(key):
    path = _snapshot_path(key)
    prefix = key.split(":", 1)[0]

    if prefix in YEARLY_SNAPSHOT_PREFIXES:
        if not _is_completed_year(key) and not _is_fresh_current_snapshot(key, path):
            return None
    elif prefix == "self_use":
        pass
    elif not _is_completed_month(key) and not _is_fresh_current_snapshot(key, path):
        return None
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None
    if not _snapshot_shape_is_valid(key, data):
        return None
    return data


def _snapshot_shape_is_valid(key, data):
    if not isinstance(data, dict):
        return False
    prefix = key.split(":", 1)[0]
    required = {
        "monthly": {"summary", "stations", "regions", "byResource", "daily"},
        "stations": {"stations"},
        "regions": {"regions"},
        "daily": {"daily"},
        "dashboard_yearly": {"stations", "regions", "byResource"},
        "resources_yearly": {"resources", "summary"},
        "kpi_yearly": {"summary"},
        "self_use": {"records", "summary", "comparison", "byStation", "byResource", "byRegion", "daily"},
    }.get(prefix)
    if not required:
        return True
    return required.issubset(data.keys())


def _write_snapshot(key, data):
    if _month_from_key(key) is None and _year_from_key(key) is None:
        return
    if key.split(":", 1)[0] in YEARLY_SNAPSHOT_PREFIXES:
        if not _is_completed_year(key) and not _is_current_year_key(key):
            return
    elif not _is_completed_month(key) and not _is_current_month_key(key) and not key.startswith("self_use:"):
        return
    try:
        path = _snapshot_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        content = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        for attempt in range(5):
            try:
                temp_path.write_text(content, encoding="utf-8")
                temp_path.replace(path)
                break
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.1 * (attempt + 1))
    except (OSError, TypeError):
        pass


def get_cached(key):
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        snapshot_mtime = _snapshot_mtime(key)
        cached_mtime = entry.get("snapshot_mtime")
        if snapshot_mtime is not None and (
            cached_mtime is None or snapshot_mtime > cached_mtime + 0.001
        ):
            snapshot = _read_snapshot(key)
            if snapshot is not None:
                set_cached(key, snapshot)
                return snapshot
        return entry["data"]
    snapshot = _read_snapshot(key)
    if snapshot is not None:
        set_cached(key, snapshot)
        return snapshot
    return None


def set_cached(key, data, ttl=None):
    if ttl is None:
        ttl = CACHE_TTL.get(key.split(":")[0], 300)
    if _is_current_month_key(key):
        ttl = min(ttl, CURRENT_MONTH_MAX_TTL)
    _write_snapshot(key, data)
    _cache[key] = {
        "data": data,
        "expires": time.time() + ttl,
        "snapshot_mtime": _snapshot_mtime(key),
    }


def invalidate_cache(prefix=None):
    if prefix:
        keys_to_del = [k for k in _cache if k.startswith(prefix)]
        for key in keys_to_del:
            del _cache[key]
    else:
        _cache.clear()
