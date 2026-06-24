import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from api import app


class ApiCorsTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def preflight(self, origin):
        return self.client.options(
            "/api/v2/auth/login",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type, Authorization",
            },
        )

    def assert_allows_origin(self, origin):
        response = self.preflight(origin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), origin)
        self.assertEqual(response.headers.get("Access-Control-Allow-Credentials"), "true")

    def assert_blocks_origin(self, origin):
        response = self.preflight(origin)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))

    def test_legacy_file_origin_is_blocked_by_default(self):
        with patch.dict(os.environ, {"SALES_LEGACY_ELECTRON_CORS": ""}, clear=False):
            self.assert_blocks_origin("file://")

    def test_legacy_null_origin_is_blocked_by_default(self):
        with patch.dict(os.environ, {"SALES_LEGACY_ELECTRON_CORS": ""}, clear=False):
            self.assert_blocks_origin("null")

    def test_legacy_electron_origin_can_be_enabled_temporarily(self):
        with patch.dict(os.environ, {"SALES_LEGACY_ELECTRON_CORS": "1"}, clear=False):
            self.assert_allows_origin("file://")

    def test_desktop_app_origin_is_allowed(self):
        self.assert_allows_origin("app://salesdesktop")

    def test_public_domain_and_ip_origins_are_allowed(self):
        self.assert_allows_origin("http://sales.example.com")
        self.assert_allows_origin("http://198.51.100.10")

    def test_wallpaper_token_header_is_allowed(self):
        response = self.client.options(
            "/api/wallpaper/map",
            headers={
                "Origin": "app://salesdesktop",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "X-Wallpaper-Token",
            },
        )
        self.assertEqual(response.status_code, 200)
        allowed = response.headers.get("Access-Control-Allow-Headers", "")
        self.assertIn("X-Wallpaper-Token", allowed)


if __name__ == "__main__":
    unittest.main()
