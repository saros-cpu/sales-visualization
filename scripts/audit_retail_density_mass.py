from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
OILSTATION_ROOT = REPO_ROOT / "OilStation"


def parse_month(value: str) -> tuple[int, int]:
    try:
        year_text, month_text = value.split("-", 1)
        year = int(year_text)
        month = int(month_text)
    except (TypeError, ValueError):
        raise argparse.ArgumentTypeError("month must use YYYY-MM") from None
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError("month must use YYYY-MM")
    return year, month


def month_label(year: int, month: int) -> str:
    return f"{year}-{month:02d}"


def iter_months(start: tuple[int, int], end: tuple[int, int]):
    year, month = start
    end_year, end_month = end
    while (year, month) <= (end_year, end_month):
        yield year, month
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1


def number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_json(path: Path) -> dict[str, Any] | list[Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None


def issue(path: Path, scope: str, label: str, reason: str, item: dict[str, Any]) -> dict[str, Any]:
    return {
        "file": str(path),
        "scope": scope,
        "label": label,
        "reason": reason,
        "volume": item.get("volume") or item.get("totalLiters") or item.get("totalVolume"),
        "mass": item.get("mass") or item.get("totalWeightKg"),
        "tons": item.get("tons") or item.get("totalTons"),
        "density": item.get("density"),
    }


def audit_metric_item(path: Path, scope: str, label: str, item: Any) -> list[dict[str, Any]]:
    if not isinstance(item, dict):
        return []
    volume = number(item.get("volume") if "volume" in item else item.get("totalLiters") if "totalLiters" in item else item.get("totalVolume"))
    if volume is None or volume <= 0:
        return []

    mass = number(item.get("mass") if "mass" in item else item.get("totalWeightKg"))
    tons = number(item.get("tons") if "tons" in item else item.get("totalTons"))
    density = number(item.get("density"))
    issues: list[dict[str, Any]] = []
    if (mass is None or mass <= 0) and (tons is None or tons <= 0):
        issues.append(issue(path, scope, label, "missing_mass_and_tons", item))
        return issues
    if mass is not None and tons is not None and abs(mass / 1000 - tons) > 0.002:
        issues.append(issue(path, scope, label, "mass_tons_mismatch", item))
    if mass is not None and density is not None and density > 0:
        calculated = mass / volume
        if abs(calculated - density) > 0.01:
            issues.append(issue(path, scope, label, "density_mass_volume_mismatch", item))
    return issues


def iter_rows(payload: dict[str, Any] | list[Any]) -> list[tuple[str, Any]]:
    rows: list[tuple[str, Any]] = []
    if isinstance(payload, list):
        rows.extend((f"root[{index}]", item) for index, item in enumerate(payload))
        return rows
    if not isinstance(payload, dict):
        return rows
    for key in ("summary",):
        if isinstance(payload.get(key), dict):
            rows.append((key, payload[key]))
    for key in ("stations", "byResource", "daily", "byStation"):
        value = payload.get(key)
        if isinstance(value, list):
            rows.extend((f"{key}[{index}]", item) for index, item in enumerate(value))
        elif isinstance(value, dict):
            for name, sub_value in value.items():
                if isinstance(sub_value, list):
                    rows.extend((f"{key}.{name}[{index}]", item) for index, item in enumerate(sub_value))
                else:
                    rows.append((f"{key}.{name}", sub_value))
    for key in ("regions", "byRegion"):
        value = payload.get(key)
        if isinstance(value, dict):
            rows.extend((f"{key}.{name}", item) for name, item in value.items())
        elif isinstance(value, list):
            rows.extend((f"{key}[{index}]", item) for index, item in enumerate(value))
    return rows


def snapshot_paths(year: int, month: int) -> list[Path]:
    ym = month_label(year, month)
    monthly_dir = OILSTATION_ROOT / "cache_snapshots" / "monthly" / str(year)
    paths = [
        monthly_dir / f"monthly_{month:02d}.json",
        monthly_dir / f"stations_{month:02d}.json",
        monthly_dir / f"regions_{month:02d}.json",
        monthly_dir / f"daily_{month:02d}.json",
        OILSTATION_ROOT / "cache_snapshots" / "monthly" / f"self_use_{ym}.json",
        OILSTATION_ROOT / "cache_snapshots" / "yearly" / f"dashboard_yearly_{year}.json",
        OILSTATION_ROOT / "cache_snapshots" / "yearly" / f"resources_yearly_{year}_{month}.json",
        OILSTATION_ROOT / "cache_snapshots" / "yearly" / f"kpi_yearly_{year}_summary.json",
    ]
    daily_dir = OILSTATION_ROOT / "cache_snapshots" / "daily" / str(year) / f"{month:02d}"
    if daily_dir.exists():
        paths.extend(sorted(daily_dir.glob("day_*.json")))
    return paths


def audit_month(year: int, month: int) -> dict[str, Any]:
    files = []
    issues: list[dict[str, Any]] = []
    for path in snapshot_paths(year, month):
        payload = load_json(path)
        file_item = {"path": str(path), "exists": path.exists(), "validJson": payload is not None, "issueCount": 0}
        if payload is None:
            if path.exists():
                issues.append({"file": str(path), "scope": month_label(year, month), "label": "file", "reason": "invalid_json"})
                file_item["issueCount"] = 1
            files.append(file_item)
            continue
        for label, item in iter_rows(payload):
            issues.extend(audit_metric_item(path, month_label(year, month), label, item))
        file_item["issueCount"] = sum(1 for item in issues if item.get("file") == str(path))
        files.append(file_item)
    return {
        "month": month_label(year, month),
        "fileCount": len(files),
        "issueCount": len(issues),
        "files": files,
        "issues": issues,
    }


def main() -> int:
    today = date.today()
    default_month = (today.year, today.month)
    parser = argparse.ArgumentParser(description="Audit retail snapshot density/mass/tons consistency.")
    parser.add_argument("--start", type=parse_month, default=default_month, help="first month, YYYY-MM")
    parser.add_argument("--end", type=parse_month, default=None, help="last month, YYYY-MM")
    parser.add_argument("--fail-on-issue", action="store_true", help="return non-zero when issues are found")
    args = parser.parse_args()
    end = args.end or args.start

    months = [audit_month(year, month) for year, month in iter_months(args.start, end)]
    total_issues = sum(item["issueCount"] for item in months)
    payload = {
        "status": "ok" if total_issues == 0 else "warning",
        "checkedAt": date.today().isoformat(),
        "totalIssues": total_issues,
        "months": months,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 1 if args.fail_on_issue and total_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
