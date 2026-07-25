import unittest
import inspect
import sys
from pathlib import Path
from datetime import date, datetime
import os
import tempfile

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))
import daily_maintenance
import routes_data
from api_v2 import system
from api_v2.system import (
    _action_center,
    _accounting_failed_items_from_summary,
    _accounting_report_status,
    _accounting_station_statuses_for_day,
    _normalize_accounting_text,
    _previous_completed_month,
    _run_retail_accounting_reports_task,
    _run_retail_254_monthly_archive_task,
)


def action_codes(automation):
    result = _action_center(
        cache_items=[],
        api_summary={"failed24h": 0},
        automation=automation,
        ai={"failed7d": 0},
        knowledge={"failedCount": 0, "missingFileCount": 0, "pendingCount": 0},
        updater={"warnings": []},
        accounting={"missingCount": 0},
        retail_alerts={"anomalyCount": 0, "warnings": []},
        report_audit={"found": False, "monthVs254": 0},
    )
    return [item["code"] for item in result["items"]]


def action_codes_with_assistant_coverage(assistant_coverage):
    result = _action_center(
        cache_items=[],
        api_summary={"failed24h": 0},
        automation=[],
        ai={"failed7d": 0},
        knowledge={"failedCount": 0, "missingFileCount": 0, "pendingCount": 0},
        updater={"warnings": []},
        accounting={"missingCount": 0},
        retail_alerts={"anomalyCount": 0, "warnings": []},
        report_audit={"found": False, "monthVs254": 0},
        assistant_coverage=assistant_coverage,
    )
    return [item["code"] for item in result["items"]]


class SystemHealthActionCenterTests(unittest.TestCase):
    def test_legacy_automation_all_does_not_trigger_current_failure(self):
        codes = action_codes([
            {"task_name": "automation_all", "status": "failed", "error": "old import error"},
        ])
        self.assertNotIn("automation_failed", codes)

    def test_current_automation_failure_triggers_action(self):
        codes = action_codes([
            {"task_name": "exchange_rates", "status": "failed", "error": "network"},
        ])
        self.assertIn("automation_failed", codes)

    def test_assistant_project_coverage_failure_triggers_action(self):
        codes = action_codes_with_assistant_coverage({
            "failed": 1,
            "failedItems": [{"module": "地图", "id": "map"}],
            "missingToolRoutes": ["map_location"],
        })

        self.assertIn("assistant_project_coverage", codes)

    def test_api_summary_excludes_auth_denials_from_health_failures(self):
        class FakeCursor:
            def __init__(self):
                self.queries = []

            def execute(self, sql):
                self.queries.append(sql)

            def fetchone(self):
                return {"total": 4, "failed": 0, "avg_duration_ms": 10}

            def fetchall(self):
                if len(self.queries) == 2:
                    return [{
                        "path": "/api/v2/auth/login",
                        "calls": 3,
                        "failed": 0,
                        "avg_duration_ms": 100,
                        "last_called_at": None,
                    }]
                return []

        cursor = FakeCursor()
        original = system.ensure_audit_schema
        system.ensure_audit_schema = lambda cur: None
        try:
            summary = system._api_summary(cursor)
        finally:
            system.ensure_audit_schema = original

        self.assertEqual(summary["failed24h"], 0)
        self.assertIn("status_code >= 500", cursor.queries[0])
        self.assertIn("status_code >= 500", cursor.queries[1])

    def test_profit_snapshot_cache_items_match_file_cache_format(self):
        class FakeCursor:
            def execute(self, sql, params=None):
                self.params = params

            def fetchall(self):
                return [
                    {
                        "snapshot_type": "month",
                        "period_key": "2026-07",
                        "payload_json": '{"summary": {}}',
                        "generated_at": datetime(2026, 8, 9, 9, 30),
                    },
                    {
                        "snapshot_type": "year",
                        "period_key": "2026",
                        "payload_json": '{"summary": {}, "months": []}',
                        "generated_at": datetime(2026, 8, 9, 9, 31),
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class FakeConnection:
            def cursor(self, cursor_type=None):
                return FakeCursor()

            def close(self):
                pass

        original = system.get_connection
        system.get_connection = lambda: FakeConnection()
        try:
            items = system._profit_snapshot_cache_items("2026-07")
        finally:
            system.get_connection = original

        monthly, yearly = items
        self.assertEqual(monthly["label"], "利润月度快照")
        self.assertEqual(yearly["label"], "利润年度快照")
        self.assertEqual(monthly["month"], "2026-07")
        self.assertTrue(monthly["exists"])
        self.assertFalse(monthly["valid"])
        self.assertEqual(monthly["missingKeys"], ["stations"])
        self.assertIsNone(monthly["error"])
        self.assertTrue(yearly["valid"])
        self.assertIsNone(yearly["error"])

    def test_market_watch_source_errors_are_warnings_when_reference_item_available(self):
        originals = {
            "ensure_market_watch_schema": routes_data.ensure_market_watch_schema,
            "fetch_market_benchmark_item": routes_data.fetch_market_benchmark_item,
            "fetch_uzex_market_item": routes_data.fetch_uzex_market_item,
            "spimex_official_reference_item": routes_data.spimex_official_reference_item,
            "upsert_market_source_item": routes_data.upsert_market_source_item,
            "refresh_market_watch_chinese": routes_data.refresh_market_watch_chinese,
        }

        def source_failed(*args, **kwargs):
            raise RuntimeError("source empty")

        routes_data.ensure_market_watch_schema = lambda cur: None
        routes_data.fetch_market_benchmark_item = source_failed
        routes_data.fetch_uzex_market_item = source_failed
        routes_data.spimex_official_reference_item = lambda: {
            "region": "Russia",
            "type": "refined",
            "title": "Reference",
            "summary": "Reference source",
            "priceText": "",
            "sourceName": "SPIMEX",
            "sourceUrl": "https://example.test",
            "observedAt": date(2026, 8, 1),
            "priority": 2,
        }
        routes_data.upsert_market_source_item = lambda cur, item: "inserted"
        routes_data.refresh_market_watch_chinese = lambda cur: 0
        try:
            result = routes_data.run_market_watch_maintenance(object())
        finally:
            for name, value in originals.items():
                setattr(routes_data, name, value)

        self.assertEqual(result["fetched"], 1)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["warnings"]), 2)

    def test_accounting_summary_returns_structured_failed_items(self):
        items = _accounting_failed_items_from_summary({
            "skipped": [
                {"shopKey": 24, "file": "024.xlsx", "reason": "target day has no completed shift"},
            ],
            "warnings": [
                "003: 未匹配机表行 12",
            ],
        }, {
            3: {"name": "STN-05", "short": "S-06", "region": "REG-01"},
            24: {"name": "STN-47", "short": "S-48", "region": "REG-04"},
        })

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["type"], "skipped")
        self.assertEqual(items[0]["shopKey"], 24)
        self.assertEqual(items[0]["station"]["name"], "STN-47")
        self.assertEqual(items[1]["type"], "warning")
        self.assertEqual(items[1]["shopKey"], 3)
        self.assertIn("未匹配机表行", items[1]["reason"])

    def test_accounting_summary_repairs_utf8_decoded_as_cp1251(self):
        mojibake = "008: жњЄеЊ№й…ЌжњєиЎЁиЎЊ 12"
        normalized = _normalize_accounting_text({"warnings": [mojibake]})
        items = _accounting_failed_items_from_summary(normalized, {
            8: {"name": "STN-15", "short": "S-16", "region": "REG-02"},
        })

        self.assertEqual(normalized["warnings"][0], "008: 未匹配机表行 12")
        self.assertEqual(items[0]["shopKey"], 8)
        self.assertEqual(items[0]["reason"], "未匹配机表行 12")

    def test_accounting_summary_preserves_direct_failed_items(self):
        items = _accounting_failed_items_from_summary({
            "failedItems": [
                {"type": "exception", "shopKey": "24", "message": "script crashed"},
            ],
        }, {
            24: {"name": "STN-47", "short": "S-48", "region": "REG-04"},
        })

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["type"], "exception")
        self.assertEqual(items[0]["shopKey"], 24)
        self.assertEqual(items[0]["stationNo"], "024")
        self.assertEqual(items[0]["reason"], "script crashed")
        self.assertEqual(items[0]["station"]["name"], "STN-47")

    def test_accounting_status_uses_historical_station_status_for_target_day(self):
        class FakeCursor:
            def __init__(self):
                self.params = None

            def execute(self, sql, params=None):
                self.params = params

            def fetchall(self):
                return [
                    {
                        "id": 9,
                        "shop_key": 14,
                        "status_type": "renovation",
                        "status_label": "装修暂停营业",
                        "started_at": datetime(2026, 7, 15, 23, 10),
                        "expected_resume_at": None,
                        "ended_at": datetime(2026, 7, 27, 18, 2, 32),
                        "affects_sales": 1,
                        "affects_inventory": 1,
                        "suppress_alerts": 0,
                        "note": "装修",
                        "is_active": 0,
                    }
                ]

        cursor = FakeCursor()
        original_schema = system.ensure_station_status_schema
        original_catalog = system.retail_station_catalog_cached
        system.ensure_station_status_schema = lambda cur: None
        system.retail_station_catalog_cached = lambda: {
            14: {"name": "STN-27", "short": "S-28", "region": "REG-02"},
        }
        try:
            statuses = _accounting_station_statuses_for_day(cursor, date(2026, 7, 24))
        finally:
            system.ensure_station_status_schema = original_schema
            system.retail_station_catalog_cached = original_catalog

        self.assertEqual(cursor.params[0], datetime(2026, 7, 25, 0, 0))
        self.assertEqual(cursor.params[1], datetime(2026, 7, 24, 0, 0))
        self.assertIn(14, statuses)
        self.assertEqual(statuses[14]["status"], "closed")
        self.assertEqual(statuses[14]["statusType"], "renovation")
        self.assertFalse(statuses[14]["isActive"])

    def test_accounting_status_ignores_latest_run_for_other_target_date(self):
        original_root = system.ACCOUNTING_REPORT_ROOT
        original_catalog = system.retail_station_catalog_cached
        original_statuses = system._accounting_station_statuses_for_day
        original_latest = system._latest_automation_row
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            day_dir = root / "20260724"
            day_dir.mkdir()
            (day_dir / "001.xlsx").write_bytes(b"placeholder")
            system.ACCOUNTING_REPORT_ROOT = root
            system.retail_station_catalog_cached = lambda: {
                1: {"name": "STN-01", "short": "S-02", "region": "REG-01"},
            }
            system._accounting_station_statuses_for_day = lambda cur, target_day: {}
            system._latest_automation_row = lambda cur, task: {
                "summary": {
                    "targetDate": "2026-07-25",
                    "warnings": ["001: stale warning"],
                }
            }
            try:
                payload = _accounting_report_status(object(), date(2026, 7, 24))
            finally:
                system.ACCOUNTING_REPORT_ROOT = original_root
                system.retail_station_catalog_cached = original_catalog
                system._accounting_station_statuses_for_day = original_statuses
                system._latest_automation_row = original_latest

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["failedCount"], 0)
        self.assertEqual(payload["warnings"], [])

    def test_accounting_status_ignores_stale_latest_run_when_generated_file_is_newer(self):
        original_root = system.ACCOUNTING_REPORT_ROOT
        original_catalog = system.retail_station_catalog_cached
        original_statuses = system._accounting_station_statuses_for_day
        original_latest = system._latest_automation_row
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            day_dir = root / "20260727"
            day_dir.mkdir()
            file_path = day_dir / "001.xlsx"
            file_path.write_bytes(b"fixed report")
            updated_at = datetime(2026, 7, 28, 9, 10).timestamp()
            os.utime(file_path, (updated_at, updated_at))
            system.ACCOUNTING_REPORT_ROOT = root
            system.retail_station_catalog_cached = lambda: {
                1: {"name": "STN-01", "short": "S-02", "region": "REG-01"},
            }
            system._accounting_station_statuses_for_day = lambda cur, target_day: {}
            system._latest_automation_row = lambda cur, task: {
                "status": "failed",
                "finished_at": "2026-07-28 08:42:32",
                "summary": {
                    "targetDate": "2026-07-27",
                    "generated": [{"file": str(day_dir / "001.xlsx")}],
                    "warnings": ["001: stale warning"],
                },
            }
            try:
                payload = _accounting_report_status(object(), date(2026, 7, 27))
            finally:
                system.ACCOUNTING_REPORT_ROOT = original_root
                system.retail_station_catalog_cached = original_catalog
                system._accounting_station_statuses_for_day = original_statuses
                system._latest_automation_row = original_latest

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["failedCount"], 0)
        self.assertEqual(payload["warnings"], [])
        self.assertTrue(payload["latestRun"]["stale"])

    def test_accounting_status_keeps_generated_station_even_if_status_record_overlaps(self):
        original_root = system.ACCOUNTING_REPORT_ROOT
        original_catalog = system.retail_station_catalog_cached
        original_statuses = system._accounting_station_statuses_for_day
        original_latest = system._latest_automation_row
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            day_dir = root / "20260727"
            day_dir.mkdir()
            (day_dir / "005.xlsx").write_bytes(b"generated")
            system.ACCOUNTING_REPORT_ROOT = root
            system.retail_station_catalog_cached = lambda: {
                5: {"name": "STN-09", "short": "S-10", "region": "REG-01"},
            }
            system._accounting_station_statuses_for_day = lambda cur, target_day: {
                5: {"affectsSales": True, "statusType": "power_outage"}
            }
            system._latest_automation_row = lambda cur, task: None
            try:
                payload = _accounting_report_status(object(), date(2026, 7, 27))
            finally:
                system.ACCOUNTING_REPORT_ROOT = original_root
                system.retail_station_catalog_cached = original_catalog
                system._accounting_station_statuses_for_day = original_statuses
                system._latest_automation_row = original_latest

        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["expectedCount"], 1)
        self.assertEqual(payload["generatedStationCount"], 1)
        self.assertEqual(payload["closedCount"], 0)
        self.assertFalse(payload["generatedFiles"][0]["closed"])

    def test_accounting_task_marks_skipped_items_as_failed(self):
        records = []
        original_runner = system._run_retail_accounting_report_task
        original_recorder = system.record_automation_task
        system._run_retail_accounting_report_task = lambda target_day=None, force=True: {
            "targetDate": "2026-07-25",
            "generatedCount": 1,
            "skipped": [{"shopKey": 24, "reason": "target day has no completed shift"}],
            "warnings": [],
        }
        system.record_automation_task = lambda cur, task, status, summary, error: records.append({
            "task": task,
            "status": status,
            "summary": summary,
            "error": error,
        })
        try:
            result = _run_retail_accounting_reports_task(None)
        finally:
            system._run_retail_accounting_report_task = original_runner
            system.record_automation_task = original_recorder

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failedCount"], 1)
        self.assertEqual(result["failedItems"][0]["shopKey"], 24)
        self.assertEqual(records[0]["status"], "failed")
        self.assertEqual(records[0]["summary"]["failedCount"], 1)

    def test_accounting_task_records_exception_as_failed_item(self):
        records = []

        def fail_runner(target_day=None, force=True):
            raise RuntimeError("script crashed")

        original_runner = system._run_retail_accounting_report_task
        original_recorder = system.record_automation_task
        system._run_retail_accounting_report_task = fail_runner
        system.record_automation_task = lambda cur, task, status, summary, error: records.append({
            "task": task,
            "status": status,
            "summary": summary,
            "error": error,
        })
        try:
            result = _run_retail_accounting_reports_task(None)
        finally:
            system._run_retail_accounting_report_task = original_runner
            system.record_automation_task = original_recorder

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failedCount"], 1)
        self.assertEqual(result["failedItems"][0]["type"], "exception")
        self.assertEqual(records[0]["status"], "failed")
        self.assertEqual(records[0]["summary"]["failedCount"], 1)
        self.assertEqual(records[0]["summary"]["failedItems"][0]["message"], "script crashed")

    def test_previous_completed_month_uses_fully_closed_month(self):
        self.assertEqual(_previous_completed_month(date(2026, 8, 1)), "2026-07")
        self.assertEqual(_previous_completed_month(date(2026, 8, 15)), "2026-07")
        self.assertEqual(_previous_completed_month(date(2026, 1, 1)), "2025-12")

    def test_retail_254_monthly_archive_task_records_success(self):
        records = []
        calls = []
        if str(system.OILSTATION_ROOT) not in sys.path:
            sys.path.insert(0, str(system.OILSTATION_ROOT))
        from endpoints.v1.retail.export.service import report254_monthly

        def fake_generator(month, apply=True):
            calls.append({"month": month, "apply": apply})
            return {
                "status": "ok",
                "month": month,
                "sourceDir": r"D:\archive\2026г\По Месяц\Июль",
                "generatedCount": 27,
                "appliedCount": 27,
                "items": [],
            }

        original_generator = report254_monthly.generate_monthly_254_archive
        original_recorder = system.record_automation_task
        report254_monthly.generate_monthly_254_archive = fake_generator
        system.record_automation_task = lambda cur, task, status, summary, error: records.append({
            "task": task,
            "status": status,
            "summary": summary,
            "error": error,
        })
        try:
            result = _run_retail_254_monthly_archive_task(object(), year_month="2026-07")
        finally:
            report254_monthly.generate_monthly_254_archive = original_generator
            system.record_automation_task = original_recorder

        self.assertEqual(calls, [{"month": "2026-07", "apply": True}])
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["summary"]["month"], "2026-07")
        self.assertEqual(result["summary"]["appliedCount"], 27)
        self.assertEqual(records[0]["task"], "retail_254_monthly_archive")
        self.assertEqual(records[0]["status"], "success")

    def test_retail_254_monthly_archive_paths_are_year_and_month_nested(self):
        if str(system.OILSTATION_ROOT) not in sys.path:
            sys.path.insert(0, str(system.OILSTATION_ROOT))
        from endpoints.v1.retail.export.service import report254_monthly

        root = Path(r"D:\archive")
        self.assertEqual(
            report254_monthly.archive_year_dir(2026, archive_root=root),
            root / "2026г",
        )
        self.assertEqual(
            report254_monthly.archive_yearly_root(2026, archive_root=root),
            root / "2026г" / "По Год",
        )
        self.assertEqual(
            report254_monthly.archive_monthly_root(2026, archive_root=root),
            root / "2026г" / "По Месяц",
        )
        self.assertEqual(
            report254_monthly.month_dir("2026-07", archive_root=root),
            root / "2026г" / "По Месяц" / "Июль",
        )

    def test_retail_254_monthly_archive_uses_oilstation_config_after_sales_config(self):
        import config as sales_config

        self.assertEqual(
            Path(inspect.getsourcefile(sales_config)).resolve(),
            SALES_ROOT / "config.py",
        )
        if str(system.OILSTATION_ROOT) not in sys.path:
            sys.path.insert(0, str(system.OILSTATION_ROOT))
        from endpoints.v1.retail.export.service import report254_monthly

        connect_source = Path(inspect.getsourcefile(report254_monthly.connect)).resolve()
        self.assertEqual(
            connect_source,
            system.OILSTATION_ROOT / "scripts" / "generate_accounting_handover_reports.py",
        )
        self.assertIsNot(
            report254_monthly.connect.__globals__["DB_CONFIG"],
            sales_config.DB_CONFIG,
        )
        self.assertNotEqual(
            report254_monthly.connect.__globals__["DB_CONFIG"]["database"],
            sales_config.DB_CONFIG["database"],
        )
        self.assertEqual(
            report254_monthly.connect.__globals__["DB_CONFIG"]["database"],
            os.getenv("DB_NAME", "ocw"),
        )

    def test_accounting_handover_lpg_balance_mapping_for_legacy_resource_key_zero(self):
        if str(system.OILSTATION_ROOT) not in sys.path:
            sys.path.insert(0, str(system.OILSTATION_ROOT))
        from scripts.generate_accounting_handover_reports import infer_resource

        for shop_key in (19, 22, 24):
            self.assertEqual(infer_resource(shop_key, 0, 7), 108)

    def test_retail_254_monthly_archive_task_fails_when_nothing_applied(self):
        records = []
        if str(system.OILSTATION_ROOT) not in sys.path:
            sys.path.insert(0, str(system.OILSTATION_ROOT))
        from endpoints.v1.retail.export.service import report254_monthly

        original_generator = report254_monthly.generate_monthly_254_archive
        original_recorder = system.record_automation_task
        report254_monthly.generate_monthly_254_archive = lambda month, apply=True: {
            "status": "ok",
            "month": month,
            "generatedCount": 0,
            "appliedCount": 0,
        }
        system.record_automation_task = lambda cur, task, status, summary, error: records.append({
            "task": task,
            "status": status,
            "summary": summary,
            "error": error,
        })
        try:
            result = _run_retail_254_monthly_archive_task(object(), year_month="2026-07")
        finally:
            report254_monthly.generate_monthly_254_archive = original_generator
            system.record_automation_task = original_recorder

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["failedCount"], 1)
        self.assertIn("未生成任何 254 月报归档文件", result["failedItems"][0]["message"])
        self.assertEqual(records[0]["task"], "retail_254_monthly_archive")
        self.assertEqual(records[0]["status"], "failed")

    def test_daily_accounting_task_failed_items_include_skipped_and_warnings(self):
        items = daily_maintenance.accounting_failed_items_from_summary({
            "skipped": [
                {
                    "shopKey": "24",
                    "file": "024_20260725.xlsx",
                    "reason": "target day has no completed shift",
                },
            ],
            "warnings": [
                "003: 未匹配机表行 12",
            ],
        })

        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["type"], "skipped")
        self.assertEqual(items[0]["shopKey"], 24)
        self.assertEqual(items[0]["stationNo"], "024")
        self.assertEqual(items[0]["file"], "024_20260725.xlsx")
        self.assertEqual(items[1]["type"], "warning")
        self.assertEqual(items[1]["shopKey"], 3)
        self.assertEqual(items[1]["stationNo"], "003")
        self.assertIn("未匹配机表行", items[1]["reason"])

    def test_daily_accounting_failed_items_repair_utf8_decoded_as_cp1251(self):
        items = daily_maintenance.accounting_failed_items_from_summary({
            "warnings": [
                "008: жњЄеЊ№й…ЌжњєиЎЁиЎЊ 12",
            ],
        })

        self.assertEqual(items[0]["shopKey"], 8)
        self.assertEqual(items[0]["stationNo"], "008")
        self.assertEqual(items[0]["reason"], "未匹配机表行 12")

    def test_daily_accounting_run_task_records_failed_items(self):
        records = []

        class FakeConnection:
            def cursor(self):
                return object()

            def commit(self):
                self.committed = True

            def rollback(self):
                self.rolled_back = True

            def close(self):
                self.closed = True

        fake_conn = FakeConnection()
        original_runner = daily_maintenance.run_retail_accounting_report_maintenance
        original_recorder = daily_maintenance.record_automation_task
        original_get_connection = daily_maintenance.get_connection
        daily_maintenance.get_connection = lambda: fake_conn
        daily_maintenance.run_retail_accounting_report_maintenance = lambda: {
            "targetDate": "2026-07-25",
            "generatedCount": 1,
            "skipped": [{"shopKey": 24, "reason": "target day has no completed shift"}],
            "warnings": [],
        }
        daily_maintenance.record_automation_task = lambda cur, task, status, summary, error: records.append({
            "task": task,
            "status": status,
            "summary": summary,
            "error": error,
        })
        try:
            result = daily_maintenance.run_task("retail_accounting_reports")
        finally:
            daily_maintenance.run_retail_accounting_report_maintenance = original_runner
            daily_maintenance.record_automation_task = original_recorder
            daily_maintenance.get_connection = original_get_connection

        self.assertEqual(result["failedCount"], 1)
        self.assertEqual(result["failedItems"][0]["shopKey"], 24)
        self.assertEqual(records[0]["task"], "retail_accounting_reports")
        self.assertEqual(records[0]["status"], "failed")
        self.assertEqual(records[0]["summary"]["failedCount"], 1)
        self.assertIn("target day has no completed shift", records[0]["error"])


if __name__ == "__main__":
    unittest.main()
