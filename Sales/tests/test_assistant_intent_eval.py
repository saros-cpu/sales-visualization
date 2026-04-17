import sys
import unittest
from datetime import date
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from routes_assistant import build_assistant_query_plan


TODAY = date(2026, 7, 22)


INTENT_EVAL_CASES = [
    {
        "question": "26年上半年零售数据怎么样",
        "route": "retail_summary",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "6月哪个油品卖得最好",
        "route": "retail_ranking",
        "domain": "retail",
        "metric": "volume",
        "dimension": "resource",
        "periodStart": "2026-06-01",
        "needsClarification": False,
    },
    {
        "question": "最近哪个站掉得厉害",
        "route": "station_trend_anomaly",
        "dimension": "station",
        "needsClarification": False,
    },
    {
        "question": "24号站昨天停电，今天数据补回来了吗",
        "route": "station_data_check",
        "station": 24,
        "periodStart": "2026-07-21",
        "needsClarification": False,
    },
    {
        "question": "吉方日报缺站了吗",
        "route": "accounting_report_status",
        "domain": "accounting",
        "periodStart": "2026-07-21",
        "needsClarification": False,
    },
    {
        "question": "出口批发客户排行",
        "route": "wholesale_summary",
        "domain": "wholesale",
        "dimension": "customer",
        "needsClarification": False,
    },
    {
        "question": "上半年数据怎么样",
        "route": "retail_summary",
        "needsClarification": True,
        "missing": "domain",
    },
    {
        "question": "本月哪个最高",
        "route": "retail_ranking",
        "needsClarification": True,
        "missing": "dimension",
    },
    {
        "question": "本月哪个站最高",
        "route": "retail_ranking",
        "dimension": "station",
        "needsClarification": True,
        "missing": "metric",
    },
    {
        "question": "本月营业额最高的站点",
        "route": "retail_ranking",
        "metric": "amount",
        "dimension": "station",
        "needsClarification": False,
    },
    {
        "question": "今年加油站销量排行",
        "route": "retail_ranking",
        "domain": "retail",
        "metric": "volume",
        "dimension": "station",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "2号站位置在哪",
        "route": "map_location",
        "domain": "map",
        "dimension": "station",
        "station": 2,
        "needsClarification": False,
    },
    {
        "question": "油库位置在哪",
        "route": "map_location",
        "domain": "map",
        "dimension": "depot",
        "needsClarification": False,
    },
    {
        "question": "现在有多少个在营站？多少个油库",
        "route": "map_location",
        "domain": "map",
        "metric": "count",
        "dimension": "station",
        "needsClarification": False,
    },
    {
        "question": "今年零售数据怎么样",
        "route": "retail_summary",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "今年自用油数据",
        "route": "self_use_summary",
        "domain": "self_use",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "去年自用油数据",
        "route": "self_use_summary",
        "domain": "self_use",
        "periodStart": "2025-01-01",
        "needsClarification": False,
    },
    {
        "question": "前年自用油数据",
        "route": "self_use_summary",
        "domain": "self_use",
        "periodStart": "2024-01-01",
        "needsClarification": False,
    },
    {
        "question": "今年库存数据",
        "route": "retail_inventory",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "今年价格数据",
        "route": "retail_price",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "今年KPI数据",
        "route": "retail_kpi",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "今年油品结构数据",
        "route": "retail_resource_share",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "本月汇率数据",
        "route": "exchange_summary",
        "domain": "exchange",
        "periodStart": "2026-07-01",
        "needsClarification": False,
    },
    {
        "question": "合同数据",
        "route": "contract_summary",
        "domain": "contract",
        "needsClarification": False,
    },
    {
        "question": "市场观察数据",
        "route": "market_summary",
        "domain": "market",
        "needsClarification": False,
    },
    {
        "question": "当前密度数据",
        "route": "density_summary",
        "domain": "density",
        "needsClarification": False,
    },
    {
        "question": "去年6月零售数据怎么样",
        "route": "retail_summary",
        "domain": "retail",
        "periodStart": "2025-06-01",
        "needsClarification": False,
    },
    {
        "question": "26年二季度零售营业额最高的油品",
        "route": "retail_ranking",
        "domain": "retail",
        "metric": "amount",
        "dimension": "resource",
        "periodStart": "2026-04-01",
        "needsClarification": False,
    },
    {
        "question": "最近30天哪个站掉得厉害",
        "route": "station_trend_anomaly",
        "metric": "volume",
        "dimension": "station",
        "periodStart": "2026-06-22",
        "needsClarification": False,
    },
    {
        "question": "过去三个月油品营业额排行",
        "route": "retail_ranking",
        "domain": "retail",
        "metric": "amount",
        "dimension": "resource",
        "periodStart": "2026-04-22",
        "needsClarification": False,
    },
    {
        "question": "本月零售同比怎么样",
        "route": "retail_comparison",
        "domain": "retail",
        "periodStart": "2026-07-01",
        "comparisonType": "year_over_year",
        "needsClarification": False,
    },
    {
        "question": "今年和去年零售对比图",
        "route": "retail_comparison",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "comparisonType": "year_over_year",
        "visualType": "auto",
        "needsClarification": False,
    },
    {
        "question": "今年零售趋势图",
        "route": "retail_trend",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "visualType": "line",
        "needsClarification": False,
    },
    {
        "question": "今年油品结构饼图",
        "route": "retail_resource_share",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "visualType": "pie",
        "needsClarification": False,
    },
    {
        "question": "今年自用油按天趋势图",
        "route": "self_use_summary",
        "domain": "self_use",
        "dimension": "date",
        "periodStart": "2026-01-01",
        "visualType": "line",
        "needsClarification": False,
    },
    {
        "question": "今年92号零售数据",
        "route": "retail_summary",
        "domain": "retail",
        "dimension": "resource",
        "resource": 103,
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
    {
        "question": "春节后零售数据怎么样",
        "route": "retail_summary",
        "domain": "retail",
        "periodStart": "2026-02-17",
        "needsClarification": False,
    },
    {
        "question": "26年上半年零售总额、哪个站销售额最高、哪个油品销量下滑",
        "route": "compound_query",
        "domain": "retail",
        "periodStart": "2026-01-01",
        "needsClarification": False,
    },
]


class AssistantIntentEvalTests(unittest.TestCase):
    def test_intent_eval_cases(self):
        for case in INTENT_EVAL_CASES:
            with self.subTest(case["question"]):
                plan = build_assistant_query_plan(case["question"], today=TODAY)

                self.assertEqual(plan["route"], case["route"])
                if "domain" in case:
                    self.assertEqual(plan["domain"], case["domain"])
                if "metric" in case:
                    self.assertEqual(plan["metric"], case["metric"])
                if "dimension" in case:
                    self.assertIn(case["dimension"], plan["dimensions"])
                if "station" in case:
                    self.assertEqual(plan["entities"]["station"]["shopKey"], case["station"])
                if "resource" in case:
                    self.assertEqual(plan["entities"]["resource"]["resourceKey"], case["resource"])
                if "periodStart" in case:
                    self.assertEqual(plan["period"]["start"], case["periodStart"])
                if "comparisonType" in case:
                    self.assertEqual(plan["comparison"]["type"], case["comparisonType"])
                if "visualType" in case:
                    self.assertTrue(plan["visual"]["requested"])
                    self.assertEqual(plan["visual"]["preferredType"], case["visualType"])
                self.assertEqual(plan["needsClarification"], case["needsClarification"])
                if "missing" in case:
                    self.assertIn(case["missing"], plan["clarification"]["missing"])
                self.assertIn("selfCheck", plan)
                self.assertIn(plan["selfCheck"]["status"], {"pass", "warn", "fail"})

    def test_domain_clarification_answer_reuses_previous_period(self):
        previous = build_assistant_query_plan("上半年数据怎么样", today=TODAY)

        plan = build_assistant_query_plan("零售", today=TODAY, context={"lastAssistantPlan": previous})

        self.assertFalse(plan["needsClarification"])
        self.assertEqual(plan["domain"], "retail")
        self.assertEqual(plan["route"], "retail_summary")
        self.assertEqual(plan["period"]["start"], "2026-01-01")
        self.assertIn("clarification", plan["contextUsed"])
        self.assertIn("domain", plan["clarificationResolved"]["resolved"])

    def test_metric_clarification_answer_reuses_previous_ranking(self):
        previous = build_assistant_query_plan("本月哪个站最高", today=TODAY)

        plan = build_assistant_query_plan("销售额", today=TODAY, context={"lastAssistantPlan": previous})

        self.assertFalse(plan["needsClarification"])
        self.assertEqual(plan["route"], "retail_ranking")
        self.assertIn("station", plan["dimensions"])
        self.assertEqual(plan["metric"], "amount")
        self.assertEqual(plan["period"]["start"], "2026-07-01")
        self.assertIn("metric", plan["clarificationResolved"]["resolved"])

    def test_dimension_then_metric_clarification_chain(self):
        previous = build_assistant_query_plan("本月哪个最高", today=TODAY)

        dimension_plan = build_assistant_query_plan("油品", today=TODAY, context={"lastAssistantPlan": previous})

        self.assertTrue(dimension_plan["needsClarification"])
        self.assertEqual(dimension_plan["clarification"]["missing"], ["metric"])
        self.assertIn("resource", dimension_plan["dimensions"])
        self.assertEqual(dimension_plan["period"]["start"], "2026-07-01")

        metric_plan = build_assistant_query_plan("销量", today=TODAY, context={"lastAssistantPlan": dimension_plan})

        self.assertFalse(metric_plan["needsClarification"])
        self.assertEqual(metric_plan["route"], "retail_ranking")
        self.assertIn("resource", metric_plan["dimensions"])
        self.assertEqual(metric_plan["metric"], "volume")
        self.assertEqual(metric_plan["period"]["start"], "2026-07-01")
        self.assertIn("metric", metric_plan["clarificationResolved"]["resolved"])

    def test_self_check_blocks_unparsed_explicit_period(self):
        plan = build_assistant_query_plan("春节前零售数据怎么样", today=TODAY)

        self.assertTrue(plan["needsClarification"])
        self.assertEqual(plan["selfCheck"]["status"], "fail")
        self.assertEqual(plan["selfCheck"]["nextAction"], "clarify")
        self.assertIn("period", plan["clarification"]["missing"])

    def test_self_check_marks_default_period_assumption(self):
        plan = build_assistant_query_plan("零售数据怎么样", today=TODAY)

        self.assertFalse(plan["needsClarification"])
        self.assertEqual(plan["period"]["label"], "最近7天")
        self.assertEqual(plan["selfCheck"]["status"], "warn")
        self.assertIn("未明确时间时默认查询最近7天", plan["assumptions"])

    def test_self_check_passes_comparison_baseline(self):
        plan = build_assistant_query_plan("本月零售同比怎么样", today=TODAY)

        self.assertFalse(plan["needsClarification"])
        self.assertEqual(plan["selfCheck"]["status"], "pass")
        codes = {item["code"]: item["status"] for item in plan["selfCheck"]["checks"]}
        self.assertEqual(codes["comparison_baseline"], "pass")

    def test_self_check_records_page_context_dimension(self):
        plan = build_assistant_query_plan(
            "这个页面销量最高的是哪个",
            today=TODAY,
            context={"pageContext": {"path": "/retail/resource", "module": "retail", "page": "resource"}},
        )

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertIn("resource", plan["dimensions"])
        self.assertIn("page", plan["contextUsed"])
        codes = {item["code"]: item["status"] for item in plan["selfCheck"]["checks"]}
        self.assertEqual(codes["ranking_dimension"], "pass")

    def test_compound_plan_self_check_covers_subplans(self):
        plan = build_assistant_query_plan("26年上半年零售总额、哪个站销售额最高、哪个油品销量下滑", today=TODAY)

        self.assertEqual(plan["route"], "compound_query")
        self.assertGreaterEqual(len(plan["subPlans"]), 2)
        self.assertIn("selfCheck", plan)
        self.assertTrue(all("selfCheck" in item for item in plan["subPlans"]))
        codes = {item["code"]: item["status"] for item in plan["selfCheck"]["checks"]}
        self.assertEqual(codes["compound_decomposition"], "pass")


if __name__ == "__main__":
    unittest.main()
