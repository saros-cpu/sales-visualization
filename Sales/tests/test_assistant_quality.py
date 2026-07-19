import json
import sys
import unittest
from datetime import date
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from assistant_quality import (
    build_data_freshness,
    build_knowledge_references,
    build_permission_refusal,
    build_query_spec,
    build_report_guidance,
    enrich_assistant_payload,
    evaluate_response_quality,
    has_required_permission,
    required_permissions,
)
from routes_assistant import build_assistant_query_plan


TODAY = date(2026, 7, 22)
ACCEPTANCE_PATH = Path(__file__).resolve().parent / "fixtures" / "assistant_answer_acceptance.json"


def admin_context():
    return {"user": {"id": 1, "role": "admin"}, "permissionCodes": ["*"]}


class AssistantQualityTests(unittest.TestCase):
    def test_answer_acceptance_fixture_enforces_business_response_contracts(self):
        cases = json.loads(ACCEPTANCE_PATH.read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(case=case["id"]):
                plan = build_assistant_query_plan(case["question"], today=TODAY)
                answer = "；".join(case["answerContains"])
                payload = {
                    "ok": True,
                    "question": case["question"],
                    "answer": answer,
                    "assistantPlan": plan,
                    "tables": [
                        {"title": "验收表", "columns": ["项目", "数值"], "rows": [["合计", 1]]}
                        for _ in range(case.get("minTables", 0))
                    ],
                    "charts": [
                        {"title": "验收图", "type": "bar", "xAxis": ["A"], "series": [{"name": "数值", "type": "bar", "data": [1]}]}
                        for _ in range(case.get("minCharts", 0))
                    ],
                }
                enriched = enrich_assistant_payload(payload, admin_context())

                self.assertIn(enriched["quality"]["status"], {"pass", "warn"})
                self.assertIn("querySpec", enriched)
                self.assertIn("diagnostics", enriched)
                for expected_text in case["answerContains"]:
                    self.assertIn(expected_text, enriched["answer"])
                self.assertGreaterEqual(len(enriched.get("tables") or []), case.get("minTables", 0))
                self.assertGreaterEqual(len(enriched.get("charts") or []), case.get("minCharts", 0))

    def test_permission_guard_blocks_ungranted_routes_before_data_query(self):
        plan = build_assistant_query_plan("用户权限情况", today=TODAY)
        limited_user = {"user": {"id": 2, "role": "viewer"}, "permissionCodes": ["retail:view"]}

        self.assertFalse(has_required_permission(limited_user, plan))
        result = build_permission_refusal("用户权限情况", plan, limited_user)

        self.assertEqual(result["agent"]["status"], "permission_denied")
        self.assertFalse(result["permission"]["allowed"])
        self.assertEqual(result["tables"], [])

    def test_profit_summary_requires_admin_even_with_wildcard_permission(self):
        plan = {"route": "profit_summary"}
        retail_user = {"user": {"id": 7, "role": "viewer"}, "permissionCodes": ["retail:view", "retail:export"]}
        wildcard_user = {"user": {"id": 8, "role": "viewer"}, "permissionCodes": ["*"]}

        self.assertEqual(required_permissions(plan), ("admin",))
        self.assertFalse(has_required_permission(retail_user, plan))
        self.assertFalse(has_required_permission(wildcard_user, plan))
        self.assertTrue(has_required_permission(admin_context(), plan))

    def test_query_spec_is_read_only_and_blocks_write_operations(self):
        plan = build_assistant_query_plan("6月采购按供应商排行", today=TODAY)
        spec = build_query_spec(plan, admin_context())

        self.assertEqual(spec["mode"], "read_only")
        self.assertIn("aggregate", spec["allowedOperations"])
        self.assertIn("update", spec["blockedOperations"])
        self.assertIn("approve", spec["blockedOperations"])
        self.assertIn("procurement:view", spec["requiredPermissions"])

    def test_knowledge_snippets_are_numbered_references(self):
        refs = build_knowledge_references([
            {
                "id": 10,
                "title": "自用油口径",
                "spaceName": "报表口径",
                "categoryName": "零售",
                "moduleKey": "retail",
                "snippet": "自用油按原报表24口径统计。",
                "updatedAt": "2026-07-22",
            }
        ])

        self.assertEqual(refs[0]["id"], "K1")
        self.assertEqual(refs[0]["articleId"], 10)
        self.assertIn("报表口径", refs[0]["source"])

    def test_quality_flags_missing_chart_when_user_requested_visual(self):
        plan = build_assistant_query_plan("今年零售趋势图", today=TODAY)
        payload = {
            "ok": True,
            "question": "今年零售趋势图",
            "answer": "今年零售趋势如下。",
            "assistantPlan": plan,
            "tables": [{"title": "明细", "columns": ["项目"], "rows": [["合计"]]}],
            "charts": [],
        }
        quality = evaluate_response_quality(payload, admin_context())

        self.assertEqual(quality["status"], "warn")
        self.assertTrue(any(item["code"] == "charts" and item["status"] == "warn" for item in quality["checks"]))

    def test_custom_station_scope_blocks_unlisted_station_entity(self):
        allowed_plan = build_assistant_query_plan("24号站今年数据", today=TODAY)
        denied_plan = build_assistant_query_plan("25号站今年数据", today=TODAY)
        scoped_user = {
            "user": {"id": 3, "role": "viewer"},
            "permissionCodes": ["retail:view"],
            "dataScopes": {"retail": "custom"},
            "dataScopeResources": {"retail": {"station": [{"id": "24", "label": "24号站"}]}},
        }

        self.assertTrue(has_required_permission(scoped_user, allowed_plan))
        self.assertFalse(has_required_permission(scoped_user, denied_plan))

    def test_map_location_uses_map_permission_and_depot_scope(self):
        station_plan = build_assistant_query_plan("2号站位置在哪", today=TODAY)
        depot_plan = build_assistant_query_plan("DemoDepotNorth在哪里", today=TODAY)
        retail_only = {"user": {"id": 4, "role": "viewer"}, "permissionCodes": ["retail:view"]}
        scoped_map_user = {
            "user": {"id": 5, "role": "viewer"},
            "permissionCodes": ["map:view"],
            "dataScopes": {"map": "custom"},
            "dataScopeResources": {"map": {"depot": [{"id": "DemoDepotNorth", "label": "DemoDepotNorth"}]}},
        }
        denied_map_user = {
            "user": {"id": 6, "role": "viewer"},
            "permissionCodes": ["map:view"],
            "dataScopes": {"map": "custom"},
            "dataScopeResources": {"map": {"depot": [{"id": "DemoDepotSouth", "label": "DemoDepotSouth"}]}},
        }

        self.assertFalse(has_required_permission(retail_only, station_plan))
        self.assertTrue(has_required_permission(scoped_map_user, depot_plan))
        self.assertFalse(has_required_permission(denied_map_user, depot_plan))

    def test_query_spec_exposes_custom_data_scope(self):
        plan = build_assistant_query_plan("今年零售数据", today=TODAY)
        scoped_user = {
            "user": {"id": 3, "role": "viewer"},
            "permissionCodes": ["retail:view"],
            "dataScopes": {"retail": "custom"},
            "dataScopeResources": {"retail": {"station": [{"id": "24", "label": "24号站"}]}},
        }

        spec = build_query_spec(plan, scoped_user)

        self.assertEqual(spec["dataScope"]["module"], "retail")
        self.assertEqual(spec["dataScope"]["scope"], "custom")
        self.assertEqual(spec["dataScope"]["customResourceCount"], 1)

    def test_freshness_marks_future_period_as_partial(self):
        plan = build_assistant_query_plan("2099年零售数据", today=TODAY)
        freshness = build_data_freshness({"assistantPlan": plan, "data": {"source": "snapshot"}})

        self.assertEqual(freshness["status"], "partial")
        self.assertTrue(freshness["warnings"])
        self.assertIn("source:snapshot", freshness["sources"])

    def test_report_guidance_exposes_original_report_boundary(self):
        plan = build_assistant_query_plan("今年自用油数据", today=TODAY)
        guidance = build_report_guidance(plan)

        self.assertEqual(guidance["reportNo"], "24")
        self.assertIn("report24-only", guidance["principle"])


if __name__ == "__main__":
    unittest.main()
