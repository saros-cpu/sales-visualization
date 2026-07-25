from pathlib import Path
import sys
import unittest

import pandas as pd

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from scripts.import_wholesale_excel import classify_detail, detect_transport_mode, detail_transport_mode, find_detail_columns, pair_key
from import_helpers import _wholesale_detail_duplicate_key


class WholesaleDetailColumnDetectionTest(unittest.TestCase):
    def test_detect_transport_mode_from_remarks(self):
        self.assertEqual(detect_transport_mode("50673367", "火车"), "train")
        self.assertEqual(detect_transport_mode(None, "Ж/Д вагон"), "train")
        self.assertEqual(detect_transport_mode("01KG000AA", "代加工412"), "truck")

    def test_processing_transport_mode_uses_remark_only(self):
        self.assertEqual(detail_transport_mode("processing", "TRAIN-001", "Ж/Д", "代加工412"), "truck")
        self.assertEqual(detail_transport_mode("processing", "01KG000AA", None, "代加工 火车"), "train")
        self.assertEqual(detail_transport_mode("transfer", "01KG000AA", None, "火车"), "train")

    def test_processing_summary_pair_does_not_override_sender_receiver_rule(self):
        entity_lookup = {
            "DIRECT LOCAL": {
                "entity_type": "wholesale_customer",
                "entity_code": "100",
                "standard_name": "DIRECT LOCAL",
            }
        }

        classification = classify_detail(
            _FakeCursor(),
            entity_lookup,
            "DIRECT LOCAL",
            "AI80",
            "ExampleCo",
            set(),
            set(),
            {pair_key("DIRECT LOCAL", "AI80")},
        )

        self.assertEqual("local_wholesale", classification)

    def test_transfer_summary_pair_requires_retail_alias_rule(self):
        classification = classify_detail(
            _FakeCursor(),
            {},
            "External AZS Customer",
            "AI80",
            "Unknown Sender",
            set(),
            {pair_key("External AZS Customer", "AI80")},
            set(),
        )

        self.assertEqual("unknown", classification)

    def test_detects_june_detail_chinese_headers(self):
        df = pd.DataFrame(
            [
                [None] * 9,
                [None] * 9,
                [None] * 9,
                [None, "заезда", None, "номер", "авто", " отправитель", "получатель", "обьем", None],
                ["序号", "入厂日期", "油品名称", "磅单号", "车号", "油品所属公司", "供应商/客户", "过磅重量", "备注"],
                ["1", "2026.6.1", "80#汽油Бензин", "12026060001", "01KG000AA", "CUSTOMER-H", "CUSTOMER-H", "26610", "代加工412"],
            ]
        )

        data_start_row, columns = find_detail_columns(df)

        self.assertEqual(data_start_row, 5)
        self.assertEqual(columns["date"], 1)
        self.assertEqual(columns["product"], 2)
        self.assertEqual(columns["serial"], 3)
        self.assertEqual(columns["vehicle"], 4)
        self.assertEqual(columns["sender"], 5)
        self.assertEqual(columns["entity"], 6)
        self.assertEqual(columns["weight"], 7)
        self.assertEqual(columns["remark"], 8)

    def test_detects_russian_sender_serial_and_vehicle_headers(self):
        df = pd.DataFrame(
            [
                [None, "дата заезда", "примечание", "номер", "авто", "отправитель", "получатель", "объем"],
                ["2026.6.1", "2026.6.1", "80#汽油Бензин", "12026060001", "01KG000AA", "ExampleCo", "АЗС CTY-07 4", "28720"],
            ]
        )

        data_start_row, columns = find_detail_columns(df)

        self.assertEqual(data_start_row, 1)
        self.assertEqual(columns["serial"], 3)
        self.assertEqual(columns["vehicle"], 4)
        self.assertEqual(columns["sender"], 5)
        self.assertEqual(columns["entity"], 6)
        self.assertEqual(columns["weight"], 7)

    def test_uses_previous_russian_header_when_sender_chinese_cell_is_broken(self):
        df = pd.DataFrame(
            [
                [None] * 10,
                [None] * 10,
                ["№", "дата ", "примечание", "серийный", "номер ", "фирма ", "фирма", "  ", "备注", None],
                [None, "заезда", None, "номер", "авто", " отправитель", "получатель", "обьем", None, None],
                ["序号", "入厂日期", "油品名称", "磅单号", "车号", 0, "供应商/客户", "过磅重量", None, None],
                [1, "2026.7.1", "92#汽油Бензин", None, 50673367, "ExampleCo", "CUSTOMER-Q", 59225, "火车", 345.312],
            ]
        )

        data_start_row, columns = find_detail_columns(df)

        self.assertEqual(data_start_row, 5)
        self.assertEqual(columns["sender"], 5)
        self.assertEqual(columns["serial"], 3)
        self.assertEqual(columns["vehicle"], 4)

class WholesaleDetailDuplicateKeyTest(unittest.TestCase):
    # row layout expected by _wholesale_detail_duplicate_key:
    # (id, batch_id, source_row_number, business_date, raw_product_name,
    #  standard_entity_name, raw_entity_name, vehicle_no, weight_kg, weigh_serial_no)
    def _row(self, **over):
        base = {
            "id": 1, "batch_id": 1, "source_row_number": 1,
            "business_date": "2026-08-10", "raw_product_name": "AI92",
            "standard_entity_name": "CJSC CUSTOMER-R", "raw_entity_name": None,
            "vehicle_no": "01KG000AA", "weight_kg": 27000, "weigh_serial_no": "12026080002",
        }
        base.update(over)
        return (
            base["id"], base["batch_id"], base["source_row_number"], base["business_date"],
            base["raw_product_name"], base["standard_entity_name"], base["raw_entity_name"],
            base["vehicle_no"], base["weight_kg"], base["weigh_serial_no"],
        )

    def test_same_serial_is_duplicate(self):
        a = self._row()
        b = self._row(id=2, batch_id=2, source_row_number=50)
        self.assertEqual(_wholesale_detail_duplicate_key(a), _wholesale_detail_duplicate_key(b))

    def test_different_serial_same_rest_is_not_duplicate(self):
        a = self._row(weigh_serial_no="12026080002")
        b = self._row(id=2, weigh_serial_no="12026080003")
        self.assertNotEqual(_wholesale_detail_duplicate_key(a), _wholesale_detail_duplicate_key(b))

    def test_falls_back_to_vehicle_when_no_serial(self):
        a = self._row(weigh_serial_no=None)
        b = self._row(id=2, batch_id=2, source_row_number=99, weigh_serial_no=None)
        self.assertEqual(_wholesale_detail_duplicate_key(a), _wholesale_detail_duplicate_key(b))

    def test_different_weight_is_not_duplicate(self):
        a = self._row(weight_kg=27000)
        b = self._row(id=2, weight_kg=27001)
        self.assertNotEqual(_wholesale_detail_duplicate_key(a), _wholesale_detail_duplicate_key(b))

    def test_missing_company_or_weight_returns_none(self):
        self.assertIsNone(_wholesale_detail_duplicate_key(self._row(standard_entity_name=None, raw_entity_name=None)))
        self.assertIsNone(_wholesale_detail_duplicate_key(self._row(weight_kg=None)))


class _FakeCursor:
    def __init__(self):
        self._one = None
        self._many = []

    def execute(self, sql, params=()):
        statement = " ".join(sql.upper().split())
        if "FROM CUSTOMERS" in statement and "WHERE ID = %S" in statement:
            self._one = ("DIRECT LOCAL", "local_wholesale") if params[0] == 100 else None
            self._many = []
            return
        if "FROM CUSTOMERS" in statement:
            rows = {"DIRECT LOCAL": ("DIRECT LOCAL", "local_wholesale")}
            self._one = rows.get(params[0])
            self._many = []
            return
        if "FROM ENTITY_ALIASES" in statement:
            self._one = None
            self._many = []
            return
        self._one = None
        self._many = []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._many


if __name__ == "__main__":
    unittest.main()