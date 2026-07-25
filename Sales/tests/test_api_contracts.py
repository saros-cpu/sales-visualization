from pathlib import Path
import re
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from flask_jwt_extended import create_access_token  # noqa: E402
import api as sales_api  # noqa: E402
import api_v2.auth as auth_v2  # noqa: E402
from api_v2.permission_service import PERMISSION_CATALOG, ROLE_DEFAULT_ACTIONS  # noqa: E402
from api_v2.assistant import _business_rule_agent, _should_use_rule_engine_fast_path  # noqa: E402
import shared_utils  # noqa: E402

ACTIVE_API_CALL_DIRS = (
    PROJECT_ROOT / "SalesDesktop" / "src",
    PROJECT_ROOT / "frontend" / "src",
    PROJECT_ROOT / "Sales" / "scripts",
)

DESKTOP_PAGE_DIRS = (
    PROJECT_ROOT / "SalesDesktop" / "src" / "pages",
    PROJECT_ROOT / "SalesDesktop" / "src" / "components",
)


def _source_files():
    for root in ACTIVE_API_CALL_DIRS:
        for pattern in ("*.ts", "*.tsx", "*.js", "*.jsx", "*.py"):
            yield from root.rglob(pattern)


class ApiContractTest(unittest.TestCase):
    def test_wholesale_entry_update_permission_is_configurable(self):
        permission_codes = {item[0] for item in PERMISSION_CATALOG}
        self.assertIn("wholesale_entry:update", permission_codes)
        self.assertIn("wholesale_entry:update", ROLE_DEFAULT_ACTIONS["operator"])
        self.assertIn("wholesale_entry:update", ROLE_DEFAULT_ACTIONS["sales_manager"])
        self.assertIn("wholesale_entry:update", ROLE_DEFAULT_ACTIONS["sales_staff"])

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

    def test_v2_auth_status_restores_tokens_for_session_user(self):
        original_connection = auth_v2.get_connection
        original_auth_schema = auth_v2.ensure_auth_schema
        original_shared_schema = shared_utils.ensure_auth_schema
        original_authz = auth_v2._get_user_authz
        fake_user = {
            "id": 1,
            "username": "admin",
            "display_name": "管理员",
            "role": "admin",
            "must_change_password": False,
        }
        auth_v2.get_connection = lambda: _FakeSessionStatusConnection(fake_user)
        auth_v2.ensure_auth_schema = lambda cur: None
        shared_utils.ensure_auth_schema = lambda cur: None
        auth_v2._get_user_authz = lambda user_id, role: {
            "permissions": {},
            "permissionCodes": [],
            "roles": [],
            "departments": [],
            "dataScopes": {},
        }
        try:
            client = sales_api.app.test_client()
            with client.session_transaction() as sess:
                sess["user"] = {
                    "id": 1,
                    "username": "admin",
                    "displayName": "管理员",
                    "role": "admin",
                    "mustChangePassword": False,
                }
            response = client.get("/api/v2/auth/status")
        finally:
            auth_v2.get_connection = original_connection
            auth_v2.ensure_auth_schema = original_auth_schema
            shared_utils.ensure_auth_schema = original_shared_schema
            auth_v2._get_user_authz = original_authz

        payload = response.get_json(silent=True) or {}
        data = payload.get("data") or {}
        self.assertEqual(200, response.status_code)
        self.assertTrue(data.get("authenticated"))
        self.assertTrue(data.get("accessToken"))
        self.assertTrue(data.get("refreshToken"))

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

    def test_desktop_pages_do_not_bypass_api_wrappers(self):
        offenders: list[str] = []
        for root in DESKTOP_PAGE_DIRS:
            for path in root.rglob("*"):
                if path.suffix not in {".ts", ".tsx"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                if "import client from '@/api/client'" in text:
                    offenders.append(f"{path.relative_to(PROJECT_ROOT)} imports the raw API client")
                if re.search(r"\bclient\.(get|post|put|delete)\(", text):
                    offenders.append(f"{path.relative_to(PROJECT_ROOT)} calls the raw API client")
                if "fetch('/api" in text or 'fetch("/api' in text:
                    offenders.append(f"{path.relative_to(PROJECT_ROOT)} calls /api directly")
        self.assertEqual([], offenders)

    def test_desktop_api_wrappers_use_shared_path_catalog(self):
        offenders: list[str] = []
        raw_call = re.compile(r"\b(?:client|api|apiV1|apiV2)\.(?:get|post|put|delete)\(\s*[`'\"]/")
        for path in (PROJECT_ROOT / "SalesDesktop" / "src" / "api").glob("*.ts"):
            if path.name in {"http.ts", "download.ts"}:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if raw_call.search(text):
                offenders.append(str(path.relative_to(PROJECT_ROOT)))
        self.assertEqual([], offenders)

    def test_assistant_rule_engine_fast_path_skips_llm_for_deterministic_routes(self):
        station_payload = {"ok": True, "answer": "当前停业站点", "assistantPlan": {"route": "station_status"}}
        retail_payload = {"ok": True, "answer": "零售摘要", "assistantPlan": {"route": "retail_summary"}}

        self.assertTrue(_should_use_rule_engine_fast_path(station_payload, use_llm=True))
        self.assertTrue(_should_use_rule_engine_fast_path(retail_payload, use_llm=False))
        self.assertFalse(_should_use_rule_engine_fast_path(retail_payload, use_llm=True))

        agent = _business_rule_agent()
        self.assertEqual("business-rule-engine", agent["provider"])
        self.assertFalse(agent["llmUsed"])


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


class _FakeSessionStatusConnection:
    def __init__(self, user):
        self.cursor_instance = _FakeSessionStatusCursor(user)

    def cursor(self, cursor_class=None):
        return self.cursor_instance

    def close(self):
        pass


class _FakeSessionStatusCursor:
    def __init__(self, user):
        self.user = user
        self.last_query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.last_query = sql

    def fetchone(self):
        if "SELECT id, username, display_name, role, must_change_password" in self.last_query:
            return self.user
        return {"user_count": 1}


if __name__ == "__main__":
    unittest.main()
