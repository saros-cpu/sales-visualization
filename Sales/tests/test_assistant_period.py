import sys
import unittest
from datetime import date
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from routes_assistant import build_assistant_query_plan, parse_assistant_period


class AssistantPeriodTests(unittest.TestCase):
    def test_short_year_first_half_retail_period(self):
        label, start, end = parse_assistant_period("26年上半年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年上半年")
        self.assertEqual(start, date(2026, 1, 1))
        self.assertEqual(end, date(2026, 7, 1))

    def test_short_year_month_period(self):
        label, start, end = parse_assistant_period("26年6月零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年6月")
        self.assertEqual(start, date(2026, 6, 1))
        self.assertEqual(end, date(2026, 7, 1))

    def test_short_year_full_year_period(self):
        label, start, end = parse_assistant_period("26年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年")
        self.assertEqual(start, date(2026, 1, 1))
        self.assertEqual(end, date(2027, 1, 1))

    def test_default_period_stays_recent_seven_days(self):
        label, start, end = parse_assistant_period("零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近7天")
        self.assertEqual(start, date(2026, 7, 15))
        self.assertEqual(end, date(2026, 7, 23))

    def test_recent_days_period(self):
        label, start, end = parse_assistant_period("最近30天零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近30天")
        self.assertEqual(start, date(2026, 6, 22))
        self.assertEqual(end, date(2026, 7, 23))

    def test_past_chinese_weeks_period(self):
        label, start, end = parse_assistant_period("过去三周零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近3周")
        self.assertEqual(start, date(2026, 7, 1))
        self.assertEqual(end, date(2026, 7, 23))

    def test_recent_chinese_months_period(self):
        label, start, end = parse_assistant_period("近两个月零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近2个月")
        self.assertEqual(start, date(2026, 5, 22))
        self.assertEqual(end, date(2026, 7, 23))

    def test_recent_half_year_period(self):
        label, start, end = parse_assistant_period("最近半年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近半年")
        self.assertEqual(start, date(2026, 1, 22))
        self.assertEqual(end, date(2026, 7, 23))

    def test_past_year_period(self):
        label, start, end = parse_assistant_period("过去一年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "最近1年")
        self.assertEqual(start, date(2025, 7, 22))
        self.assertEqual(end, date(2026, 7, 23))

    def test_month_to_date_period(self):
        label, start, end = parse_assistant_period("月初到现在零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "本月以来")
        self.assertEqual(start, date(2026, 7, 1))
        self.assertEqual(end, date(2026, 7, 23))

    def test_previous_month_same_period(self):
        label, start, end = parse_assistant_period("上个月同期零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "上个月同期")
        self.assertEqual(start, date(2026, 6, 1))
        self.assertEqual(end, date(2026, 6, 23))

    def test_spring_festival_after_period(self):
        label, start, end = parse_assistant_period("春节后零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年春节后")
        self.assertEqual(start, date(2026, 2, 17))
        self.assertEqual(end, date(2026, 7, 23))

    def test_may_day_period(self):
        label, start, end = parse_assistant_period("五一期间零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年五一期间")
        self.assertEqual(start, date(2026, 5, 1))
        self.assertEqual(end, date(2026, 5, 6))

    def test_current_year_period(self):
        label, start, end = parse_assistant_period("今年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年")
        self.assertEqual(start, date(2026, 1, 1))
        self.assertEqual(end, date(2026, 7, 23))

    def test_last_year_period(self):
        label, start, end = parse_assistant_period("去年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2025年")
        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2026, 1, 1))

    def test_last_year_month_period(self):
        label, start, end = parse_assistant_period("去年6月零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2025年6月")
        self.assertEqual(start, date(2025, 6, 1))
        self.assertEqual(end, date(2025, 7, 1))

    def test_short_year_quarter_period(self):
        label, start, end = parse_assistant_period("26年二季度零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年第2季度")
        self.assertEqual(start, date(2026, 4, 1))
        self.assertEqual(end, date(2026, 7, 1))

    def test_last_quarter_period(self):
        label, start, end = parse_assistant_period("上季度零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年第2季度")
        self.assertEqual(start, date(2026, 4, 1))
        self.assertEqual(end, date(2026, 7, 1))

    def test_current_quarter_period(self):
        label, start, end = parse_assistant_period("本季度零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2026年第3季度")
        self.assertEqual(start, date(2026, 7, 1))
        self.assertEqual(end, date(2026, 7, 23))

    def test_last_year_half_period(self):
        label, start, end = parse_assistant_period("去年上半年零售数据", today=date(2026, 7, 22))

        self.assertEqual(label, "2025年上半年")
        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2025, 7, 1))


class AssistantQueryPlanTests(unittest.TestCase):
    def test_retail_half_year_summary_plan(self):
        plan = build_assistant_query_plan("26年上半年零售数据怎么样", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_summary")
        self.assertEqual(plan["domain"], "retail")
        self.assertEqual(plan["period"]["start"], "2026-01-01")
        self.assertEqual(plan["period"]["endExclusive"], "2026-07-01")

    def test_station_drop_question_routes_to_station_trend_anomaly(self):
        plan = build_assistant_query_plan("最近哪个站掉得厉害", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "station_trend_anomaly")
        self.assertEqual(plan["metric"], "volume")
        self.assertIn("station", plan["dimensions"])

    def test_recent_days_station_drop_keeps_rolling_period(self):
        plan = build_assistant_query_plan("最近30天哪个站掉得厉害", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "station_trend_anomaly")
        self.assertEqual(plan["metric"], "volume")
        self.assertIn("station", plan["dimensions"])
        self.assertEqual(plan["period"]["label"], "最近30天")
        self.assertEqual(plan["period"]["start"], "2026-06-22")

    def test_past_months_resource_amount_ranking(self):
        plan = build_assistant_query_plan("过去三个月油品营业额排行", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertIn("resource", plan["dimensions"])
        self.assertEqual(plan["metric"], "amount")
        self.assertEqual(plan["period"]["label"], "最近3个月")
        self.assertEqual(plan["period"]["start"], "2026-04-22")

    def test_year_over_year_plan_has_baseline_period(self):
        plan = build_assistant_query_plan("本月零售同比怎么样", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_comparison")
        self.assertEqual(plan["period"]["start"], "2026-07-01")
        self.assertEqual(plan["comparison"]["type"], "year_over_year")
        self.assertEqual(plan["comparison"]["period"]["start"], "2025-07-01")
        self.assertEqual(plan["comparison"]["period"]["endExclusive"], "2025-07-23")

    def test_month_over_month_plan_has_baseline_period(self):
        plan = build_assistant_query_plan("本月零售比上个月同期怎么样", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_comparison")
        self.assertEqual(plan["period"]["start"], "2026-07-01")
        self.assertEqual(plan["comparison"]["type"], "month_over_month")
        self.assertEqual(plan["comparison"]["period"]["start"], "2026-06-01")
        self.assertEqual(plan["comparison"]["period"]["endExclusive"], "2026-06-23")

    def test_compound_question_builds_subplans(self):
        plan = build_assistant_query_plan("26年上半年零售总额、哪个站销售额最高、哪个油品销量下滑", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "compound_query")
        self.assertGreaterEqual(len(plan["subPlans"]), 3)
        self.assertEqual(plan["subPlans"][0]["route"], "retail_summary")
        self.assertEqual(plan["subPlans"][1]["route"], "retail_ranking")
        self.assertIn("station", plan["subPlans"][1]["dimensions"])
        self.assertEqual(plan["subPlans"][1]["metric"], "amount")

    def test_page_context_supplies_current_dimension(self):
        plan = build_assistant_query_plan(
            "这个页面销量最高的是哪个",
            today=date(2026, 7, 22),
            context={"pageContext": {"path": "/retail/resource", "module": "retail", "page": "resource"}},
        )

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertEqual(plan["metric"], "volume")
        self.assertIn("resource", plan["dimensions"])
        self.assertIn("page", plan["contextUsed"])

    def test_station_outage_recovery_routes_to_data_check(self):
        plan = build_assistant_query_plan("24号站昨天停电，今天数据补回来了吗", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "station_data_check")
        self.assertEqual(plan["period"]["start"], "2026-07-21")
        self.assertEqual(plan["entities"]["station"]["shopKey"], 24)

    def test_product_best_seller_routes_to_resource_ranking(self):
        plan = build_assistant_query_plan("6月哪个油品卖得最好，为什么", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertIn("resource", plan["dimensions"])
        self.assertEqual(plan["metric"], "volume")
        self.assertEqual(plan["period"]["start"], "2026-06-01")

    def test_wholesale_customer_ranking_plan(self):
        plan = build_assistant_query_plan("出口批发客户排行", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "wholesale_summary")
        self.assertEqual(plan["domain"], "wholesale")
        self.assertIn("customer", plan["dimensions"])

    def test_accounting_report_status_defaults_to_yesterday(self):
        plan = build_assistant_query_plan("吉方日报缺站了吗", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "accounting_report_status")
        self.assertEqual(plan["period"]["start"], "2026-07-21")
        self.assertEqual(plan["period"]["endExclusive"], "2026-07-22")

    def test_station_followup_reuses_station_and_previous_tool(self):
        previous = build_assistant_query_plan("24号站昨天停电，今天数据补回来了吗", today=date(2026, 7, 22))

        plan = build_assistant_query_plan(
            "那它今天呢",
            today=date(2026, 7, 22),
            context={"lastAssistantPlan": previous},
        )

        self.assertEqual(plan["route"], "station_data_check")
        self.assertEqual(plan["entities"]["station"]["shopKey"], 24)
        self.assertEqual(plan["period"]["start"], "2026-07-22")
        self.assertEqual(plan["period"]["endExclusive"], "2026-07-23")
        self.assertIn("station", plan["contextUsed"])
        self.assertIn("route", plan["contextUsed"])

    def test_ranking_followup_reuses_period_dimension_and_metric(self):
        previous = build_assistant_query_plan("6月哪个油品卖得最好，为什么", today=date(2026, 7, 22))

        plan = build_assistant_query_plan(
            "那为什么",
            today=date(2026, 7, 22),
            context={"lastAssistantPlan": previous},
        )

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertEqual(plan["period"]["start"], "2026-06-01")
        self.assertIn("resource", plan["dimensions"])
        self.assertEqual(plan["metric"], "volume")
        self.assertIn("period", plan["contextUsed"])
        self.assertIn("dimensions", plan["contextUsed"])

    def test_query_plan_exposes_read_only_tool(self):
        plan = build_assistant_query_plan("最近哪个站掉得厉害", today=date(2026, 7, 22))

        self.assertEqual(plan["tool"]["name"], "station_trend_anomaly")
        self.assertTrue(plan["tool"]["readOnly"])

    def test_business_dictionary_maps_amount_synonym(self):
        plan = build_assistant_query_plan("本月营业额最高的站点", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertEqual(plan["metric"], "amount")
        self.assertIn("station", plan["dimensions"])
        self.assertFalse(plan["needsClarification"])
        self.assertIn("营业额", plan["businessTerms"]["metrics"]["amount"])

    def test_business_dictionary_maps_tons_and_region(self):
        plan = build_assistant_query_plan("本月吨数最高的区域", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertEqual(plan["metric"], "tons")
        self.assertIn("region", plan["dimensions"])
        self.assertFalse(plan["needsClarification"])

    def test_vague_business_scope_requires_clarification(self):
        plan = build_assistant_query_plan("上半年数据怎么样", today=date(2026, 7, 22))

        self.assertTrue(plan["needsClarification"])
        self.assertEqual(plan["clarification"]["missing"], ["domain"])
        self.assertLess(plan["confidence"], 0.5)

    def test_ambiguous_ranking_dimension_requires_clarification(self):
        plan = build_assistant_query_plan("本月哪个最高", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertTrue(plan["needsClarification"])
        self.assertEqual(plan["clarification"]["missing"], ["dimension"])

    def test_ambiguous_ranking_metric_requires_clarification(self):
        plan = build_assistant_query_plan("本月哪个站最高", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_ranking")
        self.assertIn("station", plan["dimensions"])
        self.assertTrue(plan["needsClarification"])
        self.assertEqual(plan["clarification"]["missing"], ["metric"])

    def test_explicit_retail_question_does_not_clarify(self):
        plan = build_assistant_query_plan("26年上半年零售数据怎么样", today=date(2026, 7, 22))

        self.assertFalse(plan["needsClarification"])
        self.assertEqual(plan["domain"], "retail")
        self.assertEqual(plan["period"]["start"], "2026-01-01")

    def test_current_year_retail_summary_is_not_kpi(self):
        plan = build_assistant_query_plan("今年零售数据怎么样", today=date(2026, 7, 22))

        self.assertEqual(plan["route"], "retail_summary")
        self.assertEqual(plan["period"]["start"], "2026-01-01")
        self.assertEqual(plan["period"]["endExclusive"], "2026-07-23")


if __name__ == "__main__":
    unittest.main()
