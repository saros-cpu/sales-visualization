from pathlib import Path
import sys
import unittest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

import shared_utils  # noqa: E402


class HasUsersTest(unittest.TestCase):
    def test_has_users_supports_tuple_cursor_rows(self):
        cursor = _FakeCountCursor((1,))
        self.assertTrue(_call_has_users_without_schema(cursor))
        self.assertIn("AS user_count", cursor.last_sql)

    def test_has_users_supports_dict_cursor_rows(self):
        cursor = _FakeCountCursor({"user_count": 1})
        self.assertTrue(_call_has_users_without_schema(cursor))
        self.assertIn("AS user_count", cursor.last_sql)

    def test_has_users_handles_empty_cursor_rows(self):
        cursor = _FakeCountCursor(None)
        self.assertFalse(_call_has_users_without_schema(cursor))


class _FakeCountCursor:
    def __init__(self, row):
        self.row = row
        self.last_sql = ""

    def execute(self, sql):
        self.last_sql = sql

    def fetchone(self):
        return self.row


def _call_has_users_without_schema(cursor):
    original = shared_utils.ensure_auth_schema
    shared_utils.ensure_auth_schema = lambda cur: None
    try:
        return shared_utils.has_users(cursor)
    finally:
        shared_utils.ensure_auth_schema = original


if __name__ == "__main__":
    unittest.main()
