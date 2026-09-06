import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))
from retail_internal import import_oilstation

_core = import_oilstation("endpoints.v1.retail.analytics.service.core")
_total_tons_from_daily_resource = _core._total_tons_from_daily_resource
_total_tons_from_resource_summary = _core._total_tons_from_resource_summary
_shared = import_oilstation("endpoints.v1.retail.analytics.service.shared")
add_resource_tons = _shared.add_resource_tons
format_resource_rows = _shared.format_resource_rows
retail_daily_payload_mass_needs_refresh = _shared.retail_daily_payload_mass_needs_refresh
from retail_bridge import summarize_from_oilstation  # noqa: E402


class RetailTrueMassTests(unittest.TestCase):
    def test_resource_rows_use_mass_for_tons(self):
        rows = format_resource_rows([(103, 1000, 5000, 900)])

        self.assertEqual(rows[0]["mass"], 900)
        self.assertEqual(rows[0]["tons"], 0.9)
        self.assertEqual(add_resource_tons(rows), 0.9)

    def test_implausible_cached_tons_are_not_trusted(self):
        rows = [{"resourceKey": 103, "volume": 1000, "tons": 0.001, "amount": 5000}]

        self.assertEqual(add_resource_tons(rows), 0.74)
        self.assertEqual(rows[0]["mass"], 740)
        self.assertEqual(rows[0]["tons"], 0.74)

    def test_total_tons_prefers_mass_or_tons_fields(self):
        self.assertEqual(
            _total_tons_from_daily_resource([
                {"date": "2026-07-01", "resourceKey": 103, "volume": 1000, "mass": 900},
                {"date": "2026-07-02", "resourceKey": 103, "volume": 1000, "tons": 0.91},
            ])["totalTons"],
            1.81,
        )
        self.assertEqual(
            _total_tons_from_resource_summary([
                {"resourceKey": 103, "volume": 1000, "mass": 900},
                {"resourceKey": 104, "volume": 1000, "tons": 0.92},
            ])["totalTons"],
            1.82,
        )

    def test_daily_snapshot_with_explicit_mass_does_not_force_refresh(self):
        payload = {
            "daily": [
                {"date": "2026-07-29", "volume": 693.91, "mass": 275.694, "tons": 0.276, "amount": 50660.41}
            ],
            "stations": {
                "1": [{"date": "2026-07-29", "volume": 1000, "mass": 740, "tons": 0.74, "amount": 10000}]
            },
        }

        self.assertFalse(retail_daily_payload_mass_needs_refresh(payload))

    def test_daily_snapshot_missing_mass_still_forces_refresh(self):
        payload = {"daily": [{"date": "2026-07-01", "volume": 1000, "amount": 10000}], "stations": {}}

        self.assertTrue(retail_daily_payload_mass_needs_refresh(payload))

    def test_sales_retail_bridge_prefers_oilstation_mass(self):
        source = {
            "source": "OilStationReport",
            "queryStart": "2026-07-01",
            "queryEndExclusive": "2026-07-02",
            "summary": {"totalLiters": 1000, "totalSales": 10000},
            "daily": [{"date": "2026-07-01", "amount": 10000}],
            "dailyResource": [
                {"date": "2026-07-01", "resourceKey": 103, "volume": 1000, "mass": 900}
            ],
        }
        with patch("retail_bridge.fetch_oilstation_summary", return_value=source), \
             patch("retail_bridge.load_densities", return_value={103: [(date(2026, 1, 1), 0.74)]}), \
             patch("retail_bridge.load_rates", return_value={date(2026, 7, 1): 10}):
            result = summarize_from_oilstation(object(), 2026, 7)

        self.assertEqual(result["tons"], 0.9)
        self.assertEqual(result["byProduct"][0]["tons"], 0.9)


if __name__ == "__main__":
    unittest.main()
