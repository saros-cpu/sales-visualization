import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

import api


FAKE_CONSTANTS = SimpleNamespace(
    SHOP_KEY_MAP={
        1: {"name": "一号站", "short": "Station 1", "region": "REG-01"},
        2: {"name": "二号站", "short": "Station 2", "region": "REG-01"},
    },
    SHOP_COORDS={
        1: {"lng": 0, "lat": 0},
        2: {"lng": 0, "lat": 0},
    },
    CLOSED_STATIONS={2: "停业测试"},
    FORCE_NORMAL_STATIONS=set(),
    DEPOT_COORDS={
        "DemoDepotNorth": {"lng": 0, "lat": 0, "region": "REG-06", "short": "North Depot", "status": "normal"},
    },
)


DETAILS_PAYLOAD = {
    "snapshotGeneratedAt": "2026-07-29 08:00",
    "items": [
        {
            "shopKey": 1,
            "inventory": 1234.5,
            "inventoryByResource": [{"name": "АИ 92", "inventory": 1234.5, "price": 68}],
            "prices": [{"name": "АИ 92", "price": 68}],
            "inventoryAsOf": "2026-07-29",
            "snapshotGeneratedAt": "2026-07-29 08:00",
        }
    ],
}


class WallpaperMapTests(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()

    def request_payload(self, headers=None):
        with patch.object(api, "_wallpaper_oilstation_constants", return_value=FAKE_CONSTANTS), \
             patch.object(api, "_wallpaper_active_statuses", return_value={}), \
             patch.object(api, "_wallpaper_station_details", return_value=DETAILS_PAYLOAD):
            response = self.client.get("/api/wallpaper/map", headers=headers or {})
        self.assertEqual(response.status_code, 200)
        return response.get_json()["data"]

    def test_public_wallpaper_map_omits_sensitive_inventory(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": ""}, clear=False):
            payload = self.request_payload()
        self.assertFalse(payload["sensitiveData"])
        self.assertNotIn("inventoryByResource", payload["stations"][0])
        self.assertIsNone(payload["summary"]["inventoryLiters"])
        self.assertEqual(payload["summary"]["stationCount"], 2)

    def test_wallpaper_token_allows_inventory_details(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": "secret"}, clear=False):
            payload = self.request_payload(headers={"X-Wallpaper-Token": "secret"})
        self.assertTrue(payload["sensitiveData"])
        self.assertEqual(payload["stations"][0]["inventory"], 1234.5)
        self.assertEqual(payload["summary"]["inventoryLiters"], 1234.5)


if __name__ == "__main__":
    unittest.main()
