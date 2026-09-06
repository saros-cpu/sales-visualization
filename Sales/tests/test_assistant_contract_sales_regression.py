"""回归测试：零售“合同销量/合同金额”类问题不再落入批发合同台账分支。

背景：ai_agent_call_logs 显示 2026-09-02 用户对“8月份合同销量/零售合同销量”
标注 scope_error——当时执行器把含“合同”子串的问题全部交给了批发合同台账
（返回“合同信息：共 N 条…近期合同…”），而不是零售月报里的合同销量列。
"""
import sys
import unittest
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from routes_assistant import _assistant_is_retail_contract_sales_only


def _db_available():
    try:
        import pymysql
        from config import DB_CONFIG

        cfg = dict(DB_CONFIG)
        cfg["autocommit"] = True
        cfg["connect_timeout"] = 3
        conn = pymysql.connect(**cfg)
        conn.close()
        return True
    except Exception:
        return False


DB_AVAILABLE = _db_available()


class RetailContractSalesPredicateTests(unittest.TestCase):
    def test_retail_contract_sales_phrases_require_lingshou(self):
        # 规则：只有带“零售”的合同问法才取零售板块合同数据
        for question in (
            "8月份零售合同销量",
            "本月零售合同销量多少",
            "零售合同金额多少",
            "零售合同执行情况",
        ):
            with self.subTest(question=question):
                self.assertTrue(_assistant_is_retail_contract_sales_only(question))

    def test_bare_contract_phrases_are_not_retail_contract_sales(self):
        # 不带“零售”的合同问法 → 批发板块
        for question in (
            "8月份合同销量",
            "今年合同销售金额多少",
            "合同金额多少",
            "快到期合同有哪些",
            "合同台账有多少条",
            "有效合同有哪些",
            "8月份批发合同金额多少",
            "8月出口合同销量多少",
            "库存8月份合同销量如何",
            "新增一个合同",
            "合同销量占比多少",
        ):
            with self.subTest(question=question):
                self.assertFalse(_assistant_is_retail_contract_sales_only(question))


@unittest.skipUnless(DB_AVAILABLE, "MySQL 不可用，跳过端到端执行回归")
class RetailContractSalesExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from flask import Flask

        from routes_assistant import execute_assistant_query_payload, register_assistant_routes

        app = Flask(__name__)
        register_assistant_routes(app)
        cls.execute = staticmethod(execute_assistant_query_payload)

    def test_retail_contract_volume_returns_retail_contract_table(self):
        result, status = self.execute({"question": "8月份零售合同销量", "language": "zh"})
        answer = str(result.get("answer") or "")
        self.assertEqual(status, 200)
        self.assertIn("零售合同销量如下", answer)
        self.assertNotIn("合同信息：共", answer)
        self.assertNotIn("近期合同：", answer)
        self.assertTrue((result.get("tables") or []), "应返回结构化表格")

    def test_bare_contract_volume_goes_to_wholesale_register(self):
        # 不带“零售”→ 批发板块：返回批发合同台账，而非零售合同销量
        result, status = self.execute({"question": "8月份合同销量", "language": "zh"})
        answer = str(result.get("answer") or "")
        self.assertEqual(status, 200)
        self.assertIn("合同信息：共", answer)
        self.assertNotIn("零售合同销量如下", answer)

    def test_explicit_single_day_is_not_expanded_to_seven_days(self):
        result, status = self.execute({"question": "2026-08-09零售销量", "language": "zh"})
        answer = str(result.get("answer") or "")
        self.assertEqual(status, 200)
        self.assertIn("2026-08-09 至 2026-08-09", answer)
        self.assertNotIn("最近 7 天", answer)

    def test_latest_density_is_single_day_not_seven_day_mean(self):
        from datetime import date

        today = date.today()
        if today.day <= 1:
            self.skipTest("月初无前一天快照可校验")
        result, status = self.execute({"question": "最新密度", "language": "zh"})
        self.assertEqual(status, 200)
        answer = str(result.get("answer") or "")
        self.assertTrue("平均密度" in answer, answer)
        self.assertNotIn(" 至 ", str(result.get("periodLabel") or ""), "最新密度应为单日口径")


if __name__ == "__main__":
    unittest.main()
