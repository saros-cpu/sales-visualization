from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from flask_jwt_extended import create_access_token  # noqa: E402
import api as sales_api  # noqa: E402
import api_v2.auth as auth_v2  # noqa: E402
import shared_utils  # noqa: E402

ACTIVE_API_CALL_DIRS = (
    PROJECT_ROOT / "SalesDesktop" / "src",
    PROJECT_ROOT / "frontend" / "src",
    PROJECT_ROOT / "Sales" / "scripts",
)


def _source_files():
    for root in ACTIVE_API_CALL_DIRS:
        for pattern in ("*.ts", "*.tsx", "*.js", "*.jsx", "*.py"):
            yield from root.rglob(pattern)


class ApiContractTest(unittest.TestCase):
    def test_v2_auth_status_supports_dict_cursor_user_count(self):
        original_connection = auth_v2.get_connection
        original_auth_schema = auth_v2.ensure_auth_schema
        original_shared_schema = shared_utils.ensure_auth_schema
        auth_v2.get_connection = lambda: _FakeStatusConnection({"user_count": 1})
        auth_v2.ensure_auth_schema = lambda cur: None
        shared_utils.ensure_auth_schema = lambda cur: None
        try:
            response = sales_api.app.test_client().get("/api/v2/auth/status")
        finally:
            auth_v2.get_connection = original_connection
            auth_v2.ensure_auth_schema = original_auth_schema
            shared_utils.ensure_auth_schema = original_shared_schema

        payload = response.get_json(silent=True) or {}
        self.assertEqual(200, response.status_code)
        self.assertTrue((payload.get("data") or {}).get("hasUsers"))
        self.assertFalse((payload.get("data") or {}).get("authenticated"))

    def test_active_clients_and_scripts_do_not_call_deprecated_api_paths(self):
        forbidden = (
            "/api/auth/",
            "/api/data-assistant/query",
            "/api/v2/users/permissions",
            "/users/permissions",
        )
        offenders: list[str] = []
        for path in _source_files():
            text = path.read_text(encoding="utf-8", errors="ignore")
            for token in forbidden:
                if token in text:
                    offenders.append(f"{path.relative_to(PROJECT_ROOT)} contains {token}")
        self.assertEqual([], offenders)

    def test_deprecated_user_permission_apis_return_410(self):
        with sales_api.app.app_context():
            token = create_access_token(identity="1", additional_claims={"role": "admin"})
        client = sales_api.app.test_client()
        headers = {"Authorization": f"Bearer {token}"}
        cases = (
            ("PUT", "/api/v2/users/1/permissions"),
            ("GET", "/api/v2/users/permissions/modules"),
            ("GET", "/api/v2/users/permissions"),
            ("PUT", "/api/v2/users/permissions"),
        )
        for method, path in cases:
            with self.subTest(path=path):
                for request_headers in ({}, headers):
                    response = client.open(path, method=method, headers=request_headers, json={})
                    payload = response.get_json(silent=True) or {}
                    self.assertEqual(410, response.status_code)
                    self.assertEqual("deprecated_permission_api", payload.get("message"))
                    self.assertEqual("/api/v2/organization/overview", (payload.get("data") or {}).get("successor"))

    def test_deprecated_v1_auth_apis_return_410(self):
        client = sales_api.app.test_client()
        cases = (
            ("GET", "/api/auth/status", "/api/v2/auth/status"),
            ("POST", "/api/auth/bootstrap", "/api/v2/auth/bootstrap"),
            ("POST", "/api/auth/login", "/api/v2/auth/login"),
            ("POST", "/api/auth/logout", "/api/v2/auth/logout"),
            ("POST", "/api/auth/change-password", "/api/v2/auth/change-password"),
        )
        for method, path, successor in cases:
            with self.subTest(path=path):
                response = client.open(path, method=method, json={})
                payload = response.get_json(silent=True) or {}
                self.assertEqual(410, response.status_code)
                self.assertEqual("deprecated_auth_api", payload.get("message"))
                self.assertEqual(successor, (payload.get("data") or {}).get("successor"))

    def test_deprecated_assistant_api_returns_410(self):
        client = sales_api.app.test_client()
        response = client.post("/api/data-assistant/query", json={"question": "今年零售数据"})
        payload = response.get_json(silent=True) or {}
        self.assertEqual(410, response.status_code)
        self.assertEqual("deprecated_assistant_api", payload.get("message"))
        self.assertEqual("/api/v2/assistant/query", (payload.get("data") or {}).get("successor"))
        self.assertEqual("true", response.headers.get("Deprecation"))


class _FakeStatusConnection:
    def __init__(self, count_row):
        self.cursor_instance = _FakeStatusCursor(count_row)

    def cursor(self, cursor_class=None):
        return self.cursor_instance

    def close(self):
        pass


class _FakeStatusCursor:
    def __init__(self, count_row):
        self.count_row = count_row

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        pass

    def fetchone(self):
        return self.count_row


if __name__ == "__main__":
    unittest.main()
