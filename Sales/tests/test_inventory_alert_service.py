import sys
import unittest
from datetime import date
from pathlib import Path


SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from services.inventory_alert_service import build_low_inventory_alerts


class InventoryAlertServiceTests(unittest.TestCase):
    def test_capacity_percentage_drives_warning_and_critical_alerts(self):
        payload = build_low_inventory_alerts(
            [
                {
                    "shopKey": 1,
                    "name": "Station 1",
                    "status": "normal",
                    "inventory": 6000,
                    "inventoryCapacity": 10000,
                    "inventoryFillPercent": 60,
                },
                {
                    "shopKey": 2,
                    "name": "Station 2",
                    "status": "normal",
                    "inventory": 4500,
                    "inventoryCapacity": 10000,
                    "inventoryFillPercent": 45,
                },
                {
                    "shopKey": 3,
                    "name": "Station 3",
                    "status": "normal",
                    "inventory": 2500,
                    "inventoryCapacity": 10000,
                    "inventoryFillPercent": 25,
                },
            ],
            as_of=date(2026, 7, 29),
        )

        items = payload["items"]
        self.assertEqual([item["shopKey"] for item in items], [3, 2])
        self.assertEqual(items[0]["severity"], "critical")
        self.assertEqual(items[1]["severity"], "warning")
        self.assertEqual(payload["summary"]["criticalCount"], 1)
        self.assertEqual(payload["summary"]["warningCount"], 1)

    def test_resource_capacity_is_used_when_station_percentage_is_absent(self):
        payload = build_low_inventory_alerts(
            [
                {
                    "shopKey": 5,
                    "name": "Station 5",
                    "status": "normal",
                    "inventory": 4400,
                    "inventoryByResource": [
                        {"resourceKey": 92, "inventory": 1400, "capacity": 5000},
                        {"resourceKey": 95, "inventory": 3000, "capacity": 5000},
                    ],
                }
            ],
            as_of=date(2026, 7, 29),
        )

        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["resourceKey"], 92)
        self.assertEqual(payload["items"][0]["severity"], "critical")
        self.assertEqual(payload["items"][0]["fillPercent"], 28.0)

    def test_closed_station_without_inventory_impact_is_skipped(self):
        payload = build_low_inventory_alerts(
            [
                {
                    "shopKey": 7,
                    "name": "Station 7",
                    "status": "closed",
                    "affectsInventory": False,
                    "inventory": 100,
                    "inventoryCapacity": 10000,
                    "inventoryFillPercent": 1,
                }
            ],
            as_of=date(2026, 7, 29),
        )

        self.assertEqual(payload["items"], [])


if __name__ == "__main__":
    unittest.main()
