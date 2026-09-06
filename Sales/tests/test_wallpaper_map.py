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
import routes_wallpaper as wallpaper_api
from routes_wallpaper import _wallpaper_amount_cny_by_average, _wallpaper_status_label


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
    MAP_ZERO_INVENTORY_STATIONS=set(),
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
            "inventoryCapacity": 5000,
            "inventoryFillPercent": 24.7,
            "inventoryFillStatus": "critical",
            "inventoryByResource": [{"name": "АИ 92", "inventory": 1234.5, "price": 68}],
            "prices": [{"name": "АИ 92", "price": 68}],
            "inventoryAsOf": "2026-07-29",
            "snapshotGeneratedAt": "2026-07-29 08:00",
        }
    ],
}


SALES_SUMMARY = {
    "year": 2026,
    "yearStart": "2026-01-01",
    "yearEnd": "2026-07-28",
    "yearEndExclusive": "2026-07-29",
    "yearVolumeLiters": 1234567.89,
    "yearAmount": 7654321.12,
    "yearAmountCny": 621000.09,
    "yearAvgCnyKgs": 12.3266,
    "month": "2026-07",
    "monthStart": "2026-07-01",
    "monthEnd": "2026-07-28",
    "monthEndExclusive": "2026-07-29",
    "monthVolumeLiters": 234567.89,
    "monthAmount": 1234567.12,
    "monthAmountCny": 100123.45,
    "monthAvgCnyKgs": 12.3312,
}


EXCHANGE_SUMMARY = {
    "available": True,
    "date": "2026-07-29",
    "usdKgs": 87.4567,
    "cnyKgs": 12.3456,
    "source": "NBKR",
    "isManual": False,
    "isToday": True,
}


class WallpaperMapTests(unittest.TestCase):
    def setUp(self):
        self.client = api.app.test_client()

    def request_payload(self, headers=None, query_string=None):
        with patch.object(wallpaper_api, "_wallpaper_oilstation_constants", return_value=FAKE_CONSTANTS), \
             patch.object(wallpaper_api, "_wallpaper_active_statuses", return_value={}), \
             patch.object(wallpaper_api, "_wallpaper_station_details", return_value=DETAILS_PAYLOAD), \
             patch.object(wallpaper_api, "_wallpaper_sales_summary", return_value=SALES_SUMMARY), \
             patch.object(wallpaper_api, "_wallpaper_exchange_summary", return_value=EXCHANGE_SUMMARY), \
             patch.object(wallpaper_api, "build_low_inventory_alerts", return_value={"items": [], "summary": {"alertCount": 0, "criticalCount": 0, "warningCount": 0}}):
            response = self.client.get("/api/wallpaper/map", headers=headers or {}, query_string=query_string or {})
        self.assertEqual(response.status_code, 200)
        return response.get_json()["data"]

    def test_public_wallpaper_map_omits_sensitive_inventory(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": ""}, clear=False):
            payload = self.request_payload()
        self.assertFalse(payload["sensitiveData"])
        self.assertNotIn("inventoryByResource", payload["stations"][0])
        self.assertNotIn("salesSummary", payload)
        self.assertNotIn("exchangeSummary", payload)
        self.assertEqual(payload["summary"]["depotCount"], 1)
        self.assertEqual(payload["depots"][0]["type"], "depot")
        self.assertEqual(payload["depots"][0]["statusLabel"], "在营")
        self.assertEqual(payload["stations"][0]["statusLabel"], "在营")
        self.assertEqual(payload["stations"][1]["statusLabel"], "停业")
        self.assertIsNone(payload["summary"]["inventoryLiters"])
        self.assertEqual(payload["summary"]["stationCount"], 2)

    def test_wallpaper_token_allows_inventory_details(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": "secret"}, clear=False):
            payload = self.request_payload(headers={"X-Wallpaper-Token": "secret"})
        self.assertTrue(payload["sensitiveData"])
        self.assertEqual(payload["stations"][0]["inventory"], 1234.5)
        self.assertEqual(payload["stations"][0]["inventoryCapacity"], 5000)
        self.assertEqual(payload["stations"][0]["inventoryFillPercent"], 24.7)
        self.assertEqual(payload["stations"][0]["inventoryFillStatus"], "critical")
        self.assertEqual(payload["summary"]["inventoryLiters"], 1234.5)
        self.assertEqual(payload["summary"]["inventoryCriticalCount"], 0)
        self.assertEqual(payload["salesSummary"]["yearVolumeLiters"], 1234567.89)
        self.assertEqual(payload["salesSummary"]["yearAmountCny"], 621000.09)
        self.assertEqual(payload["salesSummary"]["monthAmount"], 1234567.12)
        self.assertEqual(payload["salesSummary"]["monthAmountCny"], 100123.45)
        self.assertEqual(payload["exchangeSummary"]["usdKgs"], 87.4567)
        self.assertEqual(payload["exchangeSummary"]["cnyKgs"], 12.3456)
        self.assertEqual(payload["exchangeSummary"]["source"], "NBKR")

    def test_wallpaper_cny_conversion_uses_period_average_rate(self):
        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                return None

            def fetchall(self):
                return [(12.1,), (12.3,)]

        class FakeConnection:
            def cursor(self):
                return FakeCursor()

            def close(self):
                return None

        with patch.object(wallpaper_api, "get_connection", return_value=FakeConnection()):
            amount_cny, avg_cny = _wallpaper_amount_cny_by_average(
                123000,
                "2026-07-01",
                "2026-07-03",
            )
        self.assertEqual(avg_cny, 12.2)
        self.assertEqual(amount_cny, 10081.97)

    def test_wallpaper_query_token_is_ignored_by_default(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": "secret"}, clear=False):
            payload = self.request_payload(query_string={"token": "secret"})
        self.assertFalse(payload["sensitiveData"])
        self.assertNotIn("inventory", payload["stations"][0])
        self.assertIsNone(payload["summary"]["inventoryLiters"])

    def test_wallpaper_zero_inventory_station_overrides_stale_detail(self):
        constants = SimpleNamespace(
            **{
                **FAKE_CONSTANTS.__dict__,
                "CLOSED_STATIONS": {1: "停业，库存清零"},
                "MAP_ZERO_INVENTORY_STATIONS": {1},
            }
        )
        with patch.object(wallpaper_api, "_wallpaper_oilstation_constants", return_value=constants), \
             patch.object(wallpaper_api, "_wallpaper_active_statuses", return_value={}), \
             patch.object(wallpaper_api, "_wallpaper_station_details", return_value=DETAILS_PAYLOAD), \
             patch.object(wallpaper_api, "_wallpaper_sales_summary", return_value=SALES_SUMMARY), \
             patch.object(wallpaper_api, "_wallpaper_exchange_summary", return_value=EXCHANGE_SUMMARY), \
             patch.object(wallpaper_api, "build_low_inventory_alerts", return_value={"items": [], "summary": {"alertCount": 0, "criticalCount": 0, "warningCount": 0}}), \
             patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": "secret"}, clear=False):
            response = self.client.get("/api/wallpaper/map", headers={"X-Wallpaper-Token": "secret"})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["stations"][0]["inventory"], 0.0)
        self.assertEqual(payload["stations"][0]["inventoryByResource"][0]["inventory"], 0.0)
        self.assertTrue(payload["stations"][0]["inventoryZeroedByMapRule"])
        self.assertEqual(payload["summary"]["inventoryLiters"], 0.0)

    def test_wallpaper_trusted_ip_allows_inventory_details_without_token(self):
        with patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": "", "SALES_WALLPAPER_TRUSTED_IPS": "10.8.0.100"}, clear=False):
            payload = self.request_payload(headers={"X-Real-IP": "10.8.0.100"})
        self.assertTrue(payload["sensitiveData"])
        self.assertEqual(payload["stations"][0]["inventory"], 1234.5)
        self.assertEqual(payload["summary"]["inventoryLiters"], 1234.5)

    def test_force_normal_station_overrides_active_closed_status(self):
        constants = SimpleNamespace(
            **{
                **FAKE_CONSTANTS.__dict__,
                "FORCE_NORMAL_STATIONS": {2},
            }
        )
        stale_statuses = {
            2: {
                "status": "closed",
                "statusType": "renovation",
                "statusLabel": "装修中",
                "closedReason": "旧停业记录",
                "affectsSales": True,
                "affectsInventory": True,
                "suppressAlerts": False,
                "statusNote": "旧停业记录",
                "expectedResumeAt": None,
            }
        }
        with patch.object(wallpaper_api, "_wallpaper_oilstation_constants", return_value=constants), \
             patch.object(wallpaper_api, "_wallpaper_active_statuses", return_value=stale_statuses), \
             patch.object(wallpaper_api, "_wallpaper_station_details", return_value=DETAILS_PAYLOAD), \
             patch.object(wallpaper_api, "build_low_inventory_alerts", return_value={"items": [], "summary": {"alertCount": 0, "criticalCount": 0, "warningCount": 0}}), \
             patch.dict(os.environ, {"SALES_WALLPAPER_TOKEN": ""}, clear=False):
            response = self.client.get("/api/wallpaper/map")
        self.assertEqual(response.status_code, 200)
        station = response.get_json()["data"]["stations"][1]
        self.assertEqual(station["shopKey"], 2)
        self.assertEqual(station["status"], "normal")
        self.assertEqual(station["statusLabel"], "在营")
        self.assertEqual(station["closedReason"], "")

    def test_wallpaper_status_label_normalizes_business_terms(self):
        self.assertEqual(_wallpaper_status_label("normal", status_label="normal"), "在营")
        self.assertEqual(_wallpaper_status_label("closed", closed_reason="装修停业"), "装修")
        self.assertEqual(_wallpaper_status_label("closed", closed_reason="修路占道，无法营业"), "停业")


if __name__ == "__main__":
    unittest.main()
