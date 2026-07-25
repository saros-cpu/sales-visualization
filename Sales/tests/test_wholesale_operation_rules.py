import sys
import unittest
from datetime import date
from pathlib import Path


SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from summary_service import (  # noqa: E402
    OPERATION_CLASSES,
    wholesale_operation_type_for_classification,
    wholesale_operation_type_sql,
)
from wholesale_service import category_cards  # noqa: E402


class WholesaleOperationRuleTest(unittest.TestCase):
    def test_operation_type_is_classification_based(self):
        self.assertEqual("loading", wholesale_operation_type_for_classification("local_wholesale"))
        self.assertEqual("loading", wholesale_operation_type_for_classification("export_wholesale"))
        self.assertEqual("loading", wholesale_operation_type_for_classification("transfer"))
        self.assertEqual("unloading", wholesale_operation_type_for_classification("procurement"))
        self.assertEqual("other", wholesale_operation_type_for_classification("processing"))
        self.assertEqual("other", wholesale_operation_type_for_classification("unknown"))

    def test_sql_does_not_treat_internal_receivers_as_unloading(self):
        sql = wholesale_operation_type_sql("d")

        self.assertIn("d.classification = 'procurement'", sql)
        self.assertIn("'transfer'", sql)
        self.assertNotIn("entity_type", sql)
        self.assertEqual(("export_wholesale", "local_wholesale", "transfer", "procurement"), OPERATION_CLASSES)

    def test_category_cards_include_processing_and_unknown(self):
        cur = _FakeCursor()

        cards = category_cards(cur, date(2026, 8, 1), date(2026, 9, 1))

        self.assertIn("'processing'", cur.sql)
        self.assertIn("'unknown'", cur.sql)
        self.assertIn("processing", cards)
        self.assertIn("unknown", cards)
        self.assertEqual(0, cards["processing"]["tons"])
        self.assertEqual(0, cards["unknown"]["tons"])


class _FakeCursor:
    def __init__(self):
        self.sql = ""
        self.params = ()

    def execute(self, sql, params=()):
        self.sql = sql
        self.params = params

    def fetchall(self):
        return []


if __name__ == "__main__":
    unittest.main()
