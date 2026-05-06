import importlib.util
from datetime import date, datetime
from pathlib import Path
import tempfile
import unittest
import os
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "late_retail_data_maintenance.py"


spec = importlib.util.spec_from_file_location("late_retail_data_maintenance", SCRIPT_PATH)
late_data = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = late_data
spec.loader.exec_module(late_data)


class LateRetailDataMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.original_oilstation_root = late_data.OILSTATION_ROOT

    def tearDown(self):
        late_data.OILSTATION_ROOT = self.original_oilstation_root

    def touch(self, path: Path, updated_at: datetime):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
        timestamp = updated_at.timestamp()
        os.utime(path, (timestamp, timestamp))

    def test_plan_marks_stale_artifacts_and_dedupes_snapshot_months(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            late_data.OILSTATION_ROOT = root / "OilStation"
            report_root = root / "reports"
            uploaded_at = datetime(2026, 7, 28, 8, 30)

            self.touch(
                late_data.OILSTATION_ROOT / "cache_snapshots" / "daily" / "2026" / "07" / "day_24.json",
                datetime(2026, 7, 28, 8, 0),
            )
            self.touch(
                late_data.OILSTATION_ROOT / "cache_snapshots" / "daily" / "2026" / "07" / "day_27.json",
                datetime(2026, 7, 28, 8, 45),
            )
            self.touch(
                late_data.OILSTATION_ROOT / "cache_snapshots" / "monthly" / "2026" / "monthly_07.json",
                datetime(2026, 7, 28, 8, 45),
            )

            plan = late_data.build_late_data_plan(
                [date(2026, 7, 24), date(2026, 7, 27)],
                uploaded_at,
                report_root=report_root,
            )

        self.assertEqual(plan["months"], ["2026-07"])
        self.assertEqual(len(plan["commands"]["snapshots"]), 1)
        self.assertEqual(len(plan["commands"]["accountingReports"]), 2)
        stale_keys = {item["key"] for item in plan["staleArtifacts"]}
        self.assertIn("retail_day", stale_keys)
        self.assertIn("accounting_report_folder", stale_keys)
        self.assertIn("self_use_monthly", stale_keys)
        fresh_monthly = [
            item for item in plan["artifacts"]
            if item["key"] == "retail_monthly" and item["scope"] == "2026-07"
        ][0]
        self.assertFalse(fresh_monthly["stale"])


if __name__ == "__main__":
    unittest.main()
