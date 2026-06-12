from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from shared_utils import OILSTATION_ROOT


DEFAULT_LOOKBACK_DAYS = 30
DEFAULT_THRESHOLD_DAYS = 3
DEFAULT_MIN_SAMPLE_DAYS = 3
DEFAULT_WARNING_PERCENT = 50.0
DEFAULT_CRITICAL_PERCENT = 30.0


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, "").strip())
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _parse_day(value: Any) -> date | None:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _as_day(value: date | str | None) -> date:
    if isinstance(value, date):
        return value
    parsed = _parse_day(value)
    if parsed:
        return parsed
    return date.today() - timedelta(days=1)


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _month_keys(start: date, end: date) -> list[tuple[int, int]]:
    cursor = date(start.year, start.month, 1)
    result: list[tuple[int, int]] = []
    while cursor <= end:
        result.append((cursor.year, cursor.month))
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return result


def _monthly_daily_path(year: int, month: int) -> Path:
    return OILSTATION_ROOT / "cache_snapshots" / "monthly" / str(year) / f"daily_{month:02d}.json"


def _daily_snapshot_path(day: date) -> Path:
    return OILSTATION_ROOT / "cache_snapshots" / "daily" / f"{day.year:04d}" / f"{day.month:02d}" / f"day_{day.day:02d}.json"


def _add_station_volume(
    target: dict[int, dict[date, float]],
    shop_key: Any,
    day_value: Any,
    volume: Any,
    start: date,
    end: date,
) -> None:
    key = _int(shop_key)
    day = _parse_day(day_value)
    if key is None or day is None or day < start or day > end:
        return
    target.setdefault(key, {})[day] = _num(volume)


def _load_daily_sales_by_station(start: date, end: date) -> dict[int, dict[date, float]]:
    result: dict[int, dict[date, float]] = {}

    for year, month in _month_keys(start, end):
        payload = _read_json(_monthly_daily_path(year, month)) or {}
        stations = payload.get("stations") or {}
        if isinstance(stations, dict):
            for shop_key, rows in stations.items():
                for row in rows or []:
                    if isinstance(row, dict):
                        _add_station_volume(result, shop_key, row.get("date"), row.get("volume"), start, end)

    cursor = start
    while cursor <= end:
        payload = _read_json(_daily_snapshot_path(cursor)) or {}
        stations = payload.get("stations") or {}
        if isinstance(stations, dict):
            for shop_key, rows in stations.items():
                for row in rows or []:
                    if isinstance(row, dict):
                        _add_station_volume(result, shop_key, row.get("date") or cursor, row.get("volume"), start, end)
        elif isinstance(stations, list):
            for row in stations:
                if isinstance(row, dict):
                    _add_station_volume(
                        result,
                        row.get("shopKey") or row.get("shop_key"),
                        row.get("date") or cursor,
                        row.get("volume") or row.get("totalLiters"),
                        start,
                        end,
                    )
        cursor += timedelta(days=1)

    return result


def _station_eligible(station: dict[str, Any]) -> bool:
    status = str(station.get("status") or "normal").lower()
    if bool(station.get("suppressAlerts")):
        return False
    if status == "closed" and not bool(station.get("affectsInventory")):
        return False
    return True


def build_low_inventory_alerts(
    stations: list[dict[str, Any]],
    *,
    as_of: date | str | None = None,
    lookback_days: int | None = None,
    threshold_days: int | None = None,
    min_sample_days: int | None = None,
) -> dict[str, Any]:
    """Build low-inventory alerts from current station inventory.

    Capacity percentage is authoritative when the station detail payload carries
    tank capacity. Sales-day coverage is kept as a fallback for legacy payloads.
    """
    effective_as_of = _as_day(as_of)
    effective_lookback = lookback_days or _env_int(
        "SALES_LOW_INVENTORY_LOOKBACK_DAYS",
        DEFAULT_LOOKBACK_DAYS,
        minimum=7,
        maximum=90,
    )
    effective_threshold = threshold_days or _env_int(
        "SALES_LOW_INVENTORY_DAYS",
        DEFAULT_THRESHOLD_DAYS,
        minimum=1,
        maximum=30,
    )
    effective_min_sample = min_sample_days or _env_int(
        "SALES_LOW_INVENTORY_MIN_SAMPLE_DAYS",
        DEFAULT_MIN_SAMPLE_DAYS,
        minimum=1,
        maximum=30,
    )
    warning_percent = _env_int(
        "SALES_LOW_INVENTORY_WARNING_PERCENT",
        int(DEFAULT_WARNING_PERCENT),
        minimum=1,
        maximum=100,
    )
    critical_percent = _env_int(
        "SALES_LOW_INVENTORY_CRITICAL_PERCENT",
        int(DEFAULT_CRITICAL_PERCENT),
        minimum=1,
        maximum=100,
    )
    if critical_percent > warning_percent:
        critical_percent = warning_percent
    start = effective_as_of - timedelta(days=effective_lookback - 1)
    sales_by_station: dict[int, dict[date, float]] | None = None

    items: list[dict[str, Any]] = []
    for station in stations:
        shop_key = _int(station.get("shopKey"))
        if shop_key is None or "inventory" not in station or not _station_eligible(station):
            continue
        resource_rows = [
            row for row in (station.get("inventoryByResource") or [])
            if isinstance(row, dict) and _num(row.get("capacity")) > 0
        ]
        if resource_rows:
            for row in resource_rows:
                inventory = _num(row.get("inventory"))
                capacity = _num(row.get("capacity"))
                fill_percent = row.get("fillPercent")
                percent = _num(fill_percent) if fill_percent is not None else (inventory / capacity * 100)
                if percent >= warning_percent:
                    continue
                severity = "critical" if percent < critical_percent else "warning"
                items.append({
                    "shopKey": shop_key,
                    "name": station.get("name") or "",
                    "short": station.get("short") or "",
                    "region": station.get("region") or "",
                    "resourceKey": _int(row.get("resourceKey")),
                    "resourceName": row.get("name") or row.get("resourceName") or "",
                    "severity": severity,
                    "inventory": round(inventory, 2),
                    "capacity": round(capacity, 2),
                    "fillPercent": round(percent, 1),
                    "warningPercent": warning_percent,
                    "criticalPercent": critical_percent,
                    "asOf": effective_as_of.isoformat(),
                    "inventoryAsOf": station.get("inventoryAsOf") or station.get("snapshotGeneratedAt") or "",
                })
            continue

        fill_percent = station.get("inventoryFillPercent")
        if fill_percent is not None:
            percent = _num(fill_percent)
            if percent >= warning_percent:
                continue
            inventory = _num(station.get("inventory"))
            total_capacity = _num(station.get("inventoryCapacity"))
            if not total_capacity:
                total_capacity = inventory / (percent / 100) if percent > 0 else 0
            severity = "critical" if percent < critical_percent else "warning"
            items.append({
                "shopKey": shop_key,
                "name": station.get("name") or "",
                "short": station.get("short") or "",
                "region": station.get("region") or "",
                "severity": severity,
                "inventory": round(inventory, 2),
                "capacity": round(total_capacity, 2),
                "fillPercent": round(percent, 1),
                "warningPercent": warning_percent,
                "criticalPercent": critical_percent,
                "asOf": effective_as_of.isoformat(),
                "inventoryAsOf": station.get("inventoryAsOf") or station.get("snapshotGeneratedAt") or "",
            })
            continue

        if sales_by_station is None:
            sales_by_station = _load_daily_sales_by_station(start, effective_as_of)
        rows = sales_by_station.get(shop_key) or {}
        volumes = [volume for _, volume in sorted(rows.items()) if volume > 0]
        if len(volumes) < effective_min_sample:
            continue
        avg_daily = sum(volumes) / len(volumes)
        if avg_daily <= 0:
            continue
        inventory = _num(station.get("inventory"))
        required = avg_daily * effective_threshold
        if inventory >= required:
            continue
        days_remaining = inventory / avg_daily if avg_daily > 0 else 0.0
        severity = "critical" if days_remaining < 1 else "warning"
        items.append({
            "shopKey": shop_key,
            "name": station.get("name") or "",
            "short": station.get("short") or "",
            "region": station.get("region") or "",
            "severity": severity,
            "inventory": round(inventory, 2),
            "avgDailySales": round(avg_daily, 2),
            "requiredInventory": round(required, 2),
            "daysRemaining": round(days_remaining, 2),
            "thresholdDays": effective_threshold,
            "lookbackDays": effective_lookback,
            "sampleDays": len(volumes),
            "asOf": effective_as_of.isoformat(),
            "inventoryAsOf": station.get("inventoryAsOf") or station.get("snapshotGeneratedAt") or "",
        })

    items.sort(key=lambda item: (
        item.get("fillPercent", item.get("daysRemaining", 999999)),
        item["inventory"],
        item["shopKey"],
    ))
    critical_count = sum(1 for item in items if item["severity"] == "critical")
    return {
        "items": items,
        "summary": {
            "alertCount": len(items),
            "criticalCount": critical_count,
            "warningCount": len(items) - critical_count,
            "thresholdDays": effective_threshold,
            "lookbackDays": effective_lookback,
            "minSampleDays": effective_min_sample,
            "warningPercent": warning_percent,
            "criticalPercent": critical_percent,
            "asOf": effective_as_of.isoformat(),
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
        },
    }
