import sys
import unittest
from pathlib import Path


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

    def test_electron_file_origin_is_allowed(self):
        self.assert_allows_origin("file://")

    def test_electron_null_origin_is_allowed(self):
        self.assert_allows_origin("null")

    def test_public_domain_and_ip_origins_are_allowed(self):
        self.assert_allows_origin("http://sales.example.com")
        self.assert_allows_origin("http://198.51.100.10")

    def test_wallpaper_token_header_is_allowed(self):
        response = self.client.options(
            "/api/wallpaper/map",
            headers={
                "Origin": "null",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "X-Wallpaper-Token",
            },
        )
        self.assertEqual(response.status_code, 200)
        allowed = response.headers.get("Access-Control-Allow-Headers", "")
        self.assertIn("X-Wallpaper-Token", allowed)


if __name__ == "__main__":
    unittest.main()
