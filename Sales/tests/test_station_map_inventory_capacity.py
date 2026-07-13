import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OILSTATION_ROOT = ROOT / "OilStation"

_SENTINEL = object()
_TOP_LEVEL_MODULES = ("business_time", "cache_store", "config", "constants", "db", "export_excel")
_saved_modules = {name: sys.modules.get(name, _SENTINEL) for name in _TOP_LEVEL_MODULES}
_saved_path = list(sys.path)
for name in _TOP_LEVEL_MODULES:
    sys.modules.pop(name, None)
try:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    if str(OILSTATION_ROOT) not in sys.path:
        sys.path.insert(0, str(OILSTATION_ROOT))
    from endpoints.v1.retail.analytics.service import core as retail_core  # noqa: E402
    from endpoints.v1.retail.analytics.service.core import (  # noqa: E402
        _fuelbalance_capacity_by_resource_from_rows,
        _infer_fuelbalance_resource_key,
        _station_map_depots,
        _station_map_details_cache_current,
        _station_map_details_has_capacity,
        _station_map_details_has_depots,
    )
finally:
    sys.path[:] = _saved_path
    for name, module in _saved_modules.items():
        if module is _SENTINEL:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module


class StationMapInventoryCapacityTests(unittest.TestCase):
    def test_fuelbalance_name_prevents_price_threshold_misclassification(self):
        self.assertEqual(_infer_fuelbalance_resource_key(1, 103, "ÀÈ-92", 81.8), 103)
        self.assertEqual(_infer_fuelbalance_resource_key(28, 0, "ÀÈ 92", 82.0), 103)
        self.assertEqual(_infer_fuelbalance_resource_key(28, 0, "ÀÈ 95", 96.9), 104)
        self.assertEqual(_infer_fuelbalance_resource_key(28, 0, "ÄÒ -35", 100.0), 110)
        self.assertEqual(_infer_fuelbalance_resource_key(29, 0, "ÃÀÇ", 44.7), 108)
        self.assertEqual(_infer_fuelbalance_resource_key(6, 0, "0", 81.9, 3), 103)
        self.assertEqual(_infer_fuelbalance_resource_key(30, 0, "Àè 80", 68.0, 1), 102)
        self.assertEqual(_infer_fuelbalance_resource_key(30, 0, "Àè 92", 83.3, 2), 103)

    def test_fuelbalance_capacity_uses_latest_tank_rows_without_duplication(self):
        rows = [
            (5, 3, 102, "ÀÈ-80", 68.0, 24628.0),
            (5, 4, 103, "0", 81.9, 30000.0),
            (5, 5, 108, "ÃÀÇ", 41.9, 15000.0),
            (5, 5, 108, "ÃÀÇ", 41.9, 24648.0),
            (28, 4, 0, "ÄÒ -15", 96.8, 40000.0),
            (28, 5, 0, "ÄÒ -35", 100.0, 40000.0),
        ]

        result = _fuelbalance_capacity_by_resource_from_rows(rows)

        self.assertEqual(result[(5, 102)], 24628.0)
        self.assertEqual(result[(5, 103)], 30000.0)
        self.assertEqual(result[(5, 108)], 24648.0)
        self.assertEqual(result[(28, 106)], 40000.0)
        self.assertEqual(result[(28, 110)], 40000.0)

    def test_fuelbalance_capacity_uses_observed_tank_fallback_and_filters_station_30_diesel(self):
        rows = [
            (3, 1, 102, "0", 68.0, 0.0, 1602.76),
            (30, 1, 0, "Àè 80", 68.0, 25000.0, 18873.65),
            (30, 2, 0, "Àè 92", 83.3, 15000.0, 6369.79),
            (30, 3, 0, "Äò", 96.9, 25000.0, 0.0),
        ]
        observed = {(3, "1", 102): 20379.36}

        result = _fuelbalance_capacity_by_resource_from_rows(rows, observed_by_tank=observed)

        self.assertEqual(result[(3, 102)], 20379.36)
        self.assertEqual(result[(30, 102)], 25000.0)
        self.assertEqual(result[(30, 103)], 15000.0)
        self.assertNotIn((30, 106), result)

    def test_station_map_cache_with_only_unknown_capacity_is_stale(self):
        payload = {
            "items": [
                {
                    "inventoryByResource": [
                        {"resourceKey": 103, "inventory": 1000, "fillStatus": "unknown"},
                    ]
                }
            ]
        }

        self.assertFalse(_station_map_details_has_capacity(payload))

    def test_station_map_cache_with_known_capacity_is_current(self):
        payload = {
            "items": [
                {
                    "inventoryByResource": [
                        {"resourceKey": 103, "inventory": 1000, "fillStatus": "warning"},
                    ]
                }
            ]
        }

        self.assertTrue(_station_map_details_has_capacity(payload))

    def test_station_map_cache_requires_depots(self):
        depots = _station_map_depots()

        self.assertGreaterEqual(len(depots), 3)
        self.assertFalse(_station_map_details_has_depots({"items": []}))
        self.assertTrue(_station_map_details_has_depots({"depots": depots}))
        self.assertTrue(all(item.get("name") for item in depots))
        self.assertEqual(len(depots), 3)
        self.assertTrue(all(item.get("type") in {"depot", "headquarters"} for item in depots))

    def test_station_map_live_cache_does_not_query_shift_marker(self):
        payload = {
            "source": "live_database",
            "snapshotGeneratedAt": "2026-08-08 08:00",
            "depots": _station_map_depots(),
            "items": [
                {
                    "shopKey": 1,
                    "inventoryByResource": [
                        {"resourceKey": 103, "inventory": 1000, "fillStatus": "warning"},
                    ],
                }
            ],
        }
        original_workbook = retail_core._latest_report_workbook_for_map
        original_marker = retail_core._latest_completed_shift_marker_for_map
        try:
            retail_core._latest_report_workbook_for_map = lambda: (_ for _ in ()).throw(AssertionError("workbook lookup should not run"))
            retail_core._latest_completed_shift_marker_for_map = lambda: (_ for _ in ()).throw(AssertionError("shift marker should not run"))

            self.assertTrue(_station_map_details_cache_current(payload))
        finally:
            retail_core._latest_report_workbook_for_map = original_workbook
            retail_core._latest_completed_shift_marker_for_map = original_marker

    def test_station_map_zero_inventory_override(self):
        details = {
            21: {
                "shopKey": 21,
                "inventory": 500.0,
                "inventoryCapacity": 1000.0,
                "inventoryByResource": [
                    {"resourceKey": 103, "inventory": 500.0, "capacity": 1000.0, "fillPercent": 50.0, "fillStatus": "warning"},
                ],
            }
        }

        from endpoints.v1.retail.analytics.service.core import _apply_station_map_inventory_overrides  # noqa: E402

        self.assertTrue(_apply_station_map_inventory_overrides(details))
        detail = details[21]
        self.assertEqual(detail["inventory"], 0.0)
        self.assertEqual(detail["inventoryFillPercent"], 0.0)
        self.assertEqual(detail["inventoryFillStatus"], "critical")
        self.assertTrue(detail["inventoryZeroedByMapRule"])
        self.assertEqual(detail["inventoryByResource"][0]["inventory"], 0.0)


if __name__ == "__main__":
    unittest.main()
