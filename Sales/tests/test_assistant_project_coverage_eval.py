import json
import sys
import unittest
from datetime import date
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from routes_assistant import build_assistant_query_plan


TODAY = date(2026, 7, 22)
COVERAGE_PATH = Path(__file__).resolve().parent / "fixtures" / "assistant_project_coverage_eval.json"


class AssistantProjectCoverageEvalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(COVERAGE_PATH.read_text(encoding="utf-8"))

    def test_every_client_module_has_an_explicit_assistant_route(self):
        for case in self.cases:
            expected = case["expected"]
            with self.subTest(case=case["id"], module=case["module"], question=case["question"]):
                plan = build_assistant_query_plan(case["question"], today=TODAY, context=case.get("context"))

                self.assertEqual(plan.get("route"), expected["route"])
                self.assertEqual(plan.get("domain"), expected["domain"])
                self.assertFalse(plan.get("needsClarification"), "project module coverage questions should be directly answerable")
                self.assertTrue(((plan.get("tool") or {}).get("readOnly")), "assistant tools must stay read-only")

                if expected["route"] != "retail_summary":
                    self.assertFalse(
                        plan.get("route") == "retail_summary" and (plan.get("period") or {}).get("label") == "最近7天",
                        "project module question fell back to default retail recent-7-days summary",
                    )

                if "metric" in expected:
                    self.assertEqual(plan.get("metric"), expected["metric"])
                for dimension in expected.get("dimensions", []):
                    self.assertIn(dimension, plan.get("dimensions") or [])
                if "resource" in expected:
                    resource = (plan.get("entities") or {}).get("resource") or {}
                    self.assertEqual(resource.get("resourceKey"), expected["resource"])
                if "periodStart" in expected:
                    self.assertEqual((plan.get("period") or {}).get("start"), expected["periodStart"])
                if expected.get("visualRequested"):
                    visual = plan.get("visual") or {}
                    self.assertTrue(visual.get("requested"))
                    if "visualType" in expected:
                        self.assertEqual(visual.get("preferredType"), expected["visualType"])


if __name__ == "__main__":
    unittest.main()
