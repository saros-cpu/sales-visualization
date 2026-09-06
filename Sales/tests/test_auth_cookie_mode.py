# -*- coding: utf-8 -*-
"""任务5：JWT HttpOnly Cookie dual 模式测试。

覆盖：
 1. 默认 off 模式：登录/会话恢复绝不种 JWT Cookie（Desktop 5.6.0 行为不变）；
 2. dual 模式：种 HttpOnly+Secure+SameSite=Lax 的 access/refresh cookie，
    Cookie 可独立完成认证（无需 Authorization 头），refresh 走 refresh cookie；
 3. dual 模式退出登录：Cookie 被清除；
 4. dual 模式响应体仍含 accessToken/refreshToken（前端可继续走 header）。
"""
import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

import api as sales_api  # noqa: E402
import api_v2.auth as auth_v2  # noqa: E402
from auth_cookie import apply_auth_config  # noqa: E402

FAKE_USER = {
    "id": 1,
    "username": "admin",
    "display_name": "管理员",
    "role": "admin",
    "must_change_password": False,
}
FAKE_AUTHZ = {
    "permissions": {},
    "permissionCodes": [],
    "roles": [],
    "departments": [],
    "dataScopes": {},
}


class _FakeCursor:
    def __init__(self, user):
        self._user = user

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self._sql = sql

    def fetchone(self):
        if "SELECT COUNT" in self._sql or "user_count" in self._sql:
            return {"user_count": 1}
        return dict(self._user)

    def fetchall(self):
        return []


class _FakeConnection:
    def __init__(self, user):
        self._user = user

    def cursor(self, *args, **kwargs):
        return _FakeCursor(self._user)

    def commit(self):
        pass

    def close(self):
        pass


class AuthCookieModeTest(unittest.TestCase):
    def setUp(self):
        self._orig_env = os.environ.get("SALES_AUTH_COOKIE_MODE")
        self._orig_conn = auth_v2.get_connection
        self._orig_schema = auth_v2.ensure_auth_schema
        self._orig_shared_schema = None
        self._orig_authz = auth_v2._get_user_authz
        self._orig_revoke = auth_v2.revoke_jwt_payload
        import shared_utils
        self._orig_shared_schema = shared_utils.ensure_auth_schema
        auth_v2.ensure_auth_schema = lambda cur: None
        shared_utils.ensure_auth_schema = lambda cur: None
        auth_v2.get_connection = lambda: _FakeConnection(FAKE_USER)
        auth_v2._get_user_authz = lambda user_id, role: FAKE_AUTHZ
        auth_v2.revoke_jwt_payload = lambda payload: 0

    def tearDown(self):
        auth_v2.get_connection = self._orig_conn
        auth_v2.ensure_auth_schema = self._orig_schema
        auth_v2._get_user_authz = self._orig_authz
        auth_v2.revoke_jwt_payload = self._orig_revoke
        import shared_utils
        shared_utils.ensure_auth_schema = self._orig_shared_schema
        if self._orig_env is None:
            os.environ.pop("SALES_AUTH_COOKIE_MODE", None)
        else:
            os.environ["SALES_AUTH_COOKIE_MODE"] = self._orig_env
        apply_auth_config(sales_api.app)

    def _session_client(self):
        client = sales_api.app.test_client()
        with client.session_transaction() as sess:
            sess["user"] = {
                "id": 1,
                "username": "admin",
                "displayName": "管理员",
                "role": "admin",
                "mustChangePassword": False,
            }
        return client

    def test_off_mode_sets_no_jwt_cookies(self):
        os.environ["SALES_AUTH_COOKIE_MODE"] = "off"
        apply_auth_config(sales_api.app)
        response = self._session_client().get("/api/v2/auth/status")
        self.assertEqual(200, response.status_code)
        data = (response.get_json() or {}).get("data") or {}
        self.assertTrue(data.get("accessToken"))  # 正文 token 始终返回
        headers = "".join(response.headers.getlist("Set-Cookie"))
        self.assertNotIn("access_token_cookie", headers)
        self.assertNotIn("refresh_token_cookie", headers)

    def test_dual_mode_sets_httponly_cookies_and_cookie_auth_works(self):
        os.environ["SALES_AUTH_COOKIE_MODE"] = "dual"
        apply_auth_config(sales_api.app)
        client = self._session_client()
        response = client.get("/api/v2/auth/status")
        self.assertEqual(200, response.status_code)
        cookies = response.headers.getlist("Set-Cookie")
        all_cookies = "; ".join(cookies)
        self.assertIn("access_token_cookie=", all_cookies)
        self.assertIn("refresh_token_cookie=", all_cookies)
        self.assertIn("HttpOnly", all_cookies)
        self.assertIn("SameSite=Lax", all_cookies)
        # 响应体仍含 token（header 通道并存）
        data = (response.get_json() or {}).get("data") or {}
        self.assertTrue(data.get("accessToken"))
        self.assertTrue(data.get("refreshToken"))
        # 仅凭 Cookie（不带 Authorization）访问受保护接口
        me_response = client.get("/api/v2/auth/me")
        self.assertEqual(200, me_response.status_code)
        # 用 refresh cookie 刷新 access
        refresh_response = client.post("/api/v2/auth/refresh")
        self.assertEqual(200, refresh_response.status_code)
        self.assertIn("access_token_cookie=", "; ".join(refresh_response.headers.getlist("Set-Cookie")))

    def test_dual_mode_logout_clears_cookies(self):
        os.environ["SALES_AUTH_COOKIE_MODE"] = "dual"
        apply_auth_config(sales_api.app)
        client = self._session_client()
        response = client.get("/api/v2/auth/status")
        self.assertEqual(200, response.status_code)
        logout_response = client.post("/api/v2/auth/logout")
        self.assertEqual(200, logout_response.status_code)
        cleared = "; ".join(logout_response.headers.getlist("Set-Cookie"))
        self.assertIn("access_token_cookie=;", cleared)
        self.assertIn("refresh_token_cookie=;", cleared)

    def test_dual_mode_keeps_header_login_flow(self):
        os.environ["SALES_AUTH_COOKIE_MODE"] = "dual"
        apply_auth_config(sales_api.app)
        client = sales_api.app.test_client()
        # header 通道：直接带 Authorization 访问受保护接口（Desktop 5.6.0 场景）
        from flask_jwt_extended import create_access_token
        with sales_api.app.app_context():
            token = create_access_token(identity="1", additional_claims={"role": "admin"})
        me_response = client.get("/api/v2/auth/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(200, me_response.status_code)


if __name__ == "__main__":
    unittest.main()
