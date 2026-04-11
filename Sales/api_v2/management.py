from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from retail_internal import get_oilstation_json
from services.retail_alert_service import latest_retail_alert_insights
from shared_utils import OILSTATION_ROOT
from wholesale_service import summarize_wholesale_page
from .assistant import ensure_ai_call_schema
from .audit_logs import ensure_audit_schema
from .permission_service import ensure_permission_schema, has_permission, list_user_departments, list_user_roles
from .system import _cache_items


KPI_CATALOG: list[dict[str, Any]] = [
    {"key": "retail_sales_amount", "titleZh": "零售年销售额", "titleRu": "Годовая выручка розницы", "unit": "сом", "precision": 0, "group": "retail", "periodScope": "year", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_volume_liters", "titleZh": "零售年销量", "titleRu": "Годовой объем розницы", "unit": "L", "precision": 0, "group": "retail", "periodScope": "year", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_active_shops", "titleZh": "零售年活跃站点", "titleRu": "Активные АЗС за год", "unit": "站", "precision": 0, "group": "retail", "periodScope": "year", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_inventory", "titleZh": "零售库存", "titleRu": "Остатки розницы", "unit": "L", "precision": 0, "group": "retail", "periodScope": "year", "goodWhen": "neutral", "permissionCode": "retail:view"},
    {"key": "retail_month_sales_amount", "titleZh": "零售月销售额", "titleRu": "Месячная выручка розницы", "unit": "сом", "precision": 0, "group": "retail", "periodScope": "month", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_month_volume_liters", "titleZh": "零售月销量", "titleRu": "Месячный объем розницы", "unit": "L", "precision": 0, "group": "retail", "periodScope": "month", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_month_active_shops", "titleZh": "零售月活跃站点", "titleRu": "Активные АЗС за месяц", "unit": "站", "precision": 0, "group": "retail", "periodScope": "month", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_trend_anomalies", "titleZh": "零售趋势异常", "titleRu": "Аномалии тренда розницы", "unit": "条", "precision": 0, "group": "retail", "periodScope": "latest", "goodWhen": "down", "permissionCode": "retail:view"},
    {"key": "retail_ai_suggestions", "titleZh": "零售运营建议", "titleRu": "Рекомендации по рознице", "unit": "条", "precision": 0, "group": "retail", "periodScope": "latest", "goodWhen": "neutral", "permissionCode": "retail:view"},
    {"key": "yearly_wholesale_tons", "titleZh": "年批发吨数", "titleRu": "Опт за год", "unit": "t", "precision": 1, "group": "wholesale", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "yearly_procurement_tons", "titleZh": "年采购吨数", "titleRu": "Закупки за год", "unit": "t", "precision": 1, "group": "procurement", "goodWhen": "up", "permissionCode": "procurement:view"},
    {"key": "wholesale_month_export_tons", "titleZh": "出口批发月吨数", "titleRu": "Экспортный опт за месяц", "unit": "t", "precision": 1, "group": "wholesale", "periodScope": "month", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_local_tons", "titleZh": "本地批发月吨数", "titleRu": "Локальный опт за месяц", "unit": "t", "precision": 1, "group": "wholesale", "periodScope": "month", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_transfer_tons", "titleZh": "物资调拨月吨数", "titleRu": "Перемещения за месяц", "unit": "t", "precision": 1, "group": "wholesale", "periodScope": "month", "goodWhen": "neutral", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_procurement_tons", "titleZh": "原料采购月吨数", "titleRu": "Закупки сырья за месяц", "unit": "t", "precision": 1, "group": "procurement", "periodScope": "month", "goodWhen": "up", "permissionCode": "procurement:view"},
    {"key": "wholesale_month_processing_tons", "titleZh": "代加工月吨数", "titleRu": "Переработка за месяц", "unit": "t", "precision": 1, "group": "wholesale", "periodScope": "month", "goodWhen": "neutral", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_unknown_tons", "titleZh": "待识别月吨数", "titleRu": "Неопределено за месяц", "unit": "t", "precision": 1, "group": "wholesale", "periodScope": "month", "goodWhen": "down", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_export_amount_cny", "titleZh": "出口批发月金额", "titleRu": "Сумма экспортного опта за месяц", "unit": "¥", "precision": 0, "group": "wholesale", "periodScope": "month", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "wholesale_month_local_amount_cny", "titleZh": "本地批发月金额", "titleRu": "Сумма локального опта за месяц", "unit": "¥", "precision": 0, "group": "wholesale", "periodScope": "month", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "contract_active", "titleZh": "有效合同", "titleRu": "Активные договоры", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "up", "permissionCode": "contracts:view"},
    {"key": "contract_total", "titleZh": "合同总数", "titleRu": "Всего договоров", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "neutral", "permissionCode": "contracts:view"},
    {"key": "contract_appendix_missing", "titleZh": "附件编号缺失", "titleRu": "Нет номера приложения", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "down", "permissionCode": "contracts:view"},
    {"key": "contract_expiring_30d", "titleZh": "30天内到期合同", "titleRu": "Истекают за 30 дней", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "down", "permissionCode": "contracts:view"},
    {"key": "train_entry_today_rows", "titleZh": "今日录入行数", "titleRu": "Строк ввода сегодня", "unit": "条", "precision": 0, "group": "entry", "goodWhen": "neutral", "permissionCode": "train_entry:view"},
    {"key": "material_transfer_today", "titleZh": "今日调拨单", "titleRu": "Перемещений сегодня", "unit": "单", "precision": 0, "group": "materials", "goodWhen": "neutral", "permissionCode": "materials:view"},
    {"key": "material_transfer_pending", "titleZh": "待处理调拨", "titleRu": "Перемещения в ожидании", "unit": "单", "precision": 0, "group": "materials", "goodWhen": "down", "permissionCode": "materials:view"},
    {"key": "exchange_usd_kgs", "titleZh": "美元/索姆", "titleRu": "USD/KGS", "unit": "", "precision": 4, "group": "exchange", "periodScope": "latest", "goodWhen": "neutral", "permissionCode": "exchange:view"},
    {"key": "exchange_cny_kgs", "titleZh": "人民币/索姆", "titleRu": "CNY/KGS", "unit": "", "precision": 4, "group": "exchange", "periodScope": "latest", "goodWhen": "neutral", "permissionCode": "exchange:view"},
    {"key": "exchange_kgs_cny", "titleZh": "索姆/人民币", "titleRu": "KGS/CNY", "unit": "", "precision": 6, "group": "exchange", "periodScope": "latest", "goodWhen": "neutral", "permissionCode": "exchange:view"},
    {"key": "market_watch_items", "titleZh": "市场观察条目", "titleRu": "Обзоры рынка", "unit": "条", "precision": 0, "group": "exchange", "periodScope": "latest", "goodWhen": "neutral", "permissionCode": "exchange:view"},
    {"key": "api_failed_24h", "titleZh": "24小时接口失败", "titleRu": "CTY-05ибки API за 24ч", "unit": "次", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "ai_failed_7d", "titleZh": "7天 AI 失败", "titleRu": "CTY-05ибки AI за 7 дней", "unit": "次", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "automation_failed", "titleZh": "失败自动任务", "titleRu": "Сбой автозадач", "unit": "项", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "cache_missing", "titleZh": "缓存异常项", "titleRu": "Проблемы кэша", "unit": "项", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
]

EXCHANGE_RATE_METRIC_KEYS = {"exchange_usd_kgs", "exchange_cny_kgs", "exchange_kgs_cny"}
EXCHANGE_RATE_COMPONENT_KEYS = {f"kpi.{key}" for key in EXCHANGE_RATE_METRIC_KEYS}


CHART_COMPONENTS: list[dict[str, Any]] = [
    {"key": "chart.retail_year_monthly_trend", "type": "trend", "dataKey": "retail_year_monthly_trend", "titleZh": "零售年度月趋势", "titleRu": "Месячный тренд розницы за год", "group": "retail", "periodScope": "year", "defaultSpan": 24, "permissionCode": "retail:view"},
    {"key": "chart.retail_month_daily_trend", "type": "trend", "dataKey": "retail_month_daily_trend", "titleZh": "零售月度日趋势", "titleRu": "Дневной тренд розницы за месяц", "group": "retail", "periodScope": "month", "defaultSpan": 24, "permissionCode": "retail:view"},
    {"key": "rank.retail_year_region_sales", "type": "ranking", "dataKey": "retail_year_region_sales", "titleZh": "零售区域销售排行", "titleRu": "Рейтинг регионов розницы", "group": "retail", "periodScope": "year", "defaultSpan": 12, "permissionCode": "retail:view"},
    {"key": "rank.retail_year_product_sales", "type": "ranking", "dataKey": "retail_year_product_sales", "titleZh": "零售油品销售排行", "titleRu": "Рейтинг продуктов розницы", "group": "retail", "periodScope": "year", "defaultSpan": 12, "permissionCode": "retail:view"},
    {"key": "rank.retail_year_station_sales", "type": "ranking", "dataKey": "retail_year_station_sales", "titleZh": "零售站点销售排行", "titleRu": "Рейтинг АЗС по продажам", "group": "retail", "periodScope": "year", "defaultSpan": 12, "permissionCode": "retail:view"},
    {"key": "chart.wholesale_month_daily_trend", "type": "trend", "dataKey": "wholesale_month_daily_trend", "titleZh": "批发月度日趋势", "titleRu": "Дневной тренд опта за месяц", "group": "wholesale", "periodScope": "month", "defaultSpan": 24, "permissionCode": "wholesale:view"},
    {"key": "rank.wholesale_month_export_customers", "type": "ranking", "dataKey": "wholesale_month_export_customers", "titleZh": "出口客户排行", "titleRu": "Рейтинг экспортных клиентов", "group": "wholesale", "periodScope": "month", "defaultSpan": 12, "permissionCode": "wholesale:view"},
    {"key": "rank.wholesale_month_local_customers", "type": "ranking", "dataKey": "wholesale_month_local_customers", "titleZh": "本地客户排行", "titleRu": "Рейтинг локальных клиентов", "group": "wholesale", "periodScope": "month", "defaultSpan": 12, "permissionCode": "wholesale:view"},
    {"key": "rank.wholesale_month_export_products", "type": "ranking", "dataKey": "wholesale_month_export_products", "titleZh": "出口油品排行", "titleRu": "Рейтинг экспортных продуктов", "group": "wholesale", "periodScope": "month", "defaultSpan": 12, "permissionCode": "wholesale:view"},
    {"key": "rank.wholesale_month_transfer_products", "type": "ranking", "dataKey": "wholesale_month_transfer_products", "titleZh": "调拨油品排行", "titleRu": "Рейтинг продуктов перемещения", "group": "wholesale", "periodScope": "month", "defaultSpan": 12, "permissionCode": "wholesale:view"},
    {"key": "chart.wholesale_month_category_mix", "type": "structure", "dataKey": "wholesale_month_category_mix", "titleZh": "批发分类结构", "titleRu": "Структура опта", "group": "wholesale", "periodScope": "month", "defaultSpan": 12, "permissionCode": "wholesale:view"},
    {"key": "card.exchange_current", "type": "exchange", "dataKey": "exchange_current", "titleZh": "最新汇率", "titleRu": "Последние курсы", "group": "exchange", "periodScope": "latest", "defaultSpan": 12, "permissionCode": "exchange:view"},
    {"key": "list.market_watch", "type": "market_watch", "dataKey": "market_watch", "titleZh": "市场观察", "titleRu": "Обзор рынка", "group": "exchange", "periodScope": "latest", "defaultSpan": 16, "permissionCode": "exchange:view"},
    {"key": "panel.retail_alert", "type": "retail_alert", "dataKey": "retail_alert", "titleZh": "零售预警摘要", "titleRu": "Сводка предупреждений розницы", "group": "retail", "periodScope": "latest", "defaultSpan": 24, "permissionCode": "retail:view"},
]


def public_kpi_catalog() -> list[dict[str, Any]]:
    return [metric for metric in KPI_CATALOG if metric["key"] not in EXCHANGE_RATE_METRIC_KEYS]


def component_catalog() -> list[dict[str, Any]]:
    kpi_components = [
        {
            "key": f"kpi.{metric['key']}",
            "type": "kpi",
            "metricKey": metric["key"],
            "titleZh": metric["titleZh"],
            "titleRu": metric.get("titleRu"),
            "group": metric["group"],
            "periodScope": metric.get("periodScope", "latest"),
            "defaultSpan": 6,
            "adminOnly": metric.get("adminOnly", False),
            "permissionCode": metric.get("permissionCode"),
        }
        for metric in public_kpi_catalog()
    ]
    return kpi_components + CHART_COMPONENTS


DEFAULT_CONFIGS = [
    ("ai.openrouter.free_only", "true", "boolean", "ai", "OpenRouter 仅使用免费模型", "OpenRouter только бесплатные модели"),
    ("ai.agent.read_only", "true", "boolean", "ai", "AI 助手只读模式", "AI помощник только чтение"),
    ("retail.alert.daily_generate", "true", "boolean", "retail_alert", "每日生成零售趋势异常和运营建议", "Ежедневно формировать розничные аномалии и рекомендации"),
    ("retail.alert.generate_time", "08:40", "time", "retail_alert", "零售预警生成时间", "Время формирования розничных оповещений"),
    ("automation.retail_snapshot.includes_self_use", "true", "boolean", "automation", "零售快照包含自用油快照", "Розничные снимки включают собственный расход"),
    ("dashboard.cockpit.enabled", "true", "boolean", "dashboard", "启用数据可视化", "Включить визуализацию данных"),
]


DEFAULT_DICTIONARY_ITEMS = [
    ("dashboard_component_type", "kpi", "KPI 指标卡", "KPI карточка", 10),
    ("dashboard_component_type", "trend", "趋势图", "График тренда", 20),
    ("dashboard_component_type", "ranking", "排行图", "Рейтинг", 30),
    ("dashboard_component_type", "structure", "结构图", "Структура", 40),
    ("dashboard_component_type", "exchange", "汇率卡片", "Курсы валют", 50),
    ("dashboard_component_type", "market_watch", "市场观察", "Обзор рынка", 60),
    ("dashboard_component_type", "retail_alert", "零售预警摘要", "Сводка оповещений розницы", 70),
    ("data_source", "retail", "零售数据", "Розничные данные", 10),
    ("data_source", "wholesale", "批发数据", "Оптовые данные", 20),
    ("data_source", "exchange", "汇率与市场", "Курсы и рынок", 30),
    ("data_source", "contracts", "合同数据", "Договоры", 40),
    ("data_source", "materials", "物资调拨", "Перемещение материалов", 50),
    ("data_source", "system", "系统健康", "Состояние системы", 60),
    ("business_status", "pending", "待处理", "Ожидает обработки", 10),
    ("business_status", "completed", "已完成", "Завершено", 20),
    ("business_status", "failed", "失败", "CTY-05ибка", 30),
]


DEFAULT_TEMPLATES = [
    {
        "templateKey": "leadership",
        "titleZh": "领导驾驶舱",
        "titleRu": "Панель руководства",
        "roleScope": {"roles": ["admin", "leadership", "sales_manager"]},
        "sortOrder": 10,
        "config": {
            "components": [
                {"id": "retail_sales", "componentKey": "kpi.retail_sales_amount", "type": "kpi", "metricKey": "retail_sales_amount", "span": 6, "visible": True},
                {"id": "retail_volume", "componentKey": "kpi.retail_volume_liters", "type": "kpi", "metricKey": "retail_volume_liters", "span": 6, "visible": True},
                {"id": "active_contracts", "componentKey": "kpi.contract_active", "type": "kpi", "metricKey": "contract_active", "span": 6, "visible": True},
                {"id": "wholesale_tons", "componentKey": "kpi.yearly_wholesale_tons", "type": "kpi", "metricKey": "yearly_wholesale_tons", "span": 6, "visible": True},
                {"id": "exchange_current", "componentKey": "card.exchange_current", "type": "exchange", "dataKey": "exchange_current", "span": 8, "visible": True},
                {"id": "market_watch", "componentKey": "list.market_watch", "type": "market_watch", "dataKey": "market_watch", "span": 16, "visible": True},
                {"id": "retail_trend", "componentKey": "chart.retail_year_monthly_trend", "type": "trend", "dataKey": "retail_year_monthly_trend", "span": 24, "visible": True},
            ]
        },
    },
    {
        "templateKey": "retail_operations",
        "titleZh": "零售经营驾驶舱",
        "titleRu": "Панель розничных операций",
        "roleScope": {"roles": ["admin", "leadership", "sales_manager", "sales_staff"]},
        "sortOrder": 12,
        "config": {
            "components": [
                {"id": "retail_year_sales", "componentKey": "kpi.retail_sales_amount", "type": "kpi", "metricKey": "retail_sales_amount", "span": 6, "visible": True},
                {"id": "retail_year_volume", "componentKey": "kpi.retail_volume_liters", "type": "kpi", "metricKey": "retail_volume_liters", "span": 6, "visible": True},
                {"id": "retail_month_sales", "componentKey": "kpi.retail_month_sales_amount", "type": "kpi", "metricKey": "retail_month_sales_amount", "span": 6, "visible": True},
                {"id": "retail_month_volume", "componentKey": "kpi.retail_month_volume_liters", "type": "kpi", "metricKey": "retail_month_volume_liters", "span": 6, "visible": True},
                {"id": "retail_month_trend", "componentKey": "chart.retail_month_daily_trend", "type": "trend", "dataKey": "retail_month_daily_trend", "span": 24, "visible": True},
                {"id": "retail_region_rank", "componentKey": "rank.retail_year_region_sales", "type": "ranking", "dataKey": "retail_year_region_sales", "span": 12, "visible": True},
                {"id": "retail_product_rank", "componentKey": "rank.retail_year_product_sales", "type": "ranking", "dataKey": "retail_year_product_sales", "span": 12, "visible": True},
                {"id": "retail_alerts", "componentKey": "panel.retail_alert", "type": "retail_alert", "dataKey": "retail_alert", "span": 24, "visible": True},
            ]
        },
    },
    {
        "templateKey": "wholesale_operations",
        "titleZh": "批发经营驾驶舱",
        "titleRu": "Панель оптовых операций",
        "roleScope": {"roles": ["admin", "leadership", "sales_manager", "sales_staff", "procurement_staff", "loading_staff"]},
        "sortOrder": 14,
        "config": {
            "components": [
                {"id": "export_tons", "componentKey": "kpi.wholesale_month_export_tons", "type": "kpi", "metricKey": "wholesale_month_export_tons", "span": 6, "visible": True},
                {"id": "local_tons", "componentKey": "kpi.wholesale_month_local_tons", "type": "kpi", "metricKey": "wholesale_month_local_tons", "span": 6, "visible": True},
                {"id": "transfer_tons", "componentKey": "kpi.wholesale_month_transfer_tons", "type": "kpi", "metricKey": "wholesale_month_transfer_tons", "span": 6, "visible": True},
                {"id": "procurement_tons", "componentKey": "kpi.wholesale_month_procurement_tons", "type": "kpi", "metricKey": "wholesale_month_procurement_tons", "span": 6, "visible": True},
                {"id": "wholesale_daily", "componentKey": "chart.wholesale_month_daily_trend", "type": "trend", "dataKey": "wholesale_month_daily_trend", "span": 24, "visible": True},
                {"id": "export_customers", "componentKey": "rank.wholesale_month_export_customers", "type": "ranking", "dataKey": "wholesale_month_export_customers", "span": 12, "visible": True},
                {"id": "export_products", "componentKey": "rank.wholesale_month_export_products", "type": "ranking", "dataKey": "wholesale_month_export_products", "span": 12, "visible": True},
                {"id": "category_mix", "componentKey": "chart.wholesale_month_category_mix", "type": "structure", "dataKey": "wholesale_month_category_mix", "span": 12, "visible": True},
                {"id": "transfer_products", "componentKey": "rank.wholesale_month_transfer_products", "type": "ranking", "dataKey": "wholesale_month_transfer_products", "span": 12, "visible": True},
            ]
        },
    },
    {
        "templateKey": "entry_workbench",
        "titleZh": "录入工作台",
        "titleRu": "Рабочее место ввода",
        "roleScope": {"roles": ["admin", "operator", "sales_staff", "procurement_staff"]},
        "sortOrder": 20,
        "config": {
            "components": [
                {"id": "today_entries", "componentKey": "kpi.train_entry_today_rows", "type": "kpi", "metricKey": "train_entry_today_rows", "span": 6, "visible": True},
                {"id": "material_today", "componentKey": "kpi.material_transfer_today", "type": "kpi", "metricKey": "material_transfer_today", "span": 6, "visible": True},
                {"id": "material_pending", "componentKey": "kpi.material_transfer_pending", "type": "kpi", "metricKey": "material_transfer_pending", "span": 6, "visible": True},
                {"id": "contract_missing_appendix", "componentKey": "kpi.contract_appendix_missing", "type": "kpi", "metricKey": "contract_appendix_missing", "span": 6, "visible": True},
            ]
        },
    },
    {
        "templateKey": "admin_system",
        "titleZh": "管理员系统驾驶舱",
        "titleRu": "Системная панель администратора",
        "roleScope": {"roles": ["admin"]},
        "sortOrder": 30,
        "config": {
            "components": [
                {"id": "api_failed", "componentKey": "kpi.api_failed_24h", "type": "kpi", "metricKey": "api_failed_24h", "span": 6, "visible": True},
                {"id": "ai_failed", "componentKey": "kpi.ai_failed_7d", "type": "kpi", "metricKey": "ai_failed_7d", "span": 6, "visible": True},
                {"id": "automation_failed", "componentKey": "kpi.automation_failed", "type": "kpi", "metricKey": "automation_failed", "span": 6, "visible": True},
                {"id": "cache_missing", "componentKey": "kpi.cache_missing", "type": "kpi", "metricKey": "cache_missing", "span": 6, "visible": True},
            ]
        },
    },
]


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _active_month() -> str:
    completed_day = date.today() - timedelta(days=1)
    return f"{completed_day.year}-{completed_day.month:02d}"


def _monthly_snapshot_path(ym: str) -> Path:
    year, month = ym.split("-")
    return OILSTATION_ROOT / "cache_snapshots" / "monthly" / year / f"monthly_{int(month):02d}.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _safe_scalar(cur, sql: str, params: tuple[Any, ...] = ()) -> float:
    try:
        cur.execute(sql, params)
        row = cur.fetchone() or {}
        if isinstance(row, dict):
            return _num(next(iter(row.values()), 0))
        return _num(row[0] if row else 0)
    except pymysql.err.ProgrammingError:
        return 0


def _safe_oilstation_json(path: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        data = get_oilstation_json(path, query or {})
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _summary_value(summary: dict[str, Any], *keys: str) -> float:
    for key in keys:
        if key in summary:
            return _num(summary.get(key))
    return 0.0


def _summary_optional_value(summary: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        if key in summary and summary.get(key) is not None:
            return _num(summary.get(key))
    return None


def _latest_exchange(cur) -> dict[str, Any]:
    try:
        cur.execute("""
            SELECT rate_date, usd_kgs, cny_kgs, source
            FROM exchange_rates
            WHERE rate_date <= CURDATE()
              AND (usd_kgs IS NOT NULL OR cny_kgs IS NOT NULL)
            ORDER BY rate_date DESC
            LIMIT 1
        """)
        row = cur.fetchone()
    except pymysql.err.ProgrammingError:
        row = None
    if not row:
        return {"usdKgs": None, "cnyKgs": None, "kgsCny": None, "date": None, "source": None}
    usd = _num(row["usd_kgs"] if isinstance(row, dict) else row[1])
    cny = _num(row["cny_kgs"] if isinstance(row, dict) else row[2])
    rate_date = row["rate_date"] if isinstance(row, dict) else row[0]
    return {
        "usdKgs": usd or None,
        "cnyKgs": cny or None,
        "kgsCny": round(1 / cny, 6) if cny else None,
        "date": rate_date.isoformat() if hasattr(rate_date, "isoformat") else rate_date,
        "source": row["source"] if isinstance(row, dict) else row[3],
    }


def _market_watch_items(cur, limit: int = 8) -> list[dict[str, Any]]:
    try:
        cur.execute("""
            SELECT id, market_region, market_type, title, summary,
                   price_text, source_name, source_url, observed_at
            FROM market_watch_items
            WHERE is_active = TRUE
              AND market_region IN ('Russia', 'Uzbekistan', 'Global')
            ORDER BY observed_at DESC, priority ASC, id DESC
            LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
    except Exception:
        rows = []
    items = []
    for row in rows:
        if isinstance(row, dict):
            observed_at = row.get("observed_at")
            items.append({
                "id": row["id"],
                "region": row["market_region"],
                "type": row["market_type"],
                "title": row["title"],
                "summary": row["summary"],
                "priceText": row["price_text"] or "",
                "sourceName": row["source_name"] or "",
                "sourceUrl": row["source_url"] or "",
                "observedAt": observed_at.isoformat() if hasattr(observed_at, "isoformat") else observed_at,
            })
        else:
            observed_at = row[8]
            items.append({
                "id": row[0],
                "region": row[1],
                "type": row[2],
                "title": row[3],
                "summary": row[4],
                "priceText": row[5] or "",
                "sourceName": row[6] or "",
                "sourceUrl": row[7] or "",
                "observedAt": observed_at.isoformat() if hasattr(observed_at, "isoformat") else observed_at,
            })
    return items


def _current_user(cur) -> dict[str, Any] | None:
    user_id = int(get_jwt_identity())
    cur.execute("SELECT id, username, role FROM system_users WHERE id = %s AND is_active = TRUE", (user_id,))
    row = cur.fetchone()
    if not row:
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"]}


def _role_codes(cur, user: dict[str, Any]) -> set[str]:
    roles = {user.get("role") or "viewer"}
    try:
        roles.update(role["roleCode"] for role in list_user_roles(cur, user["id"]))
    except Exception:
        pass
    return {role for role in roles if role}


def _department_codes(cur, user: dict[str, Any]) -> set[str]:
    try:
        return {dept["deptCode"] for dept in list_user_departments(cur, user["id"]) if dept.get("deptCode")}
    except Exception:
        return set()


def _forbidden():
    return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403


def _require_admin(cur) -> dict[str, Any] | tuple[Any, int]:
    user = _current_user(cur)
    if not user:
        return jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401
    if user["role"] != "admin":
        return _forbidden()
    return user


def ensure_management_schema(cur) -> None:
    ensure_permission_schema(cur)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS system_configs (
            config_key VARCHAR(128) PRIMARY KEY,
            config_value MEDIUMTEXT NULL,
            value_type VARCHAR(32) NOT NULL DEFAULT 'string',
            group_key VARCHAR(64) NOT NULL DEFAULT 'general',
            label_zh VARCHAR(255) NULL,
            label_ru VARCHAR(255) NULL,
            is_secret BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS system_dictionary_items (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            dict_type VARCHAR(64) NOT NULL,
            item_code VARCHAR(128) NOT NULL,
            label_zh VARCHAR(255) NOT NULL,
            label_ru VARCHAR(255) NULL,
            value_json MEDIUMTEXT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_dict_item (dict_type, item_code),
            KEY idx_dict_type (dict_type, sort_order, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS dashboard_templates (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            template_key VARCHAR(64) NOT NULL UNIQUE,
            title_zh VARCHAR(128) NOT NULL,
            title_ru VARCHAR(128) NULL,
            role_scope MEDIUMTEXT NULL,
            config_json MEDIUMTEXT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS recycle_bin_items (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            source_table VARCHAR(128) NOT NULL,
            source_id VARCHAR(128) NOT NULL,
            title VARCHAR(255) NULL,
            payload_json MEDIUMTEXT NULL,
            deleted_by BIGINT NULL,
            deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            restore_status VARCHAR(32) NOT NULL DEFAULT 'pending',
            KEY idx_deleted_at (deleted_at),
            KEY idx_source (source_table, source_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _seed_management(cur)


def _seed_management(cur) -> None:
    for config_key, config_value, value_type, group_key, label_zh, label_ru in DEFAULT_CONFIGS:
        cur.execute("""
            INSERT IGNORE INTO system_configs
                (config_key, config_value, value_type, group_key, label_zh, label_ru)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (config_key, config_value, value_type, group_key, label_zh, label_ru))
    for dict_type, item_code, label_zh, label_ru, sort_order in DEFAULT_DICTIONARY_ITEMS:
        cur.execute("""
            INSERT IGNORE INTO system_dictionary_items
                (dict_type, item_code, label_zh, label_ru, sort_order, is_active)
            VALUES (%s, %s, %s, %s, %s, TRUE)
        """, (dict_type, item_code, label_zh, label_ru, sort_order))
    for template in DEFAULT_TEMPLATES:
        cur.execute("""
            INSERT IGNORE INTO dashboard_templates
                (template_key, title_zh, title_ru, role_scope, config_json, sort_order, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE)
        """, (
            template["templateKey"],
            template["titleZh"],
            template["titleRu"],
            _json_dumps(template["roleScope"]),
            _json_dumps(template["config"]),
            template["sortOrder"],
        ))


def _list_configs(cur) -> list[dict[str, Any]]:
    cur.execute("""
        SELECT config_key, config_value, value_type, group_key, label_zh, label_ru, is_secret, updated_at
        FROM system_configs
        ORDER BY group_key, config_key
    """)
    return [
        {
            "configKey": row["config_key"],
            "configValue": "***" if row["is_secret"] else row["config_value"],
            "valueType": row["value_type"],
            "groupKey": row["group_key"],
            "labelZh": row["label_zh"],
            "labelRu": row["label_ru"],
            "isSecret": bool(row["is_secret"]),
            "updatedAt": row["updated_at"].isoformat(sep=" ") if isinstance(row.get("updated_at"), datetime) else None,
        }
        for row in cur.fetchall()
    ]


def _list_dictionary_items(cur) -> list[dict[str, Any]]:
    cur.execute("""
        SELECT id, dict_type, item_code, label_zh, label_ru, value_json, sort_order, is_active, updated_at
        FROM system_dictionary_items
        ORDER BY dict_type, sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "dictType": row["dict_type"],
            "itemCode": row["item_code"],
            "labelZh": row["label_zh"],
            "labelRu": row["label_ru"],
            "value": _json_loads(row["value_json"], None),
            "sortOrder": row["sort_order"],
            "isActive": bool(row["is_active"]),
            "updatedAt": row["updated_at"].isoformat(sep=" ") if isinstance(row.get("updated_at"), datetime) else None,
        }
        for row in cur.fetchall()
    ]


def _list_templates(cur) -> list[dict[str, Any]]:
    cur.execute("""
        SELECT id, template_key, title_zh, title_ru, role_scope, config_json, is_active, sort_order, updated_at
        FROM dashboard_templates
        ORDER BY sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "templateKey": row["template_key"],
            "titleZh": row["title_zh"],
            "titleRu": row["title_ru"],
            "roleScope": _json_loads(row["role_scope"], {}),
            "config": _json_loads(row["config_json"], {"components": []}),
            "isActive": bool(row["is_active"]),
            "sortOrder": row["sort_order"],
            "updatedAt": row["updated_at"].isoformat(sep=" ") if isinstance(row.get("updated_at"), datetime) else None,
        }
        for row in cur.fetchall()
    ]


def _list_recycle_items(cur) -> list[dict[str, Any]]:
    cur.execute("""
        SELECT id, source_table, source_id, title, deleted_by, deleted_at, restore_status
        FROM recycle_bin_items
        ORDER BY deleted_at DESC, id DESC
        LIMIT 100
    """)
    return [
        {
            "id": row["id"],
            "sourceTable": row["source_table"],
            "sourceId": row["source_id"],
            "title": row["title"],
            "deletedBy": row["deleted_by"],
            "deletedAt": row["deleted_at"].isoformat(sep=" ") if isinstance(row.get("deleted_at"), datetime) else None,
            "restoreStatus": row["restore_status"],
        }
        for row in cur.fetchall()
    ]


def _management_departments(cur) -> list[dict[str, Any]]:
    try:
        cur.execute("""
            SELECT dept_code, dept_name, dept_name_ru, is_active, sort_order
            FROM system_departments
            ORDER BY sort_order, id
        """)
        rows = cur.fetchall()
    except Exception:
        rows = []
    return [
        {
            "deptCode": row["dept_code"] if isinstance(row, dict) else row[0],
            "deptName": row["dept_name"] if isinstance(row, dict) else row[1],
            "deptNameRu": row["dept_name_ru"] if isinstance(row, dict) else row[2],
            "isActive": bool(row["is_active"] if isinstance(row, dict) else row[3]),
        }
        for row in rows
    ]


def _retail_year_trend(year: int, max_month: int) -> list[dict[str, Any]]:
    rows = []
    for month in range(1, max_month + 1):
        ym = f"{year}-{month:02d}"
        monthly = _safe_oilstation_json(f"/api/monthly/{ym}")
        summary = monthly.get("summary") or {}
        rows.append({
            "label": f"{month}月",
            "volume": round(_summary_value(summary, "totalLiters", "totalVolume"), 2),
            "amountWan": round(_summary_value(summary, "totalSales", "totalAmount") / 10000, 2),
        })
    return rows


def _ranking_rows(items: list[dict[str, Any]], label_key: str = "name", value_key: str = "amount", limit: int = 10) -> list[dict[str, Any]]:
    rows = []
    for item in items[:limit]:
        rows.append({
            "label": item.get(label_key) or item.get("short") or item.get("region") or "-",
            "value": round(_num(item.get(value_key)), 2),
            "extra": item,
        })
    return rows


def _metric_values_and_component_data(cur, year: int, month: int) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    today = date.today()
    year_start = date(year, 1, 1)
    year_end = min(date(year + 1, 1, 1) - timedelta(days=1), today)
    period_month = f"{year}-{month:02d}"

    retail_year = _safe_oilstation_json("/api/kpi/yearly", {"year": year, "inventory": 0})
    retail_year_summary = retail_year.get("summary") or retail_year.get("data", {}).get("summary") or {}
    retail_month = _safe_oilstation_json(f"/api/monthly/{period_month}")
    retail_month_summary = retail_month.get("summary") or {}
    retail_dashboard_year = _safe_oilstation_json("/api/dashboard/yearly", {"year": year})
    retail_resources_year = _safe_oilstation_json("/api/resources/yearly", {"year": year})

    try:
        wholesale_page = summarize_wholesale_page(cur, year, month)
    except Exception:
        wholesale_page = {"cards": {}, "dailyTrend": [], "customerRankings": {}, "productRankings": {}, "transferSummary": {}}
    cards = wholesale_page.get("cards") or {}
    export_card = cards.get("export_wholesale") or {}
    local_card = cards.get("local_wholesale") or {}
    transfer_card = cards.get("transfer") or {}
    procurement_card = cards.get("procurement") or {}
    processing_card = cards.get("processing") or {}
    unknown_card = cards.get("unknown") or {}

    try:
        insight = latest_retail_alert_insights(period_month, language="zh")
    except Exception:
        insight = {"trendAnomalies": [], "suggestions": []}

    exchange = _latest_exchange(cur)
    market_items = _market_watch_items(cur)
    ensure_audit_schema(cur)
    ensure_ai_call_schema(cur)
    cache_items = _cache_items()

    values = {
        "retail_sales_amount": _summary_value(retail_year_summary, "totalSales", "totalAmount"),
        "retail_volume_liters": _summary_value(retail_year_summary, "totalLiters", "totalVolume"),
        "retail_active_shops": _summary_value(retail_year_summary, "activeShops"),
        "retail_inventory": _summary_value(retail_year_summary, "inventory"),
        "retail_month_sales_amount": _summary_value(retail_month_summary, "totalSales", "totalAmount"),
        "retail_month_volume_liters": _summary_value(retail_month_summary, "totalLiters", "totalVolume"),
        "retail_month_active_shops": _summary_value(retail_month_summary, "activeShops"),
        "retail_trend_anomalies": len(insight.get("trendAnomalies") or []),
        "retail_ai_suggestions": len(insight.get("suggestions") or []),
        "yearly_wholesale_tons": _safe_scalar(cur, """
            SELECT COALESCE(SUM(weight_tons), 0)
            FROM wholesale_detail_records
            WHERE business_date >= %s AND business_date <= %s
        """, (year_start, year_end)),
        "yearly_procurement_tons": _safe_scalar(cur, """
            SELECT COALESCE(SUM(weight_tons), 0)
            FROM wholesale_detail_records
            WHERE classification = 'procurement' AND business_date >= %s AND business_date <= %s
        """, (year_start, year_end)),
        "wholesale_month_export_tons": _num(export_card.get("tons")),
        "wholesale_month_local_tons": _num(local_card.get("tons")),
        "wholesale_month_transfer_tons": _num(transfer_card.get("tons")),
        "wholesale_month_procurement_tons": _num(procurement_card.get("tons")),
        "wholesale_month_processing_tons": _num(processing_card.get("tons")),
        "wholesale_month_unknown_tons": _num(unknown_card.get("tons")),
        "wholesale_month_export_amount_cny": _num(export_card.get("amountCny")),
        "wholesale_month_local_amount_cny": _num(local_card.get("amountCny")),
        "contract_active": _safe_scalar(cur, """
            SELECT COUNT(*) FROM contracts
            WHERE effective_start <= %s AND effective_end >= %s
        """, (today, today)),
        "contract_total": _safe_scalar(cur, "SELECT COUNT(*) FROM contracts"),
        "contract_appendix_missing": _safe_scalar(cur, """
            SELECT COUNT(*) FROM contracts
            WHERE appendix_no IS NULL OR TRIM(appendix_no) = ''
        """),
        "contract_expiring_30d": _safe_scalar(cur, """
            SELECT COUNT(*) FROM contracts
            WHERE effective_end >= %s AND effective_end <= %s
        """, (today, today + timedelta(days=30))),
        "train_entry_today_rows": _safe_scalar(cur, "SELECT COUNT(*) FROM train_entry WHERE entry_date = %s", (today,)),
        "material_transfer_today": _safe_scalar(cur, "SELECT COUNT(*) FROM material_transfer_orders WHERE order_date = %s", (today,)),
        "material_transfer_pending": _safe_scalar(cur, "SELECT COUNT(*) FROM material_transfer_orders WHERE status = 'pending'"),
        "exchange_usd_kgs": exchange.get("usdKgs") or 0,
        "exchange_cny_kgs": exchange.get("cnyKgs") or 0,
        "exchange_kgs_cny": exchange.get("kgsCny") or 0,
        "market_watch_items": len(market_items),
        "api_failed_24h": _safe_scalar(cur, """
            SELECT COUNT(*) FROM system_operation_logs
            WHERE success = 0 AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        """),
        "ai_failed_7d": _safe_scalar(cur, """
            SELECT COUNT(*) FROM ai_agent_call_logs
            WHERE status IN ('failed','source_query_failed') AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """),
        "automation_failed": _safe_scalar(cur, """
            SELECT COUNT(*) FROM automation_task_runs
            WHERE status = 'failed' AND started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """),
        "cache_missing": sum(1 for item in cache_items if not item.get("exists") or not item.get("valid")),
    }
    secondary_values = {
        "retail_volume_liters": _summary_optional_value(retail_year_summary, "totalTons"),
        "retail_month_volume_liters": _summary_optional_value(retail_month_summary, "totalTons"),
    }

    max_month = 12 if year < today.year else today.month
    regions = retail_dashboard_year.get("regions") or {}
    stations = retail_dashboard_year.get("stations") or []
    resources = retail_resources_year.get("resources") or retail_dashboard_year.get("byResource") or []
    retail_daily = retail_month.get("daily") or []

    component_data = {
        "retail_year_monthly_trend": {
            "rows": _retail_year_trend(year, max_month),
            "series": [
                {"key": "volume", "labelZh": "销量", "labelRu": "Объем", "type": "bar", "unit": "L"},
                {"key": "amountWan", "labelZh": "销售额", "labelRu": "Выручка", "type": "line", "unit": "万 сом", "yAxisIndex": 1},
            ],
        },
        "retail_month_daily_trend": {
            "rows": [
                {
                    "label": (item.get("date") or "")[-2:] if isinstance(item, dict) else "",
                    "date": item.get("date") if isinstance(item, dict) else "",
                    "volume": round(_num(item.get("volume") if isinstance(item, dict) else 0), 2),
                    "amountWan": round(_num(item.get("amount") if isinstance(item, dict) else 0) / 10000, 2),
                }
                for item in retail_daily
            ],
            "series": [
                {"key": "volume", "labelZh": "销量", "labelRu": "Объем", "type": "bar", "unit": "L"},
                {"key": "amountWan", "labelZh": "销售额", "labelRu": "Выручка", "type": "line", "unit": "万 сом", "yAxisIndex": 1},
            ],
        },
        "retail_year_region_sales": {
            "rows": sorted(
                (
                    {"label": key, "value": round(_num(value.get("amount")) / 10000, 2), "volume": round(_num(value.get("volume")) / 10000, 2)}
                    for key, value in regions.items()
                ),
                key=lambda item: item["value"],
                reverse=True,
            )[:12],
            "unit": "万 сом",
        },
        "retail_year_product_sales": {
            "rows": _ranking_rows(
                sorted(resources, key=lambda item: _num(item.get("amount")), reverse=True),
                label_key="name",
                value_key="amount",
                limit=12,
            ),
            "unit": "сом",
        },
        "retail_year_station_sales": {
            "rows": _ranking_rows(
                sorted(stations, key=lambda item: _num(item.get("amount")), reverse=True),
                label_key="short",
                value_key="amount",
                limit=12,
            ),
            "unit": "сом",
        },
        "wholesale_month_daily_trend": {
            "rows": [
                {
                    "label": (item.get("date") or "")[-2:],
                    "date": item.get("date"),
                    "exportTons": _num(item.get("exportTons")),
                    "localTons": _num(item.get("localTons")),
                    "transferTons": _num(item.get("transferTons")),
                    "procurementTons": _num(item.get("procurementTons")),
                    "amountWan": round(_num(item.get("amountCny")) / 10000, 2),
                }
                for item in wholesale_page.get("dailyTrend") or []
            ],
            "series": [
                {"key": "exportTons", "labelZh": "出口批发", "labelRu": "Экспорт", "type": "line", "unit": "t"},
                {"key": "localTons", "labelZh": "本地批发", "labelRu": "Локальный опт", "type": "line", "unit": "t"},
                {"key": "transferTons", "labelZh": "物资调拨", "labelRu": "Перемещение", "type": "line", "unit": "t"},
                {"key": "procurementTons", "labelZh": "原料采购", "labelRu": "Закупки", "type": "line", "unit": "t"},
                {"key": "amountWan", "labelZh": "金额", "labelRu": "Сумма", "type": "bar", "unit": "万元", "yAxisIndex": 1},
            ],
        },
        "wholesale_month_export_customers": {"rows": _ranking_rows((wholesale_page.get("customerRankings") or {}).get("export_wholesale") or [], value_key="tons"), "unit": "t"},
        "wholesale_month_local_customers": {"rows": _ranking_rows((wholesale_page.get("customerRankings") or {}).get("local_wholesale") or [], value_key="tons"), "unit": "t"},
        "wholesale_month_export_products": {"rows": _ranking_rows((wholesale_page.get("productRankings") or {}).get("export_wholesale") or [], value_key="tons"), "unit": "t"},
        "wholesale_month_transfer_products": {"rows": _ranking_rows(((wholesale_page.get("transferSummary") or {}).get("byProduct") or []), label_key="name", value_key="tons"), "unit": "t"},
        "wholesale_month_category_mix": {
            "rows": [
                {"label": "出口批发", "value": _num(export_card.get("tons"))},
                {"label": "本地批发", "value": _num(local_card.get("tons"))},
                {"label": "物资调拨", "value": _num(transfer_card.get("tons"))},
                {"label": "原料采购", "value": _num(procurement_card.get("tons"))},
                {"label": "代加工", "value": _num(processing_card.get("tons"))},
                {"label": "待识别", "value": _num(unknown_card.get("tons"))},
            ],
            "unit": "t",
        },
        "exchange_current": exchange,
        "market_watch": {"items": market_items},
    }

    updated_at = datetime.now().isoformat(sep=" ", timespec="seconds")
    result: dict[str, dict[str, Any]] = {}
    for metric in KPI_CATALOG:
        metric_key = metric["key"]
        payload = {
            "value": values.get(metric_key, 0),
            "updatedAt": updated_at,
            "status": "ok",
            "source": metric["group"],
            "periodScope": metric.get("periodScope", "latest"),
        }
        if metric_key in secondary_values and secondary_values[metric_key] is not None:
            payload.update({
                "secondaryValue": secondary_values[metric_key],
                "secondaryUnit": "t",
                "secondaryPrecision": 3,
                "secondaryLabelZh": "实际吨位",
                "secondaryLabelRu": "Фактическая масса",
            })
        result[metric_key] = payload
    return result, component_data


def _metric_allowed(cur, metric: dict[str, Any], user: dict[str, Any]) -> bool:
    if user["role"] == "admin":
        return True
    if metric.get("adminOnly"):
        return False
    permission_code = metric.get("permissionCode")
    if not permission_code:
        return True
    return has_permission(cur, user["id"], permission_code, user["role"])


def _scope_allowed(scope: dict[str, Any], roles: set[str], departments: set[str]) -> bool:
    allowed_roles = set(scope.get("roles") or [])
    allowed_departments = set(scope.get("departments") or [])
    if allowed_roles and not (roles & allowed_roles):
        return False
    if allowed_departments and not (departments & allowed_departments):
        return False
    return True


def _template_allowed(template: dict[str, Any], roles: set[str], departments: set[str]) -> bool:
    return _scope_allowed(template.get("roleScope") or {}, roles, departments)


def _component_id_key(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", value or "").strip("_")


def _component_definition_from_id(component_id: str, catalog: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    normalized_id = _component_id_key(component_id)
    if not normalized_id:
        return None
    for key, definition in catalog.items():
        normalized_key = _component_id_key(key)
        if normalized_id == normalized_key or normalized_id.startswith(f"{normalized_key}_"):
            return definition
    return None


def _component_definition(component: dict[str, Any]) -> dict[str, Any] | None:
    catalog = {item["key"]: item for item in component_catalog()}
    data_catalog = {item.get("dataKey"): item for item in component_catalog() if item.get("dataKey")}
    component_key = component.get("componentKey")
    metric_key = component.get("metricKey")
    component_id = str(component.get("id") or "")
    normalized_component_id = _component_id_key(component_id)
    legacy_exchange_ids = {_component_id_key(key) for key in EXCHANGE_RATE_COMPONENT_KEYS}
    if (
        component_key in EXCHANGE_RATE_COMPONENT_KEYS
        or metric_key in EXCHANGE_RATE_METRIC_KEYS
        or any(normalized_component_id == item or normalized_component_id.startswith(f"{item}_") for item in legacy_exchange_ids)
    ):
        return catalog.get("card.exchange_current")
    if component_key in catalog:
        return catalog[component_key]
    from_id = _component_definition_from_id(component_id, catalog)
    if from_id:
        return from_id
    data_key = component.get("dataKey")
    if data_key in data_catalog:
        return data_catalog[data_key]
    if metric_key:
        return catalog.get(f"kpi.{metric_key}")
    if component.get("type") == "retail_alert":
        return catalog.get("panel.retail_alert")
    component_type = component.get("type") or ""
    if component_type == "trend" or component_id.startswith("trend_"):
        return catalog.get("chart.retail_year_monthly_trend")
    if component_type == "ranking" or component_id.startswith("ranking_"):
        return catalog.get("rank.retail_year_region_sales")
    if component_type == "structure" or component_id.startswith("structure_"):
        return catalog.get("chart.wholesale_month_category_mix")
    if component_type == "exchange" or component_id.startswith("exchange_"):
        return catalog.get("card.exchange_current")
    if component_type == "market_watch" or component_id.startswith("market_watch_"):
        return catalog.get("list.market_watch")
    return None


def _is_legacy_exchange_rate_component(component: dict[str, Any]) -> bool:
    component_key = component.get("componentKey")
    metric_key = component.get("metricKey")
    normalized_component_id = _component_id_key(str(component.get("id") or ""))
    legacy_exchange_ids = {_component_id_key(key) for key in EXCHANGE_RATE_COMPONENT_KEYS}
    return (
        component_key in EXCHANGE_RATE_COMPONENT_KEYS
        or metric_key in EXCHANGE_RATE_METRIC_KEYS
        or any(normalized_component_id == item or normalized_component_id.startswith(f"{item}_") for item in legacy_exchange_ids)
    )


def _bounded_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        numeric = default
    return max(min_value, min(max_value, numeric))


def _bounded_float(value: Any, default: float, min_value: float, max_value: float) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        numeric = default
    bounded = max(min_value, min(max_value, numeric))
    return round(bounded, 2)


def _default_component_height(component_type: str | None) -> int:
    return {
        "kpi": 118,
        "trend": 360,
        "ranking": 340,
        "structure": 340,
        "exchange": 160,
        "market_watch": 280,
        "retail_alert": 220,
    }.get(component_type or "kpi", 118)


def _component_min_span(component_type: str | None) -> int:
    return 1 if (component_type or "kpi") == "kpi" else 4


def _component_min_width_percent(component_type: str | None) -> float:
    return 2.0 if (component_type or "kpi") == "kpi" else 4.0


def _component_min_height(component_type: str | None) -> int:
    component_type = component_type or "kpi"
    if component_type == "kpi":
        return 20
    if component_type == "exchange":
        return 72
    if component_type in {"market_watch", "retail_alert"}:
        return 96
    return 100


def _normalize_component(component: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(component or {})
    definition = _component_definition(normalized)
    legacy_exchange_component = _is_legacy_exchange_rate_component(normalized)
    if definition:
        normalized["componentKey"] = definition["key"]
        normalized["type"] = definition["type"]
        if definition.get("metricKey"):
            normalized["metricKey"] = definition["metricKey"]
        elif normalized.get("type") != "kpi":
            normalized.pop("metricKey", None)
        if definition.get("dataKey"):
            normalized["dataKey"] = definition["dataKey"]
        elif definition["key"] == "card.exchange_current":
            normalized["dataKey"] = "exchange_current"
        if definition["key"] == "card.exchange_current":
            normalized.pop("metricKey", None)
        normalized["span"] = _bounded_int(
            normalized.get("span"),
            definition.get("defaultSpan") or 6,
            _component_min_span(normalized.get("type")),
            24,
        )
        if legacy_exchange_component:
            normalized["span"] = max(normalized["span"], definition.get("defaultSpan") or 12)
    else:
        normalized["span"] = _bounded_int(normalized.get("span"), 6, _component_min_span(normalized.get("type")), 24)
    normalized["height"] = _bounded_int(
        normalized.get("height"),
        _default_component_height(normalized.get("type")),
        _component_min_height(normalized.get("type")),
        900,
    )
    if normalized.get("widthPercent") is not None:
        normalized["widthPercent"] = _bounded_float(
            normalized.get("widthPercent"),
            (normalized["span"] / 24) * 100,
            _component_min_width_percent(normalized.get("type")),
            100,
        )
    return normalized


def _normalize_template_config(config: dict[str, Any]) -> dict[str, Any]:
    config = dict(config or {})
    components = config.get("components") or []
    normalized_components = []
    has_explicit_exchange = any(
        isinstance(component, dict)
        and not _is_legacy_exchange_rate_component(component)
        and (_component_definition(component) or {}).get("key") == "card.exchange_current"
        for component in components
    )
    legacy_exchange_added = False
    for component in components:
        if not isinstance(component, dict):
            continue
        is_legacy_exchange = _is_legacy_exchange_rate_component(component)
        normalized = _normalize_component(component)
        if normalized.get("componentKey") == "card.exchange_current" and is_legacy_exchange:
            if has_explicit_exchange or legacy_exchange_added:
                continue
            legacy_exchange_added = True
        normalized_components.append(normalized)
    config["components"] = normalized_components
    return config


def _component_allowed(cur, component: dict[str, Any], user: dict[str, Any], roles: set[str], departments: set[str], allowed_metrics: set[str]) -> bool:
    definition = _component_definition(component) or {}
    if component.get("adminOnly") or definition.get("adminOnly"):
        if user["role"] != "admin":
            return False
    if not _scope_allowed(component.get("roleScope") or {}, roles, departments):
        return False
    metric_key = component.get("metricKey") or definition.get("metricKey")
    if metric_key and metric_key not in allowed_metrics:
        return False
    permission_code = component.get("permissionCode") or definition.get("permissionCode")
    if permission_code and user["role"] != "admin" and not has_permission(cur, user["id"], permission_code, user["role"]):
        return False
    return True


def _visible_templates(cur, user: dict[str, Any]) -> list[dict[str, Any]]:
    roles = _role_codes(cur, user)
    departments = _department_codes(cur, user)
    templates = [template for template in _list_templates(cur) if template.get("isActive")]
    allowed_templates = [template for template in templates if _template_allowed(template, roles, departments)]
    allowed_metrics = {metric["key"] for metric in public_kpi_catalog() if _metric_allowed(cur, metric, user)}
    for template in allowed_templates:
        components = []
        normalized_config = _normalize_template_config(template.get("config") or {})
        for component in normalized_config.get("components") or []:
            if component.get("visible") is False:
                continue
            if not _component_allowed(cur, component, user, roles, departments, allowed_metrics):
                continue
            components.append(component)
        template["config"] = {**normalized_config, "components": components}
    return allowed_templates


@bp_v2.route("/cockpit", methods=["GET"])
@jwt_required()
def cockpit():
    language = "ru" if (request.args.get("lang") or request.args.get("language") or "").lower().startswith("ru") else "zh"
    today = date.today()
    year = int(request.args.get("year") or today.year)
    month = int(request.args.get("month") or today.month)
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            user = _current_user(cur)
            if not user:
                return jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401
            if user["role"] != "admin" and not has_permission(cur, user["id"], "dashboard:view", user["role"]):
                return _forbidden()
            catalog = [metric for metric in public_kpi_catalog() if _metric_allowed(cur, metric, user)]
            allowed_metric_keys = {metric["key"] for metric in catalog}
            metrics, component_data = _metric_values_and_component_data(cur, year, month)
            metrics = {key: value for key, value in metrics.items() if key in allowed_metric_keys}
            allowed_component_catalog = [
                item for item in component_catalog()
                if user["role"] == "admin"
                or (
                    not item.get("adminOnly")
                    and (not item.get("metricKey") or item["metricKey"] in allowed_metric_keys)
                    and (not item.get("permissionCode") or has_permission(cur, user["id"], item["permissionCode"], user["role"]))
                )
            ]
            allowed_data_keys = {item["dataKey"] for item in allowed_component_catalog if item.get("dataKey")}
            component_data = {key: value for key, value in component_data.items() if key in allowed_data_keys}
            templates = _visible_templates(cur, user)
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {
                "templates": templates,
                "metrics": metrics,
                "kpiCatalog": catalog,
                "componentCatalog": allowed_component_catalog,
                "componentData": component_data,
                "retailAlert": latest_retail_alert_insights(language=language) if "retail_alert" in allowed_data_keys else None,
                "periods": {"year": year, "month": month, "yearMonth": f"{year}-{month:02d}"},
            }})
    finally:
        conn.close()


@bp_v2.route("/management/overview", methods=["GET"])
@jwt_required()
def management_overview():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {
                "configs": _list_configs(cur),
                "dictionaryItems": _list_dictionary_items(cur),
                "templates": _list_templates(cur),
                "recycleItems": _list_recycle_items(cur),
                "kpiCatalog": public_kpi_catalog(),
                "componentCatalog": component_catalog(),
                "departments": _management_departments(cur),
            }})
    finally:
        conn.close()


@bp_v2.route("/management/configs/<path:config_key>", methods=["PUT"])
@jwt_required()
def update_config(config_key: str):
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            cur.execute("""
                UPDATE system_configs
                SET config_value = %s
                WHERE config_key = %s AND is_secret = FALSE
            """, (str(payload.get("configValue", "")), config_key))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()


@bp_v2.route("/management/dictionary-items", methods=["POST"])
@jwt_required()
def create_dictionary_item():
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            cur.execute("""
                INSERT INTO system_dictionary_items
                    (dict_type, item_code, label_zh, label_ru, value_json, sort_order, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    label_zh = VALUES(label_zh),
                    label_ru = VALUES(label_ru),
                    value_json = VALUES(value_json),
                    sort_order = VALUES(sort_order),
                    is_active = VALUES(is_active)
            """, (
                str(payload.get("dictType") or "").strip(),
                str(payload.get("itemCode") or "").strip(),
                str(payload.get("labelZh") or "").strip(),
                str(payload.get("labelRu") or "").strip(),
                _json_dumps(payload.get("value")) if payload.get("value") is not None else None,
                int(payload.get("sortOrder") or 0),
                1 if payload.get("isActive", True) else 0,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route("/management/dictionary-items/<int:item_id>", methods=["PUT"])
@jwt_required()
def update_dictionary_item(item_id: int):
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            cur.execute("""
                UPDATE system_dictionary_items
                SET label_zh = %s, label_ru = %s, value_json = %s, sort_order = %s, is_active = %s
                WHERE id = %s
            """, (
                str(payload.get("labelZh") or "").strip(),
                str(payload.get("labelRu") or "").strip(),
                _json_dumps(payload.get("value")) if payload.get("value") is not None else None,
                int(payload.get("sortOrder") or 0),
                1 if payload.get("isActive", True) else 0,
                item_id,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()


@bp_v2.route("/management/cockpit/templates/<template_key>", methods=["PUT"])
@jwt_required()
def update_cockpit_template(template_key: str):
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            cur.execute("""
                INSERT INTO dashboard_templates
                    (template_key, title_zh, title_ru, role_scope, config_json, is_active, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    title_zh = VALUES(title_zh),
                    title_ru = VALUES(title_ru),
                    role_scope = VALUES(role_scope),
                    config_json = VALUES(config_json),
                    is_active = VALUES(is_active),
                    sort_order = VALUES(sort_order)
            """, (
                template_key,
                payload.get("titleZh") or template_key,
                payload.get("titleRu") or payload.get("titleZh") or template_key,
                _json_dumps(payload.get("roleScope") or {}),
                _json_dumps(_normalize_template_config(payload.get("config") or {"components": []})),
                1 if payload.get("isActive", True) else 0,
                int(payload.get("sortOrder") or 0),
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()
