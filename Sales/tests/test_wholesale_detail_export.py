import sys
import unittest
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from api_v2 import wholesale  # noqa: E402


class WholesaleDetailExportTests(unittest.TestCase):
    def test_export_product_splits_mixed_chinese_russian_into_two_lines(self):
        value = wholesale._format_export_product("催化柴油Печное Топливо", "催化柴油")

        self.assertEqual(value, "催化柴油\nПечное Топливо")

    def test_export_party_splits_example_full_name_into_two_lines(self):
        value = wholesale._preferred_party_name(
            "Example石油公司 Example Petroleum CJSC",
            "",
        )

        self.assertEqual(value, "Example石油公司\nExample Petroleum CJSC")

    def test_export_workbook_keeps_bilingual_cells_to_two_explicit_lines(self):
        workbook = wholesale._build_detail_export_workbook(
            [
                {
                    "businessDate": "2026-08-13",
                    "transportMode": "truck",
                    "weighSerialNo": "P001",
                    "rawProductName": "催化柴油Печное Топливо",
                    "standardProductName": "催化柴油",
                    "vehicleNo": "A123",
                    "senderName": "Example石油公司 Example Petroleum CJSC",
                    "standardSenderName": "",
                    "rawEntityName": "Example石油公司 Example Petroleum CJSC",
                    "standardEntityName": "",
                    "entityName": "",
                    "entityType": "",
                    "classification": "export_wholesale",
                    "weightKg": 1000,
                    "weightTons": 1,
                    "remark": "P2603",
                }
            ],
            {
                "wholesale": [
                    {"companyName": "Example石油公司", "productName": "催化柴油", "totalTons": 1, "totalWeightKg": 1000, "recordCount": 1},
                ],
                "processing": [],
                "transfer": [],
            },
        )
        sheet = workbook["明细表"]

        for cell_ref in ("D2", "F2", "G2"):
            self.assertEqual(len(sheet[cell_ref].value.splitlines()), 2)
            self.assertTrue(sheet[cell_ref].alignment.wrap_text)

        self.assertEqual(sheet["D2"].value, "催化柴油\nПечное Топливо")
        self.assertEqual(sheet["F2"].value, "Example石油公司\nExample Petroleum CJSC")
        self.assertGreaterEqual(sheet.column_dimensions["F"].width, 45)
        self.assertGreaterEqual(sheet.column_dimensions["G"].width, 45)



    def test_prefer_station_display_uses_standard_without_alias_duplicate(self):
        value = wholesale._preferred_party_name(
            "CUSTOMER-H-З",
            "CJSC НПЗ CUSTOMER-H-3",
            prefer_russian_station=True,
        )
        self.assertEqual(value, "CJSC НПЗ CUSTOMER-H-3")

    def test_transfer_summary_name_prefers_full_station_name_with_prefix(self):
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            1001: {
                "name": "奥伊尔资源",
                "short": "CJSC CUSTOMER-L",
            }
        }
        try:
            value = wholesale._build_transfer_summary_name(
                "alias",
                "standard",
                entity_type="retail_station",
                entity_code="1001",
            )
            self.assertEqual(value, "АЗС CJSC CUSTOMER-L")
        finally:
            shared_utils.retail_station_catalog_cached = original

    def test_export_workbook_uses_russian_transfer_station_and_bilingual_summary_product(self):
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            1: {
                "name": "STN-01",
                "short": "S-02",
            }
        }
        try:
            items = [
                {
                    "businessDate": "2026-08-13",
                    "transportMode": "truck",
                    "weighSerialNo": "P002",
                    "rawProductName": "催化柴油Печное Топливо",
                    "standardProductName": "催化柴油",
                    "vehicleNo": "A456",
                    "senderName": "Example石油公司",
                    "standardSenderName": "",
                    "rawEntityName": "S-02",
                    "standardEntityName": "S-02",
                    "entityName": "S-02",
                    "entityType": "retail_station",
                    "entityCode": "1",
                    "classification": "transfer",
                    "weightKg": 2000,
                    "weightTons": 2,
                    "remark": "",
                }
            ]
            workbook = wholesale._build_detail_export_workbook(items, wholesale._build_summary_rows(items))
        finally:
            shared_utils.retail_station_catalog_cached = original

        detail = workbook["明细表"]
        transfer = workbook["外运汇总表"]

        self.assertEqual(detail["G2"].value, "АЗС S-02")
        self.assertEqual(transfer["A2"].value, "Азс - 01")  # 编号列 = Азс - 01（两位数）
        self.assertEqual(transfer["B2"].value, "АЗС S-02")  # 站点
        self.assertEqual(transfer["C2"].value, "催化柴油\nПечное Топливо")  # 油品（中俄双语）
        self.assertTrue(transfer["C2"].alignment.wrap_text)

    def test_summary_rows_skips_non_station_transfer_customers(self):
        rows = wholesale._build_summary_rows([
            {
                "classification": "transfer",
                "standardEntityName": "CJSC CUSTOMER-K",
                "rawEntityName": "CJSC CUSTOMER-K",
                "entityCode": "1",
                "entityType": "wholesale_customer",
                "standardProductName": "柴油",
                "weightTons": 12.34,
                "weightKg": 12340,
            }
        ])
        self.assertEqual(rows["transfer"], [])

    def test_transfer_summary_name_skips_non_station_customer(self):
        value = wholesale._build_transfer_summary_name(
            "CJSC CUSTOMER-K",
            "",
            entity_type="wholesale_customer",
            entity_code="9999",
        )
        self.assertEqual(value, "")

    def test_transfer_summary_name_depot_without_azs_prefix(self):
        # 油库显示目录名（不带 АЗС 前缀）
        value = wholesale._build_transfer_summary_name(
            "АЗС Нефтебаза CTY-05",
            "STN-63 S-64",
            entity_type="own_depot",
            entity_code="south_CTY-30_depot",
        )
        self.assertEqual(value, "S-64")

    def test_is_transfer_party_recognizes_retail_station_with_wrong_classification(self):
        # 分类误标为 local_wholesale，但实体是零售站点 → 仍视为外运
        self.assertTrue(wholesale._is_transfer_party({
            "entityType": "retail_station",
            "entityCode": "20",
            "standardEntityName": "S-40",
            "classification": "local_wholesale",
        }))

    def test_is_transfer_party_rejects_internal_use_depot(self):
        self.assertFalse(wholesale._is_transfer_party({
            "entityType": "own_depot",
            "entityCode": "internal_use",
            "standardEntityName": "内部用油",
        }))

    def test_transfer_summary_reroutes_retail_station_wrong_classification(self):
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            20: {"name": "STN-39", "short": "S-40"},
        }
        try:
            rows = wholesale._build_summary_rows([
                {
                    "classification": "local_wholesale",
                    "rawEntityName": "S-40",
                    "standardEntityName": "S-40",
                    "entityType": "retail_station",
                    "entityCode": "20",
                    "standardProductName": "92#汽油",
                    "weightTons": 2.5,
                    "weightKg": 2500,
                },
                {
                    "classification": "transfer",
                    "rawEntityName": "S-40",
                    "standardEntityName": "S-40",
                    "entityType": "retail_station",
                    "entityCode": "20",
                    "standardProductName": "80#汽油",
                    "weightTons": 1,
                    "weightKg": 1000,
                },
            ])
        finally:
            shared_utils.retail_station_catalog_cached = original
        self.assertNotIn("S-40", [r["companyName"] for r in rows["wholesale"]])
        self.assertEqual(len(rows["transfer"]), 2)
        for row in rows["transfer"]:
            self.assertEqual(row["companyName"], "АЗС S-40")
            self.assertEqual(row["stationNumber"], 20)

    def test_transfer_summary_sorted_by_station_number(self):
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            6: {"name": "STN-11", "short": "S-12"},
            18: {"name": "巴雷克奇2", "short": "S-36"},
        }
        try:
            rows = wholesale._build_summary_rows([
                {
                    "classification": "transfer",
                    "rawEntityName": "S-36",
                    "standardEntityName": "S-36",
                    "entityType": "retail_station",
                    "entityCode": "18",
                    "standardProductName": "80#汽油",
                    "weightTons": 1,
                    "weightKg": 1000,
                },
                {
                    "classification": "transfer",
                    "rawEntityName": "S-12",
                    "standardEntityName": "S-12",
                    "entityType": "retail_station",
                    "entityCode": "6",
                    "standardProductName": "80#汽油",
                    "weightTons": 1,
                    "weightKg": 1000,
                },
                {
                    "classification": "transfer",
                    "rawEntityName": "АЗС Нефтебаза CTY-05",
                    "standardEntityName": "STN-63 S-64",
                    "entityType": "own_depot",
                    "entityCode": "south_CTY-30_depot",
                    "standardProductName": "80#汽油",
                    "weightTons": 1,
                    "weightKg": 1000,
                },
            ])
        finally:
            shared_utils.retail_station_catalog_cached = original
        station_numbers = [row["stationNumber"] for row in rows["transfer"]]
        names = [row["companyName"] for row in rows["transfer"]]
        self.assertEqual(station_numbers, [6, 18, None])
        self.assertEqual(names, ["АЗС S-12", "АЗС S-36", "S-64"])

if __name__ == "__main__":
    unittest.main()

