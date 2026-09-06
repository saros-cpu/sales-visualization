import sys
import unittest
from datetime import date
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from calculations import provisional_sales_classification, recalculate_wholesale_batch, resolve_sales_customer  # noqa: E402
from import_helpers import (  # noqa: E402
    can_auto_approve_weigh_detail,
    classify_wholesale_movement,
    format_lpg_remark,
    format_lpg_tank_remark,
    is_customer_like_entity_name,
    is_internal_entity_name,
    load_sender_standard_lookup,
    lookup_customer_type,
    normalize_wholesale_classification,
    resolve_customer_reference,
    resolve_sender_standard_name,
    smart_product_code,
)
from services.weighing_service import auto_classify  # noqa: E402


class LpgRemarkFormatTest(unittest.TestCase):
    def test_formats_lpg_receiving_remark_json(self):
        remark = (
            '{"operation":"ПРИЕМ","spec_or_trailer":"01KG000AA",'
            '"gross_time":"1899-12-30T11:26:13","tare_time":"1899-12-30T21:30:21",'
            '"operator":"yang","tare_operator":"yang"}'
        )

        self.assertEqual(
            "卸车/收货 | 挂车/规格 01KG000AA | 毛重 11:26:13 | 皮重 21:30:21 | 司磅 yang/yang",
            format_lpg_remark(remark),
        )

    def test_formats_lpg_shipping_operation_code(self):
        remark = '{"operation":"ОТПРАВКА       P2402","tare_time":"1899-12-30T17:30:56"}'

        self.assertEqual("装车/发货 | P2402 | 皮重 17:30:56", format_lpg_remark(remark))

    def test_formats_plain_lpg_operation_code(self):
        self.assertEqual("装车/发货 | P2402", format_lpg_remark("ОТПРАВКА       P2402"))

    def test_keeps_plain_remark_readable(self):
        self.assertEqual("manual remark", format_lpg_remark(" manual   remark "))

    def test_lpg_tank_remark_returns_only_tank_code(self):
        self.assertEqual(
            "P2603",
            format_lpg_tank_remark('{"operation":"ОТПРАВКА       P2603","tare_time":"1899-12-30T17:30:56"}'),
        )
        self.assertEqual("P2402", format_lpg_tank_remark("ОТПРАВКА       p2402"))

    def test_lpg_tank_remark_hides_non_tank_details(self):
        remark = (
            '{"operation":"ПРИЕМ","spec_or_trailer":"01KG000AA",'
            '"gross_time":"1899-12-30T11:26:13","tare_time":"1899-12-30T21:30:21",'
            '"operator":"yang","tare_operator":"yang"}'
        )
        self.assertEqual("", format_lpg_tank_remark(remark))


class CustomerTypeLookupTest(unittest.TestCase):
    def test_export_customer_keeps_maintained_type(self):
        cursor = _FakeWholesaleLookupCursor()

        self.assertEqual("export_wholesale", lookup_customer_type(cursor, "BONENOOK IMPEX"))
        self.assertEqual(("BONENOOK IMPEX", "export_wholesale"), resolve_customer_reference(cursor, "BONENOOK IMPEX"))

    def test_refinery_legal_prefix_uses_existing_local_alias(self):
        cursor = _FakeWholesaleLookupCursor()

        self.assertEqual("local_wholesale", lookup_customer_type(cursor, "CJSC НПЗ CUSTOMER-H-3"))
        self.assertEqual(("CUSTOMER-H 3", "local_wholesale"), resolve_sales_customer(cursor, "CJSC НПЗ CUSTOMER-H-3"))

    def test_internal_sender_to_customer_uses_customer_classification(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "CJSC НПЗ CUSTOMER-H-3": {
                "entity_type": "wholesale_customer",
                "entity_code": "388",
                "standard_name": "CJSC НПЗ CUSTOMER-H-3",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "CJSC НПЗ CUSTOMER-H-3",
            sender_name="Example Petroleum CJSC",
            current="unknown",
        )

        self.assertEqual("local_wholesale", classification)

    def test_direct_customer_maintenance_classifies_without_entity_alias(self):
        cursor = _FakeWholesaleLookupCursor()
        classification = classify_wholesale_movement(
            cursor,
            {},
            "DIRECT LOCAL",
            sender_name="example COMPANY",
            current="unknown",
        )

        self.assertEqual("local_wholesale", classification)

    def test_ExampleLatin_sender_is_internal_not_processing(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "DIRECT LOCAL": {
                "entity_type": "wholesale_customer",
                "entity_code": "100",
                "standard_name": "DIRECT LOCAL",
            }
        }
        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "DIRECT LOCAL",
            sender_name="ExampleCo",
            current="unknown",
        )

        self.assertEqual("local_wholesale", classification)

    def test_internal_sender_to_maintained_retail_station_is_transfer(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "X-43": {
                "entity_type": "retail_station",
                "entity_code": "24",
                "standard_name": "X-43",
            }
        }
        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "X-43",
            sender_name="Example Petroleum CJSC",
            current="unknown",
        )

        self.assertEqual("transfer", classification)

    def test_retail_station_receiver_requires_internal_sender_for_transfer(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "X-43": {
                "entity_type": "retail_station",
                "entity_code": "24",
                "standard_name": "X-43",
            }
        }
        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "X-43",
            sender_name="Unknown Sender",
            current="transfer",
        )

        self.assertEqual("unknown", classification)

    def test_customer_alias_without_sender_does_not_keep_old_sales_classification(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "DIRECT LOCAL": {
                "entity_type": "wholesale_customer",
                "entity_code": "100",
                "standard_name": "DIRECT LOCAL",
            }
        }
        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "DIRECT LOCAL",
            sender_name=None,
            current="local_wholesale",
        )

        self.assertEqual("unknown", classification)

    def test_unmaintained_external_customer_stays_unknown(self):
        cursor = _FakeWholesaleLookupCursor()
        classification = classify_wholesale_movement(
            cursor,
            {},
            "Unknown External Customer",
            sender_name="Example Petroleum CJSC",
            current="unknown",
        )

        self.assertEqual("unknown", classification)
        self.assertEqual("unknown", auto_classify("Example Petroleum CJSC", "Unknown External Customer"))

    def test_customer_sender_to_customer_receiver_is_processing(self):
        cursor = _FakeWholesaleLookupCursor()
        classification = classify_wholesale_movement(
            cursor,
            {},
            "BONENOOK IMPEX",
            sender_name="DIRECT LOCAL",
            current="unknown",
        )

        self.assertEqual("processing", classification)

    def test_customer_sender_to_internal_receiver_is_procurement(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "Example": {
                "entity_type": "own_depot",
                "entity_code": "ExampleLatin",
                "standard_name": "Example",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "Example",
            sender_name="DIRECT LOCAL",
            current="unknown",
        )

        self.assertEqual("procurement", classification)

    def test_unmaintained_legal_sender_to_internal_receiver_is_procurement(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "Example": {
                "entity_type": "own_depot",
                "entity_code": "ExampleLatin",
                "standard_name": "Example",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "Example",
            sender_name='CJSC "External Customer"',
            current="unknown",
        )

        self.assertEqual("procurement", classification)
        self.assertTrue(is_customer_like_entity_name('CJSC "External Customer"'))

    def test_plain_external_sender_to_internal_receiver_is_procurement(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "Example": {
                "entity_type": "own_depot",
                "entity_code": "ExampleLatin",
                "standard_name": "Example",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "Example",
            sender_name="Example Supplier International Co",
            current="unknown",
        )

        self.assertEqual("procurement", classification)

    def test_latin_oao_sender_to_internal_receiver_is_procurement(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "Example": {
                "entity_type": "own_depot",
                "entity_code": "ExampleLatin",
                "standard_name": "Example",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "Example",
            sender_name='OAO "CUSTOMER-M"',
            current="unknown",
        )

        self.assertEqual("procurement", classification)
        self.assertTrue(is_customer_like_entity_name('OAO "CUSTOMER-M"'))
        self.assertTrue(is_customer_like_entity_name('ЗАО“Кыргыз CUSTOMER-F Company”'))
        self.assertTrue(is_customer_like_entity_name("CJSC''Мираж''"))
        self.assertTrue(is_customer_like_entity_name("НГК ЗАО''CUSTOMER-Q''"))
        self.assertTrue(is_customer_like_entity_name('NORTHWIND ENERGY DEVELOPMENT CO'))
        self.assertTrue(is_customer_like_entity_name('ТОО"CUSTOMER-N CUSTOMER-F Company"'))

    def test_internal_name_matching_tolerates_extra_quotes(self):
        self.assertTrue(is_internal_entity_name("CJSC''CUSTOMER-S нефть и газ"))
        self.assertFalse(is_internal_entity_name('CUSTOMER-S-АББР нг г. CTY-05 "Мираж"'))

    def test_internal_use_entity_classifies_as_other(self):
        cursor = _FakeWholesaleLookupCursor()
        entity_lookup = {
            "生产区": {
                "entity_type": "own_depot",
                "entity_code": "internal_use",
                "standard_name": "内部用油",
            }
        }

        classification = classify_wholesale_movement(
            cursor,
            entity_lookup,
            "生产区",
            sender_name="Example",
            current="unknown",
        )

        self.assertEqual("other", classification)
        self.assertEqual("other", normalize_wholesale_classification("other"))
        self.assertTrue(can_auto_approve_weigh_detail("other", product_id=1))

    def test_internal_sender_to_internal_receiver_classifies_as_other(self):
        cursor = _FakeWholesaleLookupCursor()
        classification = classify_wholesale_movement(
            cursor,
            {},
            "Example石油公司",
            sender_name="Example Petroleum CJSC",
            current="unknown",
        )

        self.assertEqual("other", classification)

    def test_sender_standard_name_uses_builtin_company_aliases(self):
        lookup = load_sender_standard_lookup(_FakeWholesaleLookupCursor())

        self.assertEqual("Example", resolve_sender_standard_name(lookup, "ExampleCo"))
        self.assertEqual("油气公司", resolve_sender_standard_name(lookup, "CUSTOMER-S-АББР"))
        self.assertEqual('OcOO "CUSTOMER-F"', resolve_sender_standard_name(lookup, "CUSTOMER-F"))

    def test_sender_standard_name_uses_maintained_entity_aliases(self):
        lookup = load_sender_standard_lookup(_FakeWholesaleLookupCursor())

        self.assertEqual("标准发货单位", resolve_sender_standard_name(lookup, "Sender Abbr"))

    def test_recalculation_does_not_keep_old_sales_guess_without_customer_type(self):
        self.assertEqual("unknown", provisional_sales_classification("unknown", "export_wholesale"))
        self.assertEqual("unknown", provisional_sales_classification("unknown", "local_wholesale"))
        self.assertEqual("export_wholesale", provisional_sales_classification("export_wholesale", "unknown"))

    def test_contract_recalculation_does_not_infer_sales_without_internal_sender(self):
        cursor = _FakeWholesaleRecalculationCursor(
            [
                (1, date(2026, 8, 1), "DIRECT LOCAL", None, 1, 10, "local_wholesale", "pending"),
            ]
        )

        result = recalculate_wholesale_batch(cursor, 8)

        self.assertEqual({"matched": 0, "unmatched": 1, "missing_rates": 0}, result)
        self.assertEqual("unknown", cursor.detail_updates[1]["classification"])
        self.assertFalse(cursor.contract_query_seen)

    def test_contract_recalculation_preserves_processing_rule(self):
        cursor = _FakeWholesaleRecalculationCursor(
            [
                (1, date(2026, 8, 1), "BONENOOK IMPEX", "DIRECT LOCAL", 1, 10, "unknown", "pending"),
            ]
        )

        result = recalculate_wholesale_batch(cursor, 8)

        self.assertEqual({"matched": 0, "unmatched": 0, "missing_rates": 0}, result)
        self.assertEqual("processing", cursor.detail_updates[1]["classification"])
        self.assertEqual("matched", cursor.detail_updates[1]["match_status"])
        self.assertFalse(cursor.contract_query_seen)

    def test_contract_recalculation_preserves_approved_manual_procurement(self):
        cursor = _FakeWholesaleRecalculationCursor(
            [
                (1, date(2026, 8, 1), "Маткалыков Н.А", None, 1, 10, "procurement", "approved"),
            ]
        )

        result = recalculate_wholesale_batch(cursor, 8)

        self.assertEqual({"matched": 0, "unmatched": 0, "missing_rates": 0}, result)
        self.assertEqual("procurement", cursor.detail_updates[1]["classification"])
        self.assertEqual("matched", cursor.detail_updates[1]["match_status"])
        self.assertFalse(cursor.contract_query_seen)

    def test_smart_product_code_recognizes_added_products(self):
        self.assertEqual("MTBE", smart_product_code("MTBE"))
        self.assertEqual("MMA", smart_product_code("ММА"))
        self.assertEqual("WASTE_OIL", smart_product_code("轻污油"))
        self.assertEqual("METHANOL", smart_product_code("METANOL"))
        self.assertEqual("RESIDUAL_OIL", smart_product_code("渣油"))
        self.assertEqual("NEFRAS_C50_170", smart_product_code("Нефрас С50/170Нефрас С50/170"))
        self.assertEqual("RAIL_RAW_MATERIAL", smart_product_code("外购火车原材料"))
        self.assertEqual("SULFURIC_ACID", smart_product_code("Серная кислота"))
        self.assertEqual("SCRAP_METAL", smart_product_code("ЧЕРНЫЙ МЕТАЛЛ (ЛОМ)"))
        self.assertEqual("STRAIGHT_RUN_GASOLINE", smart_product_code("ПРЯМОГОННАЯ НАФТА"))
        self.assertEqual("LIGHT_GASOLINE", smart_product_code("Бензин легкий по СТО"))
        self.assertEqual("CATALYTIC_GASOLINE", smart_product_code("БЕНЗИН КАТАЛИЧЕСКОГО КРЕКИНГА Б"))
        self.assertEqual("CATALYTIC_GASOLINE", smart_product_code("催化汽油"))
        self.assertEqual("AROMATIC_OIL", smart_product_code("СМЕСИ АРОМАТИЧЕСКИХ УГЛЕВОДОРОДОВ"))
        self.assertEqual("ANTIKNOCK_AGENT", smart_product_code("Антидетонатор на основе кислорода"))


class _FakeWholesaleLookupCursor:
    def __init__(self):
        self._one = None
        self._many = []

    def execute(self, sql, params=()):
        statement = " ".join(sql.upper().split())
        if "SELECT STANDARD_NAME, ALIAS_NAME, NORMALIZED_ALIAS" in statement:
            self._one = None
            self._many = [("标准发货单位", "Sender Abbr", "SENDER ABBR")]
            return

        if "FROM CUSTOMERS" in statement and "WHERE ID = %S" in statement:
            customer_id = params[0]
            rows = {
                50: ("CUSTOMER-H 3", "local_wholesale"),
                388: ("CJSC НПЗ CUSTOMER-H-3", "unknown"),
            }
            self._one = rows.get(customer_id)
            self._many = []
            return

        if "FROM CUSTOMERS" in statement:
            key = params[0]
            rows = {
                "BONENOOK IMPEX": ("BONENOOK IMPEX", "export_wholesale"),
                "DIRECT LOCAL": ("DIRECT LOCAL", "local_wholesale"),
                "CJSC НПЗ CUSTOMER-H-3": ("CJSC НПЗ CUSTOMER-H-3", "unknown"),
                "CUSTOMER-H 3": ("CUSTOMER-H 3", "local_wholesale"),
            }
            self._one = rows.get(key)
            self._many = []
            return

        if "FROM ENTITY_ALIASES" in statement:
            key = params[0]
            rows = {
                "CJSC НПЗ CUSTOMER-H-3": [(388, "CJSC НПЗ CUSTOMER-H-3")],
                "CUSTOMER-H-3": [(50, "CUSTOMER-H 3")],
                "CUSTOMER-H 3": [(50, "CUSTOMER-H 3")],
            }
            self._one = None
            self._many = rows.get(key, [])
            return

        self._one = None
        self._many = []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._many


class _FakeWholesaleRecalculationCursor(_FakeWholesaleLookupCursor):
    def __init__(self, details):
        super().__init__()
        self._details = details
        self.detail_updates = {}
        self.contract_query_seen = False

    def execute(self, sql, params=()):
        statement = " ".join(sql.upper().split())
        if "SELECT ENTITY_TYPE, ENTITY_CODE, STANDARD_NAME, NORMALIZED_ALIAS" in statement:
            self._one = None
            self._many = []
            return
        if "SELECT ID, BUSINESS_DATE, RAW_ENTITY_NAME, SENDER_NAME" in statement:
            self._one = None
            self._many = self._details
            return
        if "FROM CONTRACTS" in statement:
            self.contract_query_seen = True
            self._one = None
            self._many = []
            return
        if "UPDATE WHOLESALE_DETAIL_RECORDS" in statement:
            if "MATCH_STATUS = CASE" in statement:
                if len(params) == 1:
                    detail_id = params[0]
                    classification = self._classification(detail_id)
                else:
                    classification, detail_id = params
                match_status = "unmatched" if self._product_id(detail_id) is None else "matched"
            else:
                classification, detail_id = params[-2], params[-1]
                match_status = "needs_review" if "MATCH_STATUS = 'NEEDS_REVIEW'" in statement else "matched"
            self.detail_updates[int(detail_id)] = {
                "classification": classification,
                "match_status": match_status,
            }
            self._one = None
            self._many = []
            return
        if statement.startswith("DELETE ") or statement.startswith("INSERT "):
            self._one = None
            self._many = []
            return
        super().execute(sql, params)

    def _product_id(self, detail_id):
        for row in self._details:
            if row[0] == detail_id:
                return row[4]
        return None

    def _classification(self, detail_id):
        for row in self._details:
            if row[0] == detail_id:
                return row[6]
        return None


class LookupEntityCatalogFallbackTest(unittest.TestCase):
    """lookup_entity 零售板块 catalog 兜底：新增站点别名未登记也能识别为外运站点。"""

    def _build_lookup(self):
        # 模拟 entity_aliases 中无该站点别名（仅有其他实体）
        return {
            "CJSC CUSTOMER-K": {"entity_type": "wholesale_customer", "entity_code": "2", "standard_name": "CJSC CUSTOMER-K"},
            "S-36": {"entity_type": "retail_station", "entity_code": "18", "standard_name": "S-36"},
        }

    def test_new_station_without_alias_resolves_via_catalog(self):
        import import_helpers
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            31: {"name": "新站北", "short": "Новый Стан"},
        }
        try:
            result = import_helpers.lookup_entity(self._build_lookup(), "Новый Стан")
        finally:
            shared_utils.retail_station_catalog_cached = original
        self.assertEqual(result, {
            "entity_type": "retail_station",
            "entity_code": "31",
            "standard_name": "Новый Стан",
        })

    def test_new_station_with_azs_prefix_and_latin_homoglyph(self):
        import import_helpers
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            5: {"name": "STN-09", "short": "S-10"},
        }
        try:
            result = import_helpers.lookup_entity(self._build_lookup(), "АЗС   S-10")
        finally:
            shared_utils.retail_station_catalog_cached = original
        self.assertEqual(result["entity_type"], "retail_station")
        self.assertEqual(result["entity_code"], "5")

    def test_customer_not_shadowed_by_catalog(self):
        import import_helpers
        import shared_utils

        original = shared_utils.retail_station_catalog_cached
        shared_utils.retail_station_catalog_cached = lambda: {
            5: {"name": "STN-09", "short": "S-10"},
        }
        try:
            result = import_helpers.lookup_entity(self._build_lookup(), "CJSC CUSTOMER-K")
        finally:
            shared_utils.retail_station_catalog_cached = original
        self.assertEqual(result["entity_type"], "wholesale_customer")


if __name__ == "__main__":
    unittest.main()
