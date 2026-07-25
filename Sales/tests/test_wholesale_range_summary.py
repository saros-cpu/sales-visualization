import sys
import unittest
from contextlib import ExitStack
from datetime import date
from pathlib import Path
from unittest.mock import patch

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from wholesale_service import (  # noqa: E402
    daily_trend,
    summarize_wholesale_page,
    summarize_wholesale_range,
    wholesale_data_quality_warnings,
)


CARDS = {
    "export_wholesale": {"rows": 1, "entities": 1, "tons": 10, "amountCny": 100, "matchedRows": 1, "reviewRows": 0},
    "local_wholesale": {"rows": 2, "entities": 2, "tons": 20, "amountCny": 200, "matchedRows": 2, "reviewRows": 0},
    "unknown": {"rows": 0, "entities": 0, "tons": 0, "amountCny": 0, "matchedRows": 0, "reviewRows": 0},
    "transfer": {"rows": 0, "entities": 0, "tons": 0, "amountCny": 0, "matchedRows": 0, "reviewRows": 0},
    "processing": {"rows": 0, "entities": 0, "tons": 0, "amountCny": 0, "matchedRows": 0, "reviewRows": 0},
    "procurement": {"rows": 0, "entities": 0, "tons": 0, "amountCny": 0, "matchedRows": 0, "reviewRows": 0},
}


class WholesaleRangeSummaryTests(unittest.TestCase):
    def _patched_summary_dependencies(self):
        stack = ExitStack()
        patches = [
            patch("wholesale_service.category_cards", return_value=CARDS),
            patch("wholesale_service.transport_summary", return_value={}),
            patch("wholesale_service.operation_transport_summary", return_value={}),
            patch("wholesale_service.product_rankings", return_value={}),
            patch("wholesale_service.customer_rankings", return_value={}),
            patch("wholesale_service.transfer_targets", return_value=[]),
            patch("wholesale_service.transfer_summary", return_value={}),
            patch("wholesale_service.daily_trend", return_value=[]),
            patch("wholesale_service.monthly_trend", return_value=[]),
            patch("wholesale_service.review_summary", return_value={}),
            patch("wholesale_service.open_issues", return_value=[]),
            patch("wholesale_service.exchange_rates", return_value=[]),
            patch(
                "wholesale_service.wholesale_data_completeness",
                return_value={"sourcePolicy": {"cutoff": "2026-06-01"}, "lpgTank": {"tableExists": False}},
            ),
        ]
        for item in patches:
            stack.enter_context(item)
        return stack

    def test_range_summary_uses_exact_start_and_end_without_monthly_comparison(self):
        with self._patched_summary_dependencies():
            data = summarize_wholesale_range(object(), date(2026, 8, 10), date(2026, 8, 14), label="本周")

        self.assertEqual(data["period"]["start"], "2026-08-10")
        self.assertEqual(data["period"]["end"], "2026-08-14")
        self.assertIsNone(data["period"]["month"])
        self.assertEqual(data["period"]["label"], "本周")
        self.assertEqual(data["comparison"], {})

    def test_month_page_keeps_original_month_period_and_comparison(self):
        with self._patched_summary_dependencies(), patch(
            "wholesale_service.wholesale_card_comparison",
            return_value={"local_wholesale": {"momTons": 12.5}},
        ):
            data = summarize_wholesale_page(object(), 2026, 8)

        self.assertEqual(data["period"]["year"], 2026)
        self.assertEqual(data["period"]["month"], 8)
        self.assertEqual(data["period"]["start"], "2026-08-01")
        self.assertEqual(data["comparison"]["local_wholesale"]["momTons"], 12.5)

    def test_lpg_annual_gap_warning_requires_before_cutoff_missing_raw_source(self):
        warnings = wholesale_data_quality_warnings(
            {"lpgTankSource": {"tableExists": True, "rawRows": 0}},
            date(2026, 1, 1),
            date(2027, 1, 1),
        )

        self.assertTrue(any("lpg_weighing" in item for item in warnings))
        self.assertTrue(any("不会用 LPG 产品量推算罐区总量" in item for item in warnings))

    def test_lpg_after_cutoff_report_period_does_not_require_raw_tank_source(self):
        warnings = wholesale_data_quality_warnings(
            {"lpgTankSource": {"tableExists": True, "rawRows": 0}},
            date(2026, 6, 1),
            date(2026, 9, 1),
        )

        self.assertFalse(any("lpg_weighing" in item for item in warnings))

    def test_daily_trend_fills_short_period_calendar_days(self):
        class Cursor:
            def execute(self, *_args, **_kwargs):
                return None

            def fetchall(self):
                return [
                    (date(2026, 8, 2), "export_wholesale", 10, 100),
                    (date(2026, 8, 2), "local_wholesale", 2.5, 20),
                ]

        rows = daily_trend(Cursor(), date(2026, 8, 1), date(2026, 8, 4))

        self.assertEqual([item["date"] for item in rows], ["2026-08-01", "2026-08-02", "2026-08-03"])
        self.assertEqual(rows[0]["exportTons"], 0)
        self.assertEqual(rows[1]["exportTons"], 10)
        self.assertEqual(rows[1]["localTons"], 2.5)

    def test_complete_pre_cutoff_sources_do_not_emit_missing_source_warning(self):
        warnings = wholesale_data_quality_warnings(
            {
                "weighingRawSources": {
                    "storageDistrict": {"tableExists": True, "rawRows": 12},
                    "lpgTankArea": {"tableExists": True, "rawRows": 8},
                }
            },
            date(2026, 1, 1),
            date(2026, 6, 1),
        )

        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
