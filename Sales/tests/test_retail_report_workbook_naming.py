import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OILSTATION_ROOT = PROJECT_ROOT / "OilStation"
if str(OILSTATION_ROOT) not in sys.path:
    sys.path.insert(0, str(OILSTATION_ROOT))

from endpoints.v1.retail.export.service import generator
from endpoints.v1.retail.export.service import workbook


class RetailReportWorkbookNamingTests(unittest.TestCase):
    def test_monthly_report_filename_omits_year(self):
        self.assertEqual(
            generator.monthly_report_filename(2026, 8, datetime(2026, 8, 10)),
            "加油站八月份日销表10.08.xlsx",
        )

    def test_single_day_report_filename_includes_report_day(self):
        self.assertEqual(
            generator.single_day_report_filename(2026, 8, 12),
            "加油站八月份零售日报08.12.xlsx",
        )

    def test_current_month_completed_days_stop_at_yesterday(self):
        days = generator._completed_report_days(2026, 8, today=date(2026, 8, 13))

        self.assertEqual([day.day for day in days], list(range(1, 13)))

    def test_exclusive_month_end_date_uses_calendar_month_length(self):
        self.assertEqual(generator._exclusive_month_end_date(2026, 8), "2026-09-01")
        self.assertEqual(generator._exclusive_month_end_date(2024, 2), "2024-03-01")

    def test_single_day_report_keeps_only_target_daily_sheet(self):
        original_export_dir = generator.EXPORT_DIR
        try:
            with tempfile.TemporaryDirectory() as tmp:
                export_dir = Path(tmp)
                generator.EXPORT_DIR = str(export_dir)
                source_path = export_dir / "monthly" / "2026" / "加油站八月份日销表12.08.xlsx"
                source_path.parent.mkdir(parents=True)

                wb = generator.openpyxl.Workbook()
                wb.active.title = "总表"
                wb.active["A1"] = "summary"
                ws = wb.create_sheet("12日")
                ws["A1"] = "daily"
                wb.create_sheet("13日")
                wb.save(source_path)
                wb.close()

                result = generator._save_single_day_report_from_monthly(source_path, 2026, 8, 12)

                self.assertEqual(result["singleDayFile"], "加油站八月份零售日报08.12.xlsx")
                output_path = Path(result["singleDayPath"])
                self.assertTrue(output_path.exists())
                output_wb = generator.openpyxl.load_workbook(output_path, read_only=True)
                try:
                    self.assertEqual(output_wb.sheetnames, ["12日"])
                    self.assertEqual(output_wb["12日"]["A1"].value, "daily")
                finally:
                    output_wb.close()
        finally:
            generator.EXPORT_DIR = original_export_dir

    def test_monthly_report_index_supports_relative_storage_path(self):
        original_export_dir = workbook.EXPORT_DIR
        original_index_path = workbook.REPORT_INDEX_PATH
        try:
            with tempfile.TemporaryDirectory() as tmp:
                export_dir = Path(tmp)
                workbook.EXPORT_DIR = str(export_dir)
                workbook.REPORT_INDEX_PATH = export_dir / ".monthly_report_index.json"

                report_path = export_dir / "monthly" / "2026" / "加油站八月份日销表10.08.xlsx"
                report_path.parent.mkdir(parents=True)
                report_path.write_text("placeholder", encoding="utf-8")

                workbook._record_report_workbook("2026-08", report_path, last_nonempty_day=9)
                index = json.loads(workbook.REPORT_INDEX_PATH.read_text(encoding="utf-8"))

                self.assertEqual(index["2026-08"]["file"], "加油站八月份日销表10.08.xlsx")
                self.assertEqual(index["2026-08"]["path"], "monthly/2026/加油站八月份日销表10.08.xlsx")
                self.assertEqual(workbook._indexed_report_workbook("2026-08"), report_path)
        finally:
            workbook.EXPORT_DIR = original_export_dir
            workbook.REPORT_INDEX_PATH = original_index_path


if __name__ == "__main__":
    unittest.main()
