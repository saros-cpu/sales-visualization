import unittest
import sys
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))
import daily_maintenance
from api_v2 import system
from api_v2.system import _action_center, _accounting_failed_items_from_summary, _run_retail_accounting_reports_task


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
        self.assertIn("status_code NOT IN (401, 403)", cursor.queries[0])
        self.assertIn("status_code NOT IN (401, 403)", cursor.queries[1])

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
