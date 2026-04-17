import json
import sys
import unittest
from datetime import date
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from assistant_agent import is_action_request
from routes_assistant import build_assistant_query_plan


TODAY = date(2026, 7, 22)
EVAL_PATH = Path(__file__).resolve().parent / "fixtures" / "assistant_business_eval.json"


def _load_cases():
    return json.loads(EVAL_PATH.read_text(encoding="utf-8"))


class AssistantBusinessEvalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = _load_cases()

    def test_client_business_questions_route_to_expected_tools(self):
        for case in self.cases:
            expected = case["expected"]
            if expected.get("actionRequest"):
                continue

            question = case["question"]
            with self.subTest(case=case["id"], question=question):
                self.assertFalse(is_action_request(question), "business query should stay read-only and answerable")

                plan = build_assistant_query_plan(question, today=TODAY, context=case.get("context"))

                for key in ("route", "domain", "intent", "metric"):
                    if key in expected:
                        self.assertEqual(plan.get(key), expected[key])

                for dimension in expected.get("dimensions", []):
                    self.assertIn(dimension, plan.get("dimensions") or [])

                if "resource" in expected:
                    resource = (plan.get("entities") or {}).get("resource") or {}
                    self.assertEqual(resource.get("resourceKey"), expected["resource"])

                if "station" in expected:
                    station = (plan.get("entities") or {}).get("station") or {}
                    self.assertEqual(station.get("shopKey"), expected["station"])

                if "depot" in expected:
                    depot = (plan.get("entities") or {}).get("depot") or {}
                    self.assertEqual(depot.get("name"), expected["depot"])

                period = plan.get("period") or {}
                if "periodStart" in expected:
                    self.assertEqual(period.get("start"), expected["periodStart"])
                if "periodEnd" in expected:
                    self.assertEqual(period.get("endExclusive"), expected["periodEnd"])

                if "comparisonType" in expected:
                    comparison = plan.get("comparison") or {}
                    self.assertEqual(comparison.get("type"), expected["comparisonType"])

                if expected.get("visualRequested"):
                    visual = plan.get("visual") or {}
                    self.assertTrue(visual.get("requested"))
                    if "visualType" in expected:
                        self.assertEqual(visual.get("preferredType"), expected["visualType"])

                for marker in expected.get("contextUsed", []):
                    self.assertIn(marker, plan.get("contextUsed") or [])

                self.assertEqual(plan.get("needsClarification"), expected.get("needsClarification", False))
                if expected.get("missing"):
                    clarification = plan.get("clarification") or {}
                    for missing in expected["missing"]:
                        self.assertIn(missing, clarification.get("missing") or [])

                self.assertIn("selfCheck", plan)
                self.assertIn((plan.get("selfCheck") or {}).get("status"), {"pass", "warn", "fail"})
                self.assertTrue(((plan.get("tool") or {}).get("readOnly")), "assistant tools must stay read-only")

    def test_mutating_business_requests_are_detected_before_planning(self):
        for case in self.cases:
            expected = case["expected"]
            if not expected.get("actionRequest"):
                continue

            with self.subTest(case=case["id"], question=case["question"]):
                self.assertTrue(is_action_request(case["question"]))

    def test_short_chart_followup_reuses_previous_self_use_domain_and_period(self):
        previous = build_assistant_query_plan("今年自用油数据", today=TODAY)

        plan = build_assistant_query_plan("做趋势图", today=TODAY, context={"lastAssistantPlan": previous})

        self.assertEqual(plan["route"], "self_use_summary")
        self.assertEqual(plan["domain"], "self_use")
        self.assertEqual(plan["period"]["start"], "2026-01-01")
        self.assertIn("date", plan["dimensions"])
        self.assertTrue(plan["visual"]["requested"])
        self.assertIn("domain", plan["contextUsed"])

    def test_recent_messages_can_provide_previous_plan_context(self):
        previous = build_assistant_query_plan("6月采购按供应商排行", today=TODAY)

        plan = build_assistant_query_plan(
            "做柱状图",
            today=TODAY,
            context={"recentMessages": [{"role": "assistant", "content": "ok", "assistantPlan": previous}]},
        )

        self.assertEqual(plan["route"], "procurement_summary")
        self.assertEqual(plan["domain"], "procurement")
        self.assertEqual(plan["period"]["start"], "2026-06-01")
        self.assertIn("supplier", plan["dimensions"])
        self.assertEqual(plan["visual"]["preferredType"], "bar")

    def test_page_filter_station_context_is_used_for_current_station_question(self):
        plan = build_assistant_query_plan(
            "这个站今年数据",
            today=TODAY,
            context={"pageContext": {"path": "/retail/station", "searchParams": {"shopKey": "24"}}},
        )

        self.assertEqual(plan["route"], "retail_summary")
        self.assertEqual(plan["domain"], "retail")
        self.assertIn("station", plan["dimensions"])
        self.assertEqual(plan["entities"]["station"]["shopKey"], 24)
        self.assertIn("pageStation", plan["contextUsed"])

    def test_relative_previous_previous_year_uses_question_date(self):
        plan = build_assistant_query_plan("前年零售数据", today=date(2027, 7, 23))

        self.assertEqual(plan["period"]["label"], "2025年")
        self.assertEqual(plan["period"]["start"], "2025-01-01")
        self.assertEqual(plan["period"]["endExclusive"], "2026-01-01")


if __name__ == "__main__":
    unittest.main()
