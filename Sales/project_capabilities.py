from __future__ import annotations

from copy import deepcopy
from datetime import date
from typing import Any


PROJECT_ASSISTANT_CAPABILITIES: list[dict[str, Any]] = [
    {
        "id": "dashboard_visual_cockpit",
        "module": "数据驾驶舱 / 可视化驾驶舱",
        "question": "首页驾驶舱核心指标有哪些",
        "expected": {"route": "dashboard_summary", "domain": "dashboard"},
    },
    {
        "id": "map_facility_locations",
        "module": "地图",
        "question": "地图上有哪些油库和加油站",
        "expected": {"route": "map_location", "domain": "map"},
    },
    {
        "id": "map_active_station_count",
        "module": "地图 / 站点油库主数据",
        "question": "现在有多少个在营站？多少个油库",
        "expected": {"route": "map_location", "domain": "map", "metric": "count", "dimensions": ["station"]},
    },
    {
        "id": "map_station_location",
        "module": "地图 / 站点油库主数据",
        "question": "2号站位置在哪",
        "expected": {"route": "map_location", "domain": "map", "dimensions": ["station"], "station": 2},
    },
    {
        "id": "retail_overview",
        "module": "零售分析 / 总览",
        "question": "今年零售总销量和销售额",
        "expected": {"route": "retail_summary", "domain": "retail", "periodStart": "2026-01-01"},
    },
    {
        "id": "retail_region",
        "module": "零售分析 / 区域",
        "question": "6月零售各区域销量排行",
        "expected": {
            "route": "retail_ranking",
            "domain": "retail",
            "metric": "volume",
            "dimensions": ["region"],
            "periodStart": "2026-06-01",
        },
    },
    {
        "id": "retail_station",
        "module": "零售分析 / 站点",
        "question": "本月各加油站销量排行",
        "expected": {
            "route": "retail_ranking",
            "domain": "retail",
            "metric": "volume",
            "dimensions": ["station"],
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "retail_monthly",
        "module": "零售分析 / 月度",
        "question": "零售月度页面6月销量",
        "expected": {
            "route": "retail_summary",
            "domain": "retail",
            "metric": "volume",
            "dimensions": ["month"],
            "periodStart": "2026-06-01",
        },
    },
    {
        "id": "retail_trend_chart",
        "module": "零售分析 / 趋势图",
        "question": "月趋势",
        "context": {"pageContext": {"path": "/", "module": "", "page": "home", "title": "数据驾驶舱"}},
        "expected": {
            "route": "retail_trend",
            "domain": "retail",
            "metric": "volume",
            "visualRequested": True,
            "visualType": "line",
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "retail_resource",
        "module": "零售分析 / 油品",
        "question": "今年柴油零售数据",
        "expected": {
            "route": "retail_summary",
            "domain": "retail",
            "dimensions": ["resource"],
            "resource": 106,
            "periodStart": "2026-01-01",
        },
    },
    {
        "id": "retail_density",
        "module": "零售分析 / 实际密度",
        "question": "当前密度数据",
        "expected": {"route": "density_summary", "domain": "density"},
    },
    {
        "id": "retail_report",
        "module": "零售分析 / 报表",
        "question": "零售日报可以导出哪些文件",
        "expected": {"route": "report_center_summary", "domain": "reports"},
    },
    {
        "id": "retail_alert",
        "module": "零售分析 / 预警",
        "question": "零售预警有哪些站点异常",
        "expected": {
            "route": "retail_alert_summary",
            "domain": "retail_alert",
            "dimensions": ["station", "status"],
        },
    },
    {
        "id": "retail_self_use",
        "module": "零售分析 / 自用油",
        "question": "今年自用油数据",
        "expected": {"route": "self_use_summary", "domain": "self_use", "periodStart": "2026-01-01"},
    },
    {
        "id": "retail_self_use_trend",
        "module": "零售分析 / 自用油趋势",
        "question": "今年自用油按天趋势图",
        "expected": {
            "route": "self_use_summary",
            "domain": "self_use",
            "dimensions": ["date"],
            "visualRequested": True,
            "visualType": "line",
            "periodStart": "2026-01-01",
        },
    },
    {
        "id": "wholesale_overview",
        "module": "批发分析 / 总览",
        "question": "本月批发数据怎么样",
        "expected": {"route": "wholesale_summary", "domain": "wholesale", "periodStart": "2026-07-01"},
    },
    {
        "id": "wholesale_products",
        "module": "批发分析 / 油品",
        "question": "批发油品销量排行",
        "expected": {"route": "wholesale_summary", "domain": "wholesale", "metric": "volume", "dimensions": ["resource"]},
    },
    {
        "id": "wholesale_customers",
        "module": "批发分析 / 客户",
        "question": "出口批发客户排行",
        "expected": {"route": "wholesale_summary", "domain": "wholesale", "dimensions": ["customer"]},
    },
    {
        "id": "wholesale_transfer",
        "module": "批发分析 / 调拨",
        "question": "批发外运去向排行",
        "expected": {"route": "wholesale_summary", "domain": "wholesale"},
    },
    {
        "id": "wholesale_trend",
        "module": "批发分析 / 趋势",
        "question": "本月批发趋势图",
        "expected": {
            "route": "wholesale_summary",
            "domain": "wholesale",
            "visualRequested": True,
            "visualType": "line",
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "procurement",
        "module": "采购",
        "question": "本月采购供应商排行",
        "expected": {
            "route": "procurement_summary",
            "domain": "procurement",
            "metric": "tons",
            "dimensions": ["supplier"],
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "exchange",
        "module": "汇率",
        "question": "本月汇率走势图",
        "expected": {
            "route": "exchange_summary",
            "domain": "exchange",
            "visualRequested": True,
            "visualType": "line",
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "market",
        "module": "市场观察",
        "question": "俄罗斯成品油行情",
        "expected": {"route": "market_summary", "domain": "market"},
    },
    {
        "id": "reports_center",
        "module": "报表中心",
        "question": "报表中心有哪些报表",
        "expected": {"route": "report_center_summary", "domain": "reports"},
    },
    {
        "id": "accounting_handover",
        "module": "报表中心 / 吉方财务交接日报",
        "question": "吉方财务交接日报昨天缺站了吗",
        "expected": {"route": "accounting_report_status", "domain": "accounting"},
    },
    {
        "id": "train_entry",
        "module": "火车入库录入",
        "question": "火车入库录入本月多少吨",
        "expected": {"route": "train_entry_summary", "domain": "train_entry", "metric": "tons", "periodStart": "2026-07-01"},
    },
    {
        "id": "contracts",
        "module": "合同",
        "question": "合同有效和到期情况",
        "expected": {"route": "contract_summary", "domain": "contract"},
    },
    {
        "id": "materials",
        "module": "物资",
        "question": "物资库存情况",
        "expected": {"route": "materials_summary", "domain": "materials", "dimensions": ["material"]},
    },
    {
        "id": "material_transfer",
        "module": "物资调拨",
        "question": "物资调拨单待审批有多少",
        "expected": {
            "route": "material_transfer_summary",
            "domain": "materials",
            "metric": "count",
            "dimensions": ["status", "material"],
        },
    },
    {
        "id": "transfer_loss",
        "module": "调拨损耗",
        "question": "今年调拨损耗率",
        "expected": {
            "route": "transfer_loss_summary",
            "domain": "transfer_loss",
            "metric": "loss_rate",
            "periodStart": "2026-01-01",
        },
    },
    {
        "id": "knowledge",
        "module": "知识库",
        "question": "知识库里有没有自用油口径说明",
        "expected": {"route": "knowledge_summary", "domain": "knowledge"},
    },
    {
        "id": "users",
        "module": "用户管理",
        "question": "用户账号和权限情况",
        "expected": {"route": "user_permission_summary", "domain": "users"},
    },
    {
        "id": "organization",
        "module": "组织角色权限",
        "question": "组织角色权限数量",
        "expected": {"route": "user_permission_summary", "domain": "users"},
    },
    {
        "id": "aliases",
        "module": "别名维护",
        "question": "客户和油品别名匹配数据",
        "expected": {"route": "alias_summary", "domain": "alias"},
    },
    {
        "id": "weighing",
        "module": "称重",
        "question": "本月地磅称重待审核有多少",
        "expected": {
            "route": "weighing_summary",
            "domain": "weighing",
            "metric": "count",
            "dimensions": ["status"],
            "periodStart": "2026-07-01",
        },
    },
    {
        "id": "system_health",
        "module": "系统健康",
        "question": "系统健康和自动任务状态",
        "expected": {"route": "system_health_summary", "domain": "system_health"},
    },
    {
        "id": "audit_logs",
        "module": "审计日志",
        "question": "最近审计日志有什么操作",
        "expected": {"route": "audit_log_summary", "domain": "audit"},
    },
    {
        "id": "management_center",
        "module": "管理中心",
        "question": "管理中心驾驶舱组件配置情况",
        "expected": {"route": "settings_summary", "domain": "management"},
    },
    {
        "id": "settings",
        "module": "设置",
        "question": "客户端更新源和版本是多少",
        "expected": {"route": "settings_summary", "domain": "settings"},
    },
    {
        "id": "ai_status",
        "module": "AI助手",
        "question": "AI助手最近调用失败情况",
        "expected": {"route": "system_health_summary", "domain": "system_health"},
    },
    {
        "id": "release_rollback",
        "module": "发布 / 回滚 / 清理",
        "question": "客户端发布包和回滚策略是什么",
        "expected": {"route": "settings_summary", "domain": "settings"},
    },
]


def project_assistant_capabilities() -> list[dict[str, Any]]:
    return deepcopy(PROJECT_ASSISTANT_CAPABILITIES)


def project_assistant_coverage_baseline_date() -> date:
    return date(2026, 7, 22)
