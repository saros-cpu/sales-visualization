from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime
import json
from pathlib import Path
import subprocess
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
OILSTATION_ROOT = REPO_ROOT / "OilStation"
DEFAULT_REPORT_ROOT = Path(r"D:\每日销量日报")


@dataclass(frozen=True)
class ArtifactSpec:
    key: str
    label: str
    path: Path
    scope: str
    expected: bool = True


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("date must use YYYY-MM-DD") from None


def parse_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.now()
    normalized = str(value).strip().replace("T", " ")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        raise argparse.ArgumentTypeError("uploaded-at must use YYYY-MM-DD HH:MM:SS") from None


def month_label(day: date) -> str:
    return f"{day.year}-{day.month:02d}"


def day_folder(day: date) -> str:
    return day.strftime("%Y%m%d")


def artifact_updated_at(path: Path) -> datetime | None:
    if not path.exists():
        return None
    if path.is_dir():
        timestamps = [item.stat().st_mtime for item in path.glob("*.xlsx") if item.is_file()]
        timestamps.append(path.stat().st_mtime)
        return datetime.fromtimestamp(max(timestamps))
    return datetime.fromtimestamp(path.stat().st_mtime)


def artifact_file_count(path: Path) -> int | None:
    if not path.exists() or not path.is_dir():
        return None
    return sum(1 for item in path.glob("*.xlsx") if item.is_file())


def artifact_status(spec: ArtifactSpec, uploaded_at: datetime) -> dict[str, Any]:
    updated_at = artifact_updated_at(spec.path)
    exists = spec.path.exists()
    stale = spec.expected and (not exists or updated_at is None or updated_at < uploaded_at)
    payload: dict[str, Any] = {
        "key": spec.key,
        "label": spec.label,
        "scope": spec.scope,
        "path": str(spec.path),
        "exists": exists,
        "expected": spec.expected,
        "updatedAt": updated_at.isoformat(sep=" ", timespec="seconds") if updated_at else None,
        "stale": stale,
    }
    file_count = artifact_file_count(spec.path)
    if file_count is not None:
        payload["fileCount"] = file_count
    if stale:
        payload["reason"] = "missing" if not exists else "older_than_upload"
    return payload


def date_artifacts(day: date, report_root: Path) -> list[ArtifactSpec]:
    year = f"{day.year}"
    month = f"{day.month:02d}"
    day_num = f"{day.day:02d}"
    report_name = day_folder(day)
    return [
        ArtifactSpec(
            "retail_day",
            "零售每日快照",
            OILSTATION_ROOT / "cache_snapshots" / "daily" / year / month / f"day_{day_num}.json",
            day.isoformat(),
        ),
        ArtifactSpec(
            "accounting_report_folder",
            "吉方财务交接报表文件夹",
            report_root / report_name,
            day.isoformat(),
        ),
        ArtifactSpec(
            "accounting_report_archive",
            "吉方财务交接报表归档",
            report_root / f"{report_name}.rar",
            day.isoformat(),
        ),
    ]


def month_artifacts(year: int, month: int) -> list[ArtifactSpec]:
    ym = f"{year}-{month:02d}"
    year_text = str(year)
    monthly_root = OILSTATION_ROOT / "cache_snapshots" / "monthly"
    year_root = monthly_root / year_text
    yearly_root = OILSTATION_ROOT / "cache_snapshots" / "yearly"
    extras_root = OILSTATION_ROOT / "cache_snapshots" / "report_extras" / year_text
    return [
        ArtifactSpec("retail_monthly", "零售月度快照", year_root / f"monthly_{month:02d}.json", ym),
        ArtifactSpec("retail_stations", "零售站点快照", year_root / f"stations_{month:02d}.json", ym),
        ArtifactSpec("retail_regions", "零售区域快照", year_root / f"regions_{month:02d}.json", ym),
        ArtifactSpec("retail_daily_trend", "零售日趋势快照", year_root / f"daily_{month:02d}.json", ym),
        ArtifactSpec("self_use_monthly", "自用油月度快照", monthly_root / f"self_use_{ym}.json", ym),
        ArtifactSpec("report_extras", "报表附加快照", extras_root / f"report_extras_{month:02d}.json", ym),
        ArtifactSpec("dashboard_yearly", "年度看板快照", yearly_root / f"dashboard_yearly_{year}.json", str(year)),
        ArtifactSpec("resources_yearly", "年度油品快照", yearly_root / f"resources_yearly_{year}_year.json", str(year)),
        ArtifactSpec("resources_monthly_yearly", "年度油品月度快照", yearly_root / f"resources_yearly_{year}_{month}.json", ym),
        ArtifactSpec("kpi_yearly_summary", "年度 KPI 快照", yearly_root / f"kpi_yearly_{year}_summary.json", str(year)),
        ArtifactSpec("kpi_yearly_inventory", "年度 KPI 库存快照", yearly_root / f"kpi_yearly_{year}_with_inventory.json", str(year)),
    ]


def build_late_data_plan(
    dates: list[date],
    uploaded_at: datetime,
    report_root: Path = DEFAULT_REPORT_ROOT,
) -> dict[str, Any]:
    unique_dates = sorted(set(dates))
    months = sorted({(item.year, item.month) for item in unique_dates})
    artifacts: list[dict[str, Any]] = []
    for item in unique_dates:
        artifacts.extend(artifact_status(spec, uploaded_at) for spec in date_artifacts(item, report_root))
    for year, month in months:
        artifacts.extend(artifact_status(spec, uploaded_at) for spec in month_artifacts(year, month))

    stale = [item for item in artifacts if item.get("stale")]
    snapshot_months = [f"{year}-{month:02d}" for year, month in months]
    accounting_dates = [item.isoformat() for item in unique_dates]
    return {
        "status": "needs_rerun" if stale else "ok",
        "checkedAt": datetime.now().isoformat(sep=" ", timespec="seconds"),
        "uploadedAt": uploaded_at.isoformat(sep=" ", timespec="seconds"),
        "dates": accounting_dates,
        "months": snapshot_months,
        "summary": {
            "artifactCount": len(artifacts),
            "staleCount": len(stale),
            "missingCount": sum(1 for item in stale if item.get("reason") == "missing"),
        },
        "staleArtifacts": stale,
        "artifacts": artifacts,
        "commands": {
            "snapshots": [
                [sys.executable, str(OILSTATION_ROOT / "scripts" / "refresh_current_snapshots.py"), "--month", ym]
                for ym in snapshot_months
            ],
            "accountingReports": [
                [
                    sys.executable,
                    str(OILSTATION_ROOT / "scripts" / "generate_accounting_handover_reports.py"),
                    "--date",
                    item,
                    "--archive",
                    "--force",
                ]
                for item in accounting_dates
            ],
        },
    }


def run_command(command: list[str], cwd: Path) -> dict[str, Any]:
    started = datetime.now()
    completed = subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
    )
    output = ((completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else "")).strip()
    return {
        "command": command,
        "cwd": str(cwd),
        "returnCode": completed.returncode,
        "startedAt": started.isoformat(sep=" ", timespec="seconds"),
        "finishedAt": datetime.now().isoformat(sep=" ", timespec="seconds"),
        "outputTail": output[-2000:],
        "ok": completed.returncode == 0,
    }


def execute_plan(plan: dict[str, Any], run_snapshots: bool, run_accounting: bool) -> dict[str, Any]:
    runs: dict[str, list[dict[str, Any]]] = {"snapshots": [], "accountingReports": []}
    if run_snapshots:
        for command in plan["commands"]["snapshots"]:
            runs["snapshots"].append(run_command(command, OILSTATION_ROOT))
    if run_accounting:
        for command in plan["commands"]["accountingReports"]:
            runs["accountingReports"].append(run_command(command, OILSTATION_ROOT))
    failed = [item for group in runs.values() for item in group if not item.get("ok")]
    return {
        "requested": {"snapshots": run_snapshots, "accountingReports": run_accounting},
        "runs": runs,
        "failedCount": len(failed),
        "status": "failed" if failed else "ok",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit and rerun artifacts affected by late retail data uploads.")
    parser.add_argument("--date", action="append", type=parse_day, required=True, help="affected business date, YYYY-MM-DD; can be repeated")
    parser.add_argument("--uploaded-at", type=parse_datetime, default=parse_datetime(None), help="late upload timestamp, YYYY-MM-DD HH:MM:SS; default now")
    parser.add_argument("--report-root", default=str(DEFAULT_REPORT_ROOT), help="accounting handover report root")
    parser.add_argument("--run-snapshots", action="store_true", help="rerun affected retail snapshot months")
    parser.add_argument("--run-accounting", action="store_true", help="rerun affected accounting handover reports")
    args = parser.parse_args()

    plan = build_late_data_plan(args.date, args.uploaded_at, Path(args.report_root))
    if args.run_snapshots or args.run_accounting:
        plan["execution"] = execute_plan(plan, args.run_snapshots, args.run_accounting)
        if plan["execution"]["status"] == "failed":
            plan["status"] = "failed"
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 1 if plan.get("status") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
