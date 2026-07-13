"""利润核算维护：站点月度成本项与购油单价。

- 表 `profit_cost_items` 位于 sales_visualization 库，由 ensure_profit_schema 兜底创建
- GET 返回 30 站 × 5 项网格，DB 记录覆盖 profit_station_config.json 默认值
- N 为运费系数（config 的 n_rate），值为 null 表示不做乘法（对应 station 28）
- PUT 传 null/空 value 表示删除该行，回退 config 默认值
- 表 `profit_purchase_prices` 按月维护站点/油品购油单价，DB 记录覆盖历史模板 JSON 与配置默认值
"""
from __future__ import annotations

import json
import importlib.util
import os
from pathlib import Path
from typing import Any

from flask import jsonify, request
from flask_jwt_extended import jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from .management import _require_admin


COST_TYPES: list[dict[str, Any]] = [
    {"costType": "M", "labelZh": "职工薪酬", "labelRu": "Зарплата"},
    {"costType": "N", "labelZh": "运费系数", "labelRu": "Коэффициент транспорта"},
    {"costType": "O", "labelZh": "水电费", "labelRu": "Коммунальные услуги"},
    {"costType": "P", "labelZh": "警民联合服务费", "labelRu": "Охрана"},
    {"costType": "Q", "labelZh": "网费", "labelRu": "Интернет"},
]

COST_TYPE_SET = {item["costType"] for item in COST_TYPES}
RESOURCE_NAMES = {
    102: "АИ 80",
    103: "АИ 92",
    104: "АИ 95",
    106: "Д/Т",
    108: "СПБТ",
    109: "Д/Т",
    110: "ДТ -35",
}

PROFIT_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "profit_station_config.json"
)
PROFIT_PURCHASE_PRICE_OVERRIDES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "profit_purchase_price_overrides.json"
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SHOP_KEY_MAP_CACHE: dict[int, dict[str, str]] | None = None


def _load_profit_config() -> list[dict[str, Any]]:
    with open(PROFIT_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def _load_purchase_price_overrides() -> dict[str, Any]:
    try:
        with open(PROFIT_PURCHASE_PRICE_OVERRIDES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    return data.get("months") or {}


def _load_retail_shop_key_map() -> dict[int, dict[str, str]]:
    global _SHOP_KEY_MAP_CACHE
    if _SHOP_KEY_MAP_CACHE is not None:
        return _SHOP_KEY_MAP_CACHE
    constants_path = PROJECT_ROOT / "OilStation" / "constants.py"
    try:
        spec = importlib.util.spec_from_file_location("_profit_retail_constants", constants_path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        _SHOP_KEY_MAP_CACHE = getattr(module, "SHOP_KEY_MAP", {}) or {}
    except Exception:
        _SHOP_KEY_MAP_CACHE = {}
    return _SHOP_KEY_MAP_CACHE


def _station_display_name(shop_key: int, fallback: str) -> str:
    info = _load_retail_shop_key_map().get(shop_key)
    if not info:
        return fallback
    short = str(info.get("short") or "").strip()
    name = str(info.get("name") or "").strip()
    if short and name:
        return f"{short} / {name}"
    return name or short or fallback


def ensure_profit_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_cost_items (
            id          BIGINT PRIMARY KEY AUTO_INCREMENT,
            month_year  VARCHAR(7) NOT NULL,
            shop_key    INT NOT NULL,
            cost_type   ENUM('M', 'N', 'O', 'P', 'Q') NOT NULL,
            value       DECIMAL(14,2) NOT NULL DEFAULT 0,
            updated_by  BIGINT NULL,
            updated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_month_shop_cost (month_year, shop_key, cost_type),
            KEY idx_month (month_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_purchase_prices (
            id             BIGINT PRIMARY KEY AUTO_INCREMENT,
            month_year     VARCHAR(7) NOT NULL,
            shop_key       INT NOT NULL,
            resource_key   INT NOT NULL,
            purchase_name  VARCHAR(64) NULL,
            purchase_price DECIMAL(14,4) NOT NULL DEFAULT 0,
            updated_by     BIGINT NULL,
            updated_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_month_shop_resource (month_year, shop_key, resource_key),
            KEY idx_month (month_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_report_snapshots (
            id            BIGINT PRIMARY KEY AUTO_INCREMENT,
            snapshot_type ENUM('month', 'year') NOT NULL,
            period_key    VARCHAR(7) NOT NULL,
            payload_json  LONGTEXT NOT NULL,
            generated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_profit_report_snapshot (snapshot_type, period_key),
            KEY idx_period (period_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)


def _month_year(value: str) -> str | None:
    text = (value or "").strip()
    try:
        parts = text.split("-")
        if len(parts) == 2 and 2000 <= int(parts[0]) <= 2100 and 1 <= int(parts[1]) <= 12:
            return f"{int(parts[0]):04d}-{int(parts[1]):02d}"
    except ValueError:
        pass
    return None


def _invalidate_profit_snapshots(cur, month: str) -> None:
    year = month.split("-", 1)[0]
    cur.execute(
        """
        DELETE FROM profit_report_snapshots
        WHERE (snapshot_type = 'month' AND period_key = %s)
           OR (snapshot_type = 'year' AND period_key = %s)
        """,
        (month, year),
    )


def _build_station_grid(cur, month: str) -> list[dict[str, Any]]:
    cur.execute("""
        SELECT shop_key, cost_type, value, updated_at
        FROM profit_cost_items
        WHERE month_year = %s
        ORDER BY shop_key, cost_type
    """, (month,))
    rows = cur.fetchall()
    overrides: dict[tuple[int, str], dict[str, Any]] = {}
    for row in rows:
        overrides[(int(row["shop_key"]), row["cost_type"])] = {
            "value": float(row["value"]),
            "updatedAt": row["updated_at"].isoformat(sep=" ") if row.get("updated_at") else None,
        }

    stations: list[dict[str, Any]] = []
    for station in _load_profit_config():
        shop_key = int(station["shopKey"])
        items: dict[str, dict[str, Any]] = {}
        for cost in COST_TYPES:
            cost_type = cost["costType"]
            override = overrides.get((shop_key, cost_type))
            if override is not None:
                items[cost_type] = {
                    "value": override["value"],
                    "source": "db",
                    "updatedAt": override["updatedAt"],
                }
                continue
            if cost_type == "N":
                default = station.get("n_rate")
            else:
                default = station.get(cost_type)
            items[cost_type] = {
                "value": None if default is None else float(default),
                "source": "config",
                "updatedAt": None,
            }
        stations.append({
            "shopKey": shop_key,
            "name": _station_display_name(shop_key, station.get("name", "")),
            "items": items,
        })
    return stations


def _purchase_defaults_for_month(month: str) -> dict[tuple[int, int], dict[str, Any]]:
    defaults: dict[tuple[int, int], dict[str, Any]] = {}
    for station in _load_profit_config():
        shop_key = int(station["shopKey"])
        for row in station.get("rows") or []:
            try:
                resource_key = int(row.get("rk"))
            except (TypeError, ValueError):
                continue
            defaults[(shop_key, resource_key)] = {
                "purchaseProduct": row.get("H") or RESOURCE_NAMES.get(resource_key, f"Other-{resource_key}"),
                "purchasePrice": None if row.get("I") is None else float(row.get("I")),
                "source": "config",
                "updatedAt": None,
            }

    raw_month = _load_purchase_price_overrides().get(month) or {}
    for shop_key, rows in raw_month.items():
        try:
            shop_key_int = int(shop_key)
        except (TypeError, ValueError):
            continue
        for resource_key, value in (rows or {}).items():
            try:
                resource_key_int = int(resource_key)
            except (TypeError, ValueError):
                continue
            current = defaults.setdefault((shop_key_int, resource_key_int), {})
            current.update({
                "purchaseProduct": (value or {}).get("H") or current.get("purchaseProduct") or RESOURCE_NAMES.get(resource_key_int, f"Other-{resource_key_int}"),
                "purchasePrice": None if (value or {}).get("I") is None else float((value or {}).get("I")),
                "source": "template",
                "updatedAt": None,
            })
    return defaults


def _build_purchase_price_grid(cur, month: str) -> list[dict[str, Any]]:
    defaults = _purchase_defaults_for_month(month)
    cur.execute("""
        SELECT shop_key, resource_key, purchase_name, purchase_price, updated_at
        FROM profit_purchase_prices
        WHERE month_year = %s
        ORDER BY shop_key, resource_key
    """, (month,))
    overrides: dict[tuple[int, int], dict[str, Any]] = {}
    for row in cur.fetchall():
        shop_key = int(row["shop_key"])
        resource_key = int(row["resource_key"])
        fallback = defaults.get((shop_key, resource_key), {})
        overrides[(shop_key, resource_key)] = {
            "purchaseProduct": row.get("purchase_name") or fallback.get("purchaseProduct") or RESOURCE_NAMES.get(resource_key, f"Other-{resource_key}"),
            "purchasePrice": float(row["purchase_price"]),
            "source": "db",
            "updatedAt": row["updated_at"].isoformat(sep=" ") if row.get("updated_at") else None,
        }

    by_station: dict[int, list[dict[str, Any]]] = {}
    for (shop_key, resource_key), default in sorted(defaults.items()):
        item = overrides.get((shop_key, resource_key), default)
        by_station.setdefault(shop_key, []).append({
            "resourceKey": resource_key,
            "product": RESOURCE_NAMES.get(resource_key, f"Other-{resource_key}"),
            "purchaseProduct": item.get("purchaseProduct") or RESOURCE_NAMES.get(resource_key, f"Other-{resource_key}"),
            "purchasePrice": item.get("purchasePrice"),
            "source": item.get("source") or "config",
            "updatedAt": item.get("updatedAt"),
        })

    stations: list[dict[str, Any]] = []
    for station in _load_profit_config():
        shop_key = int(station["shopKey"])
        rows = sorted(by_station.get(shop_key, []), key=lambda item: int(item["resourceKey"]))
        stations.append({
            "shopKey": shop_key,
            "name": _station_display_name(shop_key, station.get("name", "")),
            "rows": rows,
        })
    return stations


@bp_v2.route("/profit/cost-types", methods=["GET"])
@jwt_required()
def profit_cost_types():
    return jsonify({"code": 0, "message": "success", "data": COST_TYPES})


@bp_v2.route("/profit/cost-items", methods=["GET"])
@jwt_required()
def list_profit_cost_items():
    month = _month_year(request.args.get("month") or "")
    if not month:
        return jsonify({"code": 4000, "message": "invalid month, expected YYYY-MM", "data": None}), 400
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            ensure_profit_schema(cur)
            stations = _build_station_grid(cur, month)
            conn.commit()
            return jsonify({
                "code": 0,
                "message": "success",
                "data": {"month": month, "stations": stations},
            })
    finally:
        conn.close()


@bp_v2.route("/profit/cost-items", methods=["PUT"])
@jwt_required()
def upsert_profit_cost_items():
    payload = request.get_json() or {}
    month = _month_year(str(payload.get("month") or ""))
    if not month:
        return jsonify({"code": 4000, "message": "invalid month, expected YYYY-MM", "data": None}), 400
    raw_items = payload.get("items") or []
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            ensure_profit_schema(cur)
            upserts = []
            deletes = []
            for raw in raw_items:
                try:
                    shop_key = int(raw.get("shopKey"))
                except (TypeError, ValueError):
                    continue
                cost_type = str(raw.get("costType") or "").upper()
                if cost_type not in COST_TYPE_SET:
                    continue
                raw_value = raw.get("value")
                if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
                    deletes.append((month, shop_key, cost_type))
                    continue
                try:
                    value = round(float(raw_value), 2)
                except (TypeError, ValueError):
                    continue
                upserts.append((month, shop_key, cost_type, value, admin["id"]))
            if deletes:
                cur.executemany("""
                    DELETE FROM profit_cost_items
                    WHERE month_year = %s AND shop_key = %s AND cost_type = %s
                """, deletes)
            if upserts:
                cur.executemany("""
                    INSERT INTO profit_cost_items (month_year, shop_key, cost_type, value, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)
                """, upserts)
            if upserts or deletes:
                _invalidate_profit_snapshots(cur, month)
            conn.commit()
            return jsonify({
                "code": 0,
                "message": "success",
                "data": {"month": month, "saved": len(upserts), "deleted": len(deletes)},
            })
    finally:
        conn.close()


@bp_v2.route("/profit/purchase-prices", methods=["GET"])
@jwt_required()
def list_profit_purchase_prices():
    month = _month_year(request.args.get("month") or "")
    if not month:
        return jsonify({"code": 4000, "message": "invalid month, expected YYYY-MM", "data": None}), 400
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            ensure_profit_schema(cur)
            stations = _build_purchase_price_grid(cur, month)
            conn.commit()
            return jsonify({
                "code": 0,
                "message": "success",
                "data": {"month": month, "stations": stations},
            })
    finally:
        conn.close()


@bp_v2.route("/profit/purchase-prices", methods=["PUT"])
@jwt_required()
def upsert_profit_purchase_prices():
    payload = request.get_json() or {}
    month = _month_year(str(payload.get("month") or ""))
    if not month:
        return jsonify({"code": 4000, "message": "invalid month, expected YYYY-MM", "data": None}), 400
    raw_items = payload.get("items") or []
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            admin = _require_admin(cur)
            if isinstance(admin, tuple):
                return admin
            ensure_profit_schema(cur)
            upserts = []
            deletes = []
            for raw in raw_items:
                try:
                    shop_key = int(raw.get("shopKey"))
                    resource_key = int(raw.get("resourceKey"))
                except (TypeError, ValueError):
                    continue
                raw_price = raw.get("purchasePrice")
                if raw_price is None or (isinstance(raw_price, str) and not raw_price.strip()):
                    deletes.append((month, shop_key, resource_key))
                    continue
                try:
                    purchase_price = round(float(raw_price), 4)
                except (TypeError, ValueError):
                    continue
                purchase_name = str(raw.get("purchaseProduct") or "").strip() or None
                upserts.append((month, shop_key, resource_key, purchase_name, purchase_price, admin["id"]))
            if deletes:
                cur.executemany("""
                    DELETE FROM profit_purchase_prices
                    WHERE month_year = %s AND shop_key = %s AND resource_key = %s
                """, deletes)
            if upserts:
                cur.executemany("""
                    INSERT INTO profit_purchase_prices
                        (month_year, shop_key, resource_key, purchase_name, purchase_price, updated_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        purchase_name = VALUES(purchase_name),
                        purchase_price = VALUES(purchase_price),
                        updated_by = VALUES(updated_by)
                """, upserts)
            if upserts or deletes:
                _invalidate_profit_snapshots(cur, month)
            conn.commit()
            return jsonify({
                "code": 0,
                "message": "success",
                "data": {"month": month, "saved": len(upserts), "deleted": len(deletes)},
            })
    finally:
        conn.close()
