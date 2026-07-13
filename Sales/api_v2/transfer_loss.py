import os
from datetime import date, timedelta
from pathlib import Path
import sys

from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from db import get_connection
from config import DB_CONFIG
from .authz import permission_required
import pymysql


ROOT_DIR = Path(__file__).resolve().parents[2]
OILSTATION_DIR = ROOT_DIR / "OilStation"


def _period_bounds(year, quarter):
    today = date.today()
    try:
        y = int(year or today.year)
    except (TypeError, ValueError):
        y = today.year
    try:
        q = int(quarter or ((today.month - 1) // 3 + 1))
    except (TypeError, ValueError):
        q = (today.month - 1) // 3 + 1
    q = min(max(q, 1), 4)
    month = (q - 1) * 3 + 1
    start = date(y, month, 1)
    end = date(y + 1, 1, 1) if month == 10 else date(y, month + 3, 1)
    return start, end


def _retail_connection():
    cfg = dict(DB_CONFIG)
    cfg["database"] = os.getenv("RETAIL_DB_NAME", "ocw")
    cfg["autocommit"] = True
    return pymysql.connect(**cfg)


def _shop_names():
    sys.path.insert(0, str(OILSTATION_DIR))
    try:
        from constants import SHOP_KEY_MAP

        return {
            int(key): (value.get("short") or value.get("name") or f"Station-{key}")
            for key, value in SHOP_KEY_MAP.items()
        }
    finally:
        sys.path = [item for item in sys.path if item != str(OILSTATION_DIR)]


def _route_for_depot(code, name):
    text = f"{code or ''} {name or ''}".lower()
    if "balyk" in text or "балык" in text or "北方" in text:
        return "main_to_north_depot", "Example总库-北方STN-65"
    if "CTY-30" in text or "CTY-05" in text or "CTY-22" in text or "南方" in text:
        return "main_to_south_depot", "Example总库-南方STN-63"
    return "main_to_depot", "Example总库-自营油库"


def _retail_supply_rows(start, end):
    names = _shop_names()
    conn = _retail_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                """
                SELECT DATE(AcceptDateTime) AS supply_date,
                       ShopKey,
                       COALESCE(SUM(NULLIF(Mass, 0)), SUM(NULLIF(MassTTN, 0)), SUM(NULLIF(TankerMass, 0)), 0) / 1000 AS tons,
                       SUM(Volume) AS liters,
                       COUNT(*) AS rows
                FROM supply
                WHERE AcceptDateTime >= %s AND AcceptDateTime < %s
                  AND COALESCE(Deleted, 0) = 0
                GROUP BY DATE(AcceptDateTime), ShopKey
                ORDER BY supply_date DESC, ShopKey
                """,
                (start, end),
            )
            return [
                {
                    "date": row["supply_date"],
                    "shopKey": int(row["ShopKey"] or 0),
                    "name": names.get(int(row["ShopKey"] or 0), f"Station-{row['ShopKey']}"),
                    "tons": round(float(row["tons"] or 0), 3),
                    "liters": round(float(row["liters"] or 0), 3),
                    "rows": int(row["rows"] or 0),
                }
                for row in cur.fetchall()
            ]
    finally:
        conn.close()


def _wholesale_transfer_rows(cur, start, end):
    cur.execute(
        """
        SELECT business_date,
               entity_type,
               entity_code,
               COALESCE(NULLIF(standard_entity_name, ''), raw_entity_name) AS target_name,
               SUM(weight_tons) AS tons,
               COUNT(*) AS rows
        FROM wholesale_detail_records
        WHERE business_date >= %s AND business_date < %s
          AND classification = 'transfer'
        GROUP BY business_date, entity_type, entity_code, COALESCE(NULLIF(standard_entity_name, ''), raw_entity_name)
        ORDER BY business_date DESC, target_name
        """,
        (start, end),
    )
    return cur.fetchall()


def _merge_transfer_loss_years(*groups):
    years = set()
    for group in groups:
        for value in group or []:
            try:
                year = int(value)
            except (TypeError, ValueError):
                continue
            if 2000 <= year <= 2100:
                years.add(year)
    return sorted(years, reverse=True)


def _retail_supply_years():
    conn = _retail_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT YEAR(AcceptDateTime) AS loss_year
                FROM supply
                WHERE AcceptDateTime IS NOT NULL
                  AND COALESCE(Deleted, 0) = 0
                ORDER BY loss_year DESC
                """
            )
            return [row[0] for row in cur.fetchall()]
    finally:
        conn.close()


def _wholesale_transfer_years(cur):
    cur.execute(
        """
        SELECT DISTINCT YEAR(business_date) AS loss_year
        FROM wholesale_detail_records
        WHERE business_date IS NOT NULL
          AND classification = 'transfer'
        ORDER BY loss_year DESC
        """
    )
    return [row["loss_year"] for row in cur.fetchall()]


def _direct_station_index(rows):
    index = {}
    for row in rows:
        if row["entity_type"] != "retail_station":
            continue
        try:
            shop_key = int(row["entity_code"])
        except (TypeError, ValueError):
            continue
        key = (row["business_date"], shop_key)
        item = index.setdefault(key, {"tons": 0.0, "rows": 0})
        item["tons"] += float(row["tons"] or 0)
        item["rows"] += int(row["rows"] or 0)
    return index


def _matched_direct(index, supply_date, shop_key):
    for days in range(1, 4):
        key = (supply_date - timedelta(days=days), shop_key)
        if key in index:
            value = index[key]
            return {
                "date": key[0],
                "tons": round(value["tons"], 3),
                "rows": value["rows"],
                "daysBefore": days,
            }
    return None


@bp_v2.route('/transfer/loss/years', methods=['GET'])
@jwt_required()
@permission_required('transfer_loss:view')
def transfer_loss_years():
    sales_conn = get_connection()
    try:
        with sales_conn.cursor(pymysql.cursors.DictCursor) as cur:
            wholesale_years = _wholesale_transfer_years(cur)
        retail_years = _retail_supply_years()
        years = _merge_transfer_loss_years(retail_years, wholesale_years)
        return jsonify({'code': 0, 'message': 'success', 'data': years})
    finally:
        sales_conn.close()


@bp_v2.route('/transfer/loss', methods=['GET'])
@jwt_required()
@permission_required('transfer_loss:view')
def transfer_loss():
    start, end = _period_bounds(request.args.get('year'), request.args.get('quarter'))
    sales_conn = get_connection()
    try:
        with sales_conn.cursor(pymysql.cursors.DictCursor) as cur:
            wholesale_rows = _wholesale_transfer_rows(cur, start - timedelta(days=3), end)

        direct_index = _direct_station_index(wholesale_rows)
        items = []

        for supply in _retail_supply_rows(start, end):
            matched = _matched_direct(direct_index, supply["date"], supply["shopKey"])
            system_qty = matched["tons"] if matched else 0.0
            actual_qty = supply["tons"]
            loss_qty = round(system_qty - actual_qty, 3) if matched else 0.0
            loss_rate = round(loss_qty / system_qty, 4) if matched and system_qty else 0.0
            if matched:
                route = "Example总库-加油站"
                route_code = "main_to_station"
                evidence = f"{matched['daysBefore']}天前有Example外运称重 {matched['tons']:.3f} 吨"
                evidence_code = "direct_weight_matched"
                report_date = matched["date"]
            else:
                route = "分库-加油站"
                route_code = "depot_to_station"
                evidence = "本日零售有转运，前1-3天未找到Example直发该站称重"
                evidence_code = "retail_without_direct_weight"
                report_date = supply["date"]
            items.append({
                "route": route,
                "route_code": route_code,
                "station_name": supply["name"],
                "target_type": "retail_station",
                "system_qty": system_qty,
                "actual_qty": actual_qty,
                "loss_qty": loss_qty,
                "loss_rate": loss_rate,
                "report_date": report_date.isoformat(),
                "supply_date": supply["date"].isoformat(),
                "evidence": evidence,
                "evidence_code": evidence_code,
                "evidence_days": matched["daysBefore"] if matched else None,
                "evidence_tons": matched["tons"] if matched else 0.0,
                "retail_liters": supply["liters"],
                "rows": supply["rows"],
            })

        for row in wholesale_rows:
            if row["business_date"] < start or row["business_date"] >= end:
                continue
            if row["entity_type"] != "own_depot":
                continue
            tons = round(float(row["tons"] or 0), 3)
            route_code, route = _route_for_depot(row["entity_code"], row["target_name"])
            items.append({
                "route": route,
                "route_code": route_code,
                "station_name": row["target_name"] or row["entity_code"] or "自营油库",
                "target_type": "own_depot",
                "system_qty": tons,
                "actual_qty": 0.0,
                "loss_qty": 0.0,
                "loss_rate": 0.0,
                "report_date": row["business_date"].isoformat(),
                "supply_date": "",
                "evidence": "称重系统显示Example总库外运至自营油库",
                "evidence_code": "main_to_depot_weight",
                "evidence_days": None,
                "evidence_tons": tons,
                "retail_liters": 0.0,
                "rows": int(row["rows"] or 0),
            })

        items.sort(key=lambda item: (item["report_date"], item["route"], item["station_name"]), reverse=True)
        return jsonify({'code': 0, 'message': 'success', 'data': items})
    finally:
        sales_conn.close()
