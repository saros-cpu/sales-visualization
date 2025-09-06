from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from services.retail_alert_service import latest_retail_alert_insights
from shared_utils import OILSTATION_ROOT
from .assistant import ensure_ai_call_schema
from .audit_logs import ensure_audit_schema
from .permission_service import has_permission, list_user_roles
from .system import _cache_items


KPI_CATALOG: list[dict[str, Any]] = [
    {"key": "retail_sales_amount", "titleZh": "零售销售额", "titleRu": "Выручка розницы", "unit": "сом", "precision": 0, "group": "retail", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_volume_liters", "titleZh": "零售销量", "titleRu": "Объем розницы", "unit": "L", "precision": 0, "group": "retail", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_active_shops", "titleZh": "活跃站点", "titleRu": "Активные АЗС", "unit": "站", "precision": 0, "group": "retail", "goodWhen": "up", "permissionCode": "retail:view"},
    {"key": "retail_trend_anomalies", "titleZh": "趋势异常", "titleRu": "Аномалии тренда", "unit": "条", "precision": 0, "group": "retail", "goodWhen": "down", "permissionCode": "retail:view"},
    {"key": "retail_ai_suggestions", "titleZh": "运营建议", "titleRu": "Рекомендации", "unit": "条", "precision": 0, "group": "retail", "goodWhen": "neutral", "permissionCode": "retail:view"},
    {"key": "yearly_wholesale_tons", "titleZh": "年批发吨数", "titleRu": "Опт за год", "unit": "t", "precision": 1, "group": "wholesale", "goodWhen": "up", "permissionCode": "wholesale:view"},
    {"key": "yearly_procurement_tons", "titleZh": "年采购吨数", "titleRu": "Закупки за год", "unit": "t", "precision": 1, "group": "procurement", "goodWhen": "up", "permissionCode": "procurement:view"},
    {"key": "contract_active", "titleZh": "有效合同", "titleRu": "Активные договоры", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "up", "permissionCode": "contracts:view"},
    {"key": "contract_total", "titleZh": "合同总数", "titleRu": "Всего договоров", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "neutral", "permissionCode": "contracts:view"},
    {"key": "contract_appendix_missing", "titleZh": "附件编号缺失", "titleRu": "Нет номера приложения", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "down", "permissionCode": "contracts:view"},
    {"key": "contract_expiring_30d", "titleZh": "30天内到期合同", "titleRu": "Истекают за 30 дней", "unit": "份", "precision": 0, "group": "contracts", "goodWhen": "down", "permissionCode": "contracts:view"},
    {"key": "train_entry_today_rows", "titleZh": "今日录入行数", "titleRu": "Строк ввода сегодня", "unit": "条", "precision": 0, "group": "entry", "goodWhen": "neutral", "permissionCode": "train_entry:view"},
    {"key": "material_transfer_today", "titleZh": "今日调拨单", "titleRu": "Перемещений сегодня", "unit": "单", "precision": 0, "group": "materials", "goodWhen": "neutral", "permissionCode": "materials:view"},
    {"key": "material_transfer_pending", "titleZh": "待处理调拨", "titleRu": "Перемещения в ожидании", "unit": "单", "precision": 0, "group": "materials", "goodWhen": "down", "permissionCode": "materials:view"},
    {"key": "api_failed_24h", "titleZh": "24小时接口失败", "titleRu": "CTY-05ибки API за 24ч", "unit": "次", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "ai_failed_7d", "titleZh": "7天 AI 失败", "titleRu": "CTY-05ибки AI за 7 дней", "unit": "次", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "automation_failed", "titleZh": "失败自动任务", "titleRu": "Сбой автозадач", "unit": "项", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
    {"key": "cache_missing", "titleZh": "缓存异常项", "titleRu": "Проблемы кэша", "unit": "项", "precision": 0, "group": "system", "goodWhen": "down", "adminOnly": True, "permissionCode": "system_health:view"},
]


DEFAULT_CONFIGS = [
    ("ai.openrouter.free_only", "true", "boolean", "ai", "OpenRouter 仅使用免费模型", "OpenRouter только бесплатные модели"),
    ("ai.agent.read_only", "true", "boolean", "ai", "AI 助手只读模式", "AI помощник только чтение"),
    ("retail.alert.daily_generate", "true", "boolean", "retail_alert", "每日生成零售趋势异常和运营建议", "Ежедневно формировать розничные аномалии и рекомендации"),
    ("retail.alert.generate_time", "08:40", "time", "retail_alert", "零售预警生成时间", "Время формирования розничных оповещений"),
    ("automation.retail_snapshot.includes_self_use", "true", "boolean", "automation", "零售快照包含自用油快照", "Розничные снимки включают собственный расход"),
    ("dashboard.cockpit.enabled", "true", "boolean", "dashboard", "启用可视化舱", "Включить визуальную панель"),
]


DEFAULT_DICTIONARY_ITEMS = [
    ("dashboard_component_type", "kpi", "KPI 指标卡", "KPI карточка", 10),
    ("dashboard_component_type", "retail_alert", "零售预警摘要", "Сводка оповещений розницы", 20),
    ("data_source", "retail", "零售数据", "Розничные данные", 10),
    ("data_source", "contracts", "合同数据", "Договоры", 20),
    ("data_source", "materials", "物资调拨", "Перемещение материалов", 30),
    ("data_source", "system", "系统健康", "Состояние системы", 40),
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
                {"id": "retail_sales", "type": "kpi", "metricKey": "retail_sales_amount", "span": 6, "visible": True},
                {"id": "retail_volume", "type": "kpi", "metricKey": "retail_volume_liters", "span": 6, "visible": True},
                {"id": "active_contracts", "type": "kpi", "metricKey": "contract_active", "span": 6, "visible": True},
                {"id": "wholesale_tons", "type": "kpi", "metricKey": "yearly_wholesale_tons", "span": 6, "visible": True},
                {"id": "retail_alerts", "type": "retail_alert", "span": 24, "visible": True},
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
                {"id": "today_entries", "type": "kpi", "metricKey": "train_entry_today_rows", "span": 6, "visible": True},
                {"id": "material_today", "type": "kpi", "metricKey": "material_transfer_today", "span": 6, "visible": True},
                {"id": "material_pending", "type": "kpi", "metricKey": "material_transfer_pending", "span": 6, "visible": True},
                {"id": "contract_missing_appendix", "type": "kpi", "metricKey": "contract_appendix_missing", "span": 6, "visible": True},
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
                {"id": "api_failed", "type": "kpi", "metricKey": "api_failed_24h", "span": 6, "visible": True},
                {"id": "ai_failed", "type": "kpi", "metricKey": "ai_failed_7d", "span": 6, "visible": True},
                {"id": "automation_failed", "type": "kpi", "metricKey": "automation_failed", "span": 6, "visible": True},
                {"id": "cache_missing", "type": "kpi", "metricKey": "cache_missing", "span": 6, "visible": True},
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


def _metric_values(cur) -> dict[str, dict[str, Any]]:
    today = date.today()
    year_start = today.replace(month=1, day=1)
    active_month = _active_month()
    monthly = _read_json(_monthly_snapshot_path(active_month)) or {}
    retail_summary = monthly.get("summary") or {}
    try:
        insight = latest_retail_alert_insights(active_month, language="zh")
    except Exception:
        insight = {"trendAnomalies": [], "suggestions": []}

    ensure_audit_schema(cur)
    ensure_ai_call_schema(cur)
    cache_items = _cache_items()
    values = {
        "retail_sales_amount": _num(retail_summary.get("totalSales")),
        "retail_volume_liters": _num(retail_summary.get("totalLiters")),
        "retail_active_shops": _num(retail_summary.get("activeShops")),
        "retail_trend_anomalies": len(insight.get("trendAnomalies") or []),
        "retail_ai_suggestions": len(insight.get("suggestions") or []),
        "yearly_wholesale_tons": _safe_scalar(cur, """
            SELECT COALESCE(SUM(weight_tons), 0)
            FROM wholesale_detail_records
            WHERE business_date >= %s AND business_date <= %s
        """, (year_start, today)),
        "yearly_procurement_tons": _safe_scalar(cur, """
            SELECT COALESCE(SUM(weight_tons), 0)
            FROM wholesale_detail_records
            WHERE classification = 'procurement' AND business_date >= %s AND business_date <= %s
        """, (year_start, today)),
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
    result: dict[str, dict[str, Any]] = {}
    for metric in KPI_CATALOG:
        result[metric["key"]] = {
            "value": values.get(metric["key"], 0),
            "updatedAt": datetime.now().isoformat(sep=" ", timespec="seconds"),
            "status": "ok",
            "source": metric["group"],
        }
    return result


def _metric_allowed(cur, metric: dict[str, Any], user: dict[str, Any]) -> bool:
    if user["role"] == "admin":
        return True
    if metric.get("adminOnly"):
        return False
    permission_code = metric.get("permissionCode")
    if not permission_code:
        return True
    return has_permission(cur, user["id"], permission_code, user["role"])


def _template_allowed(template: dict[str, Any], roles: set[str]) -> bool:
    role_scope = template.get("roleScope") or {}
    allowed_roles = set(role_scope.get("roles") or [])
    if not allowed_roles:
        return True
    return bool(roles & allowed_roles)


def _visible_templates(cur, user: dict[str, Any]) -> list[dict[str, Any]]:
    roles = _role_codes(cur, user)
    templates = [template for template in _list_templates(cur) if template.get("isActive")]
    allowed_templates = [template for template in templates if _template_allowed(template, roles)]
    allowed_metrics = {metric["key"] for metric in KPI_CATALOG if _metric_allowed(cur, metric, user)}
    for template in allowed_templates:
        components = []
        for component in (template.get("config") or {}).get("components") or []:
            if component.get("visible") is False:
                continue
            metric_key = component.get("metricKey")
            if component.get("type") == "kpi" and metric_key not in allowed_metrics:
                continue
            if component.get("adminOnly") and user["role"] != "admin":
                continue
            components.append(component)
        template["config"] = {**(template.get("config") or {}), "components": components}
    return allowed_templates


@bp_v2.route("/cockpit", methods=["GET"])
@jwt_required()
def cockpit():
    language = "ru" if (request.args.get("lang") or request.args.get("language") or "").lower().startswith("ru") else "zh"
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_management_schema(cur)
            user = _current_user(cur)
            if not user:
                return jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401
            if user["role"] != "admin" and not has_permission(cur, user["id"], "dashboard:view", user["role"]):
                return _forbidden()
            metrics = _metric_values(cur)
            catalog = [metric for metric in KPI_CATALOG if _metric_allowed(cur, metric, user)]
            templates = _visible_templates(cur, user)
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {
                "templates": templates,
                "metrics": metrics,
                "kpiCatalog": catalog,
                "retailAlert": latest_retail_alert_insights(language=language),
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
                "kpiCatalog": KPI_CATALOG,
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
                UPDATE dashboard_templates
                SET title_zh = %s, title_ru = %s, role_scope = %s, config_json = %s,
                    is_active = %s, sort_order = %s
                WHERE template_key = %s
            """, (
                payload.get("titleZh") or template_key,
                payload.get("titleRu") or payload.get("titleZh") or template_key,
                _json_dumps(payload.get("roleScope") or {}),
                _json_dumps(payload.get("config") or {"components": []}),
                1 if payload.get("isActive", True) else 0,
                int(payload.get("sortOrder") or 0),
                template_key,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()
