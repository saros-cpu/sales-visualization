"""零售板块「外运实收统计」端点。

数据来源：零售库（ocw）`supply` 表 —— 每个加油站实际收到的油品转运（入库）记录。
与批发板块「外运」（wholesale_detail_records 装车/发货口径）不同，这里是**到站实收**口径，
直接统计各站收到的油品量，不依赖分库发货实时数据，因此比批发外运更完整。

统计维度：站点 × 油品 × 时间（日/月），升/吨/笔数/密度。
注意：零售库 supply 表当前**不记录来源库**（SupplierShopKey 恒为 0、来源名表为空），
故本端点不做"按来源库（总库/分库）拆分"——这是数据层面的客观限制，非实现遗漏。

油品归类复用 export_excel.infer_supply_resource_key（与月度快照/报表同一权威实现），
升/吨口径：`VolumeTTN`（优先）/ `Volume` 计升，`Mass/MassTTN/TankerMass` 兜底 ÷1000 计吨，
与现有 transfer_loss 页面口径一致。

时间选择支持三种模式：
- range：起止日期区间（默认，兼容旧调用）
- year ：按年（参数 year，默认今年）
- month ：按年+月（参数 year、month，默认今年当月）
年/月模式直接走 supply 聚合查询（数据量小，亚秒级返回），不单独建快照。
"""
import sys
from datetime import date, datetime
from pathlib import Path

from flask import request, jsonify
from flask_jwt_extended import jwt_required
from api_v2 import bp_v2
from .authz import permission_required
from .transfer_loss import _retail_connection, _shop_names
import pymysql

ROOT_DIR = Path(__file__).resolve().parents[2]
OILSTATION_DIR = ROOT_DIR / "OilStation"
if str(OILSTATION_DIR) not in sys.path:
    sys.path.insert(0, str(OILSTATION_DIR))

from export_excel import infer_supply_resource_key  # noqa: E402

# 与 OilStation/endpoints/v1/retail/analytics/service/shared.py 的 RESOURCE_NAMES 保持一致
# 柴油口径合并：106/109/110 统一显示为「Д/Т」（-15、-35 全部并入柴油）
RESOURCE_NAMES = {
    102: "АИ 80",
    103: "АИ 92",
    104: "АИ 95",
    106: "Д/Т",
    108: "СПБТ",
    109: "Д/Т",
    110: "Д/Т",
}
# 柴油口径合并：109/110 归并到 106（过滤判定与展示统一使用）
RESOURCE_ALIASES = {109: 106, 110: 106}

# 2026-06 数据清洗窗口（与 generator.py 月度快照去重一致，避免重复计入清理前脏数据）
_DEDUP_WINDOW = (
    "NOT ((sp.AcceptDateTime >= '2026-06-22 00:00:00' AND sp.AcceptDateTime < '2026-06-23 00:00:00' "
    "AND sp.ShopKey IN (29, 30) AND sp.Volume BETWEEN 50 AND 500) "
    "OR (sp.AcceptDateTime >= '2026-06-17 00:00:00' AND sp.AcceptDateTime < '2026-06-18 00:00:00' "
    "AND sp.ShopKey = 29 AND sp.Volume BETWEEN 50 AND 500))"
)


def _parse_date(value, default):
    if not value:
        return default
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return default


def _parse_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _resolve_bounds():
    """根据 mode/year/month/start/end 解析查询起止（左闭右开）。"""
    mode = (request.args.get("mode") or "range").strip()
    today = date.today()
    if mode in ("year", "month"):
        year = _parse_int(request.args.get("year")) or today.year
        if mode == "month":
            month = _parse_int(request.args.get("month"))
            if not (1 <= (month or 0) <= 12):
                month = today.month
            start = date(year, month, 1)
            if month == 12:
                end = date(year + 1, 1, 1)
            else:
                end = date(year, month + 1, 1)
        else:
            start = date(year, 1, 1)
            end = date(year + 1, 1, 1)
        return start, end
    # range 模式
    start = _parse_date(request.args.get("start"), date(today.year, 1, 1))
    end = _parse_date(request.args.get("end"), date(today.year + 1, 1, 1))
    if end <= start:
        end = date(start.year + 1, 1, 1)
    return start, end


def _csv_ints(value):
    if not value:
        return []
    out = []
    for part in str(value).split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def _supply_price_ref(conn, start, end):
    """参考价（来自 selling），供 infer_supply_resource_key 在缺 RSK 时回退推断油品。"""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.ShopKey, s.ResourceKey, AVG(s.BasePrice) AS avg_price
            FROM selling s
            WHERE s.TransactionDatetime >= %s AND s.TransactionDatetime < %s
              AND s.ResourceKey < 100 AND s.BasePrice > 0
            GROUP BY s.ShopKey, s.ResourceKey
            """,
            (start.isoformat() + " 00:00:00", end.isoformat() + " 00:00:00"),
        )
        return {(int(r[0]), int(r[1])): float(r[2] or 0) for r in cur.fetchall()}


def _fetch_rows(start, end, shop_filter):
    conn = _retail_connection()
    try:
        price_ref = _supply_price_ref(conn, start, end)
        names = _shop_names()
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            sql = f"""
                SELECT DATE(sp.AcceptDateTime) AS supply_date,
                       sp.ShopKey,
                       sp.ResourceKey,
                       sp.ResourceShopKey,
                       SUM(sp.VolumeTTN) AS liters_ttn,
                       SUM(sp.Volume) AS liters_raw,
                       SUM(COALESCE(NULLIF(sp.Mass, 0), NULLIF(sp.MassTTN, 0),
                                   NULLIF(sp.TankerMass, 0), 0)) / 1000 AS tons,
                       AVG(sp.Density) AS avg_density,
                       COUNT(*) AS rows
                FROM supply sp
                WHERE sp.AcceptDateTime >= %s AND sp.AcceptDateTime < %s
                  AND COALESCE(sp.Deleted, 0) = 0
                  AND sp.CollectionKey > 0
                  AND IFNULL(sp.DocType, IF(sp.VolumeTTN < 0, 1, 0)) = 0
                  AND {_DEDUP_WINDOW}
            """
            params = [start.isoformat() + " 00:00:00", end.isoformat() + " 00:00:00"]
            if shop_filter:
                sql += " AND sp.ShopKey IN (%s)" % ",".join(["%s"] * len(shop_filter))
                params.extend(shop_filter)
            sql += (
                " GROUP BY DATE(sp.AcceptDateTime), sp.ShopKey, sp.ResourceKey, "
                "sp.ResourceShopKey"
            )
            cur.execute(sql, params)
            raw = cur.fetchall()

        rows = []
        for r in raw:
            sk = int(r["ShopKey"] or 0)
            orig_rk = int(r["ResourceKey"] or 0)
            rsk = r["ResourceShopKey"]
            ds = r["supply_date"]
            tx_date = ds.isoformat() if isinstance(ds, (date, datetime)) else str(ds)
            rk = infer_supply_resource_key(
                sk,
                orig_rk,
                rsk,
                ref_price=price_ref.get((sk, orig_rk), 0),
                avg_density=float(r["avg_density"] or 0),
                tx_date=tx_date,
            )
            if rk < 100:
                continue
            # 柴油口径合并：109/110 归并到 106（展示统一为 Д/Т）
            rk = RESOURCE_ALIASES.get(rk, rk)
            liters = float(r["liters_ttn"] or 0) or float(r["liters_raw"] or 0)
            tons = round(float(r["tons"] or 0), 3)
            name_known = sk in names
            shop_name = names.get(sk, f"Station-{sk}")
            rows.append(
                {
                    "date": tx_date,
                    "month": tx_date[:7],
                    "shopKey": sk,
                    "shopName": shop_name,
                    "nameKnown": name_known,
                    "resourceKey": rk,
                    "resourceLabel": RESOURCE_NAMES.get(rk, f"Other-{rk}"),
                    "liters": round(liters, 3),
                    "tons": tons,
                    "density": round(tons * 1000.0 / liters, 4) if liters else 0.0,
                    "rows": int(r["rows"] or 0),
                }
            )
        return rows
    finally:
        conn.close()


def _aggregate(rows, key_fn):
    agg = {}
    for r in rows:
        key = key_fn(r)
        item = agg.setdefault(key, {"liters": 0.0, "tons": 0.0, "rows": 0})
        item["liters"] += r["liters"]
        item["tons"] += r["tons"]
        item["rows"] += r["rows"]
    for v in agg.values():
        v["liters"] = round(v["liters"], 3)
        v["tons"] = round(v["tons"], 3)
        v["density"] = round(v["tons"] * 1000.0 / v["liters"], 4) if v["liters"] else 0.0
    return agg


def _round_total(d):
    return {
        "liters": round(float(d.get("liters", 0) or 0), 3),
        "tons": round(float(d.get("tons", 0) or 0), 3),
        "rows": int(d.get("rows", 0) or 0),
        "density": round(float(d.get("tons", 0) or 0) * 1000.0 / float(d.get("liters", 0) or 0), 4)
        if d.get("liters")
        else 0.0,
    }


@bp_v2.route("/retail/transfer/stats", methods=["GET"])
@jwt_required()
@permission_required("retail:view")
def retail_transfer_stats():
    start, end = _resolve_bounds()
    name_status = (request.args.get("nameStatus") or "all").strip()
    shop_filter = _csv_ints(request.args.get("shopKey"))
    # 空白名称（未知站）模式下不把 shopKey 下推到 SQL，改为取回后过滤
    sql_shop_filter = shop_filter if name_status != "blank" else []
    resource_filter = _csv_ints(request.args.get("resource"))
    group_by = (request.args.get("groupBy") or "detail").strip()

    rows = _fetch_rows(start, end, sql_shop_filter)

    # 资源过滤（柴油合并后判断）
    if resource_filter:
        merged_set = {RESOURCE_ALIASES.get(rk, rk) for rk in resource_filter}
        rows = [r for r in rows if r["resourceKey"] in merged_set]

    # 站名筛选：blank=仅未知站；known=仅已知站（默认 all 不过滤）
    if name_status == "blank":
        rows = [r for r in rows if not r["nameKnown"]]
    elif name_status == "known":
        rows = [r for r in rows if r["nameKnown"]]

    # 汇总
    total = {"liters": 0.0, "tons": 0.0, "rows": 0}
    for r in rows:
        total["liters"] += r["liters"]
        total["tons"] += r["tons"]
        total["rows"] += r["rows"]

    names = _shop_names()
    by_station = [
        {"shopKey": k, "shopName": names.get(k, f"Station-{k}"), **v}
        for k, v in sorted(
            _aggregate(rows, lambda r: r["shopKey"]).items(),
            key=lambda kv: kv[1]["tons"],
            reverse=True,
        )
    ]
    by_resource = [
        {"resourceKey": k, "resourceLabel": RESOURCE_NAMES.get(k, f"Other-{k}"), **v}
        for k, v in sorted(
            _aggregate(rows, lambda r: r["resourceKey"]).items(),
            key=lambda kv: kv[1]["tons"],
            reverse=True,
        )
    ]
    by_month = [
        {"month": k, **v}
        for k, v in sorted(_aggregate(rows, lambda r: r["month"]).items())
    ]

    group_by_map = {
        "station": by_station,
        "resource": by_resource,
        "month": by_month,
    }
    grouped = group_by_map.get(group_by, rows)

    # 站名下拉数据源（已知站，按名称排序）
    stations = [{"shopKey": k, "shopName": v} for k, v in names.items()]
    stations.sort(key=lambda x: x["shopName"])

    return jsonify(
        {
            "code": 0,
            "message": "success",
            "data": {
                "range": {"start": start.isoformat(), "end": end.isoformat()},
                "sourceNote": "零售库 supply 表未记录来源库（SupplierShopKey 恒为 0），故不做按来源库拆分。",
                "total": _round_total(total),
                "summary": {
                    "byStation": by_station,
                    "byResource": by_resource,
                    "byMonth": by_month,
                },
                "stations": stations,
                "records": grouped,
                "recordCount": len(grouped),
            },
        }
    )
