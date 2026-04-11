from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import app  # noqa: E402
from endpoints.v1.retail.analytics.service.shared import (  # noqa: E402
    retail_mass_from_item,
    retail_payload_mass_needs_refresh,
)
from scripts.refresh_current_snapshots import (  # noqa: E402
    _rebuild_yearly_snapshots,
    _report_snapshots_from_workbook,
    _request,
    _single_refresh_lock,
)


def _parse_month(value: str) -> tuple[int, int]:
    try:
        year_text, month_text = value.split("-", 1)
        year = int(year_text)
        month = int(month_text)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("month must use YYYY-MM") from None
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError("month must use YYYY-MM")
    return year, month


def _month_label(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def _iter_months(start: tuple[int, int], end: tuple[int, int]):
    year, month = start
    end_year, end_month = end
    while (year, month) <= (end_year, end_month):
        yield _month_label(year, month)
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1


def _default_end_month() -> str:
    completed_day = date.today().replace(day=1)
    today = date.today()
    if today.day > 1:
        return _month_label(today.year, today.month)
    previous = completed_day.toordinal() - 1
    previous_date = date.fromordinal(previous)
    return _month_label(previous_date.year, previous_date.month)


def _monthly_snapshot_path(ym: str) -> Path:
    year, month = ym.split("-", 1)
    return ROOT / "cache_snapshots" / "monthly" / year / f"monthly_{int(month):02d}.json"


def _load_snapshot(ym: str) -> dict | None:
    path = _monthly_snapshot_path(ym)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


def _items_need_mass(rows) -> bool:
    if isinstance(rows, dict):
        iterable = rows.values()
    elif isinstance(rows, list):
        iterable = rows
    else:
        return False
    for item in iterable:
        if not isinstance(item, dict):
            continue
        if float(item.get("volume") or item.get("totalLiters") or 0) <= 0:
            continue
        if retail_mass_from_item(item) is None:
            return True
    return False


def snapshot_needs_rebuild(payload: dict | None) -> bool:
    if not payload:
        return True
    summary = payload.get("summary") or {}
    has_liters = float(summary.get("totalLiters") or 0) > 0
    if has_liters and float(summary.get("totalTons") or 0) <= 0:
        return True
    if has_liters and ("inventory" not in summary or "inventoryMonth" not in summary):
        return True
    if retail_payload_mass_needs_refresh(payload):
        return True
    if _items_need_mass(payload.get("daily")):
        return True
    if _items_need_mass(payload.get("regions")):
        return True
    daily_stations = payload.get("stations")
    if _items_need_mass(daily_stations):
        return True
    return False


def backfill(start: str, end: str, force: bool = False, dry_run: bool = False) -> int:
    start_month = _parse_month(start)
    end_month = _parse_month(end)
    if start_month > end_month:
        raise ValueError("start month must not be after end month")

    client = app.test_client()
    changed_by_year: dict[int, set[int]] = {}
    failures: list[str] = []
    scanned = 0
    skipped = 0

    for ym in _iter_months(start_month, end_month):
        scanned += 1
        payload = _load_snapshot(ym)
        needs_rebuild = force or snapshot_needs_rebuild(payload)
        if not needs_rebuild:
            skipped += 1
            print(f"skip {ym}: mass snapshot already healthy")
            continue
        if dry_run:
            print(f"would rebuild {ym}")
            continue

        print(f"rebuild {ym}: generating monthly report and snapshots")
        ok = _request(client, f"/api/export/monthly/{ym}", {"refresh": "1"})
        ok = _report_snapshots_from_workbook(ym) and ok
        if ok:
            year, month = [int(part) for part in ym.split("-")]
            changed_by_year.setdefault(year, set()).add(month)
        else:
            failures.append(ym)

    if not dry_run:
        for year, months in sorted(changed_by_year.items()):
            latest_month = max(months)
            _rebuild_yearly_snapshots(year, latest_month)

    print(
        f"done retail mass snapshot backfill: scanned={scanned}, "
        f"rebuilt={sum(len(months) for months in changed_by_year.values())}, "
        f"skipped={skipped}, failed={len(failures)}"
    )
    if failures:
        print("failed months: " + ", ".join(failures))
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill retail snapshots with true mass/tons fields")
    parser.add_argument("--start", default="2024-01", help="first month, YYYY-MM")
    parser.add_argument("--end", default=_default_end_month(), help="last month, YYYY-MM")
    parser.add_argument("--force", action="store_true", help="rebuild every month in range")
    parser.add_argument("--dry-run", action="store_true", help="print affected months without writing snapshots")
    args = parser.parse_args()

    with _single_refresh_lock() as acquired:
        if not acquired:
            print("skip retail mass backfill: another snapshot refresh is already running")
            return 2
        return backfill(args.start, args.end, force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
