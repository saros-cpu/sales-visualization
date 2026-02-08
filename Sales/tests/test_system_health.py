import unittest
import sys
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))
from api_v2.system import _action_center


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


if __name__ == "__main__":
    unittest.main()
