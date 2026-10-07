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

from export_excel import (  # noqa: E402
    infer_supply_resource_key,
    DENSITY_SANE_WINDOWS,
    DENSITY_SANE_DEF_REF,
)


def _shop_names_bi():
    """返回 {shopKey: {zh, ru}} 双语站名。zh=中文 name，ru=俄文 short。"""
    sys.path.insert(0, str(OILSTATION_DIR))
    try:
        from constants import SHOP_KEY_MAP

        return {
            int(key): {
                "zh": value.get("name") or f"Station-{key}",
                "ru": value.get("short") or value.get("name") or f"Station-{key}",
            }
            for key, value in SHOP_KEY_MAP.items()
        }
    finally:
        sys.path = [item for item in sys.path if item != str(OILSTATION_DIR)]

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


def _supply_liters_expr():
    return "COALESCE(NULLIF(sp.VolumeTTN, 0), NULLIF(sp.Volume, 0), 0)"


def _supply_mass_expr():
    """质量兜底链路（与零售日报 _selling_mass_expr 同源）：优先真实质量字段，
    缺失时退回 体积×密度，避免质量字段为空时密度为 0。"""
    liters = _supply_liters_expr()
    return (
        f"COALESCE(NULLIF(sp.Mass, 0), NULLIF(sp.MassTTN, 0), NULLIF(sp.TankerMass, 0), "
        f"{liters} * NULLIF(sp.Density, 0), 0)"
    )


def _is_sane(rk, mass, vol):
    """行级：该行隐含密度（质量/体积）是否落在油品合理窗口内（脏密度修正口径）。"""
    if vol <= 0 or mass <= 0:
        return False
    window = DENSITY_SANE_WINDOWS.get(int(rk))
    if window is None:
        return True
    implied = mass / vol
    return window[0] <= implied <= window[1]


def _fetch_rows(start, end, shop_filter):
    conn = _retail_connection()
    try:
        price_ref = _supply_price_ref(conn, start, end)
        names = _shop_names_bi()
        liters_expr = _supply_liters_expr()
        mass_expr = _supply_mass_expr()
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            sql = f"""
                SELECT DATE(sp.AcceptDateTime) AS supply_date,
                       sp.ShopKey,
                       sp.ResourceKey,
                       sp.ResourceShopKey,
                       SUM({liters_expr}) AS liters,
                       SUM({mass_expr}) AS raw_mass,
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
            liters = float(r["liters"] or 0)
            raw_mass = float(r["raw_mass"] or 0)
            rows.append(
                {
                    "month": tx_date[:7],
                    "shopKey": sk,
                    "resourceKey": rk,
                    "liters": round(liters, 3),
                    "rawMass": round(raw_mass, 3),
                    "nameKnown": sk in names,
                    "rows": int(r["rows"] or 0),
                }
            )
        return rows
    finally:
        conn.close()


def _enrich_corrected_mass(rows):
    """脏密度修正（与零售日报 report_mass_expr / corrected_mass_from_split 同源）：
    按 (站点, 油品) 桶做好/坏行分离——坏行体积按桶内好行实测密度回填（好行体积<=1L
    才退回油品固定参考密度，用于给全脏桶补出合理吨位）。

    注意展示口径：各视图(区间/月/年)最终显示的密度 = 该视图数据的**真实加权平均**
    (总修正质量 ÷ 总体积)，不是把某个固定密度当结果显示；固定参考密度只用于给
    缺质量字段的脏桶补质量，绝不直接当作该视图的密度。
    """
    buckets = {}
    for r in rows:
        key = (r["shopKey"], r["resourceKey"])
        b = buckets.setdefault(key, {"gv": 0.0, "gm": 0.0, "bv": 0.0})
        if _is_sane(r["resourceKey"], r["rawMass"], r["liters"]):
            b["gv"] += r["liters"]
            b["gm"] += r["rawMass"]
        else:
            b["bv"] += r["liters"]
    ref_map = {}
    for key, b in buckets.items():
        rk = key[1]
        ref_map[key] = (b["gm"] / b["gv"]) if b["gv"] > 1 else DENSITY_SANE_DEF_REF.get(rk, 0.8)
    for r in rows:
        key = (r["shopKey"], r["resourceKey"])
        if _is_sane(r["resourceKey"], r["rawMass"], r["liters"]):
            corrected = r["rawMass"]
        else:
            corrected = r["liters"] * ref_map[key]
        r["correctedMass"] = round(corrected, 3)
    return rows


def _aggregate(rows, key_fn):
    agg = {}
    for r in rows:
        key = key_fn(r)
        item = agg.setdefault(key, {"liters": 0.0, "mass": 0.0, "rows": 0})
        item["liters"] += r["liters"]
        item["mass"] += r["correctedMass"]
        item["rows"] += r["rows"]
    for v in agg.values():
        v["liters"] = round(v["liters"], 3)
        v["mass"] = round(v["mass"], 3)
        v["tons"] = round(v["mass"] / 1000.0, 3)
        v["density"] = round(v["mass"] / v["liters"], 4) if v["liters"] else 0.0
    return agg


def _round_total(d):
    liters = float(d.get("liters", 0) or 0)
    mass = float(d.get("mass", 0) or 0)
    return {
        "liters": round(liters, 3),
        "tons": round(mass / 1000.0, 3),
        "rows": int(d.get("rows", 0) or 0),
        "density": round(mass / liters, 4) if liters else 0.0,
    }


_SNAPSHOT_STORE = None


def _transfer_snapshot_store():
    """按文件路径加载 OilStation 的 cache_store 模块（避免与 Sales 同名模块冲突）。"""
    global _SNAPSHOT_STORE
    if _SNAPSHOT_STORE is None:
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "oil_cache_store_transfer", OILSTATION_DIR / "cache_store.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _SNAPSHOT_STORE = module
    return _SNAPSHOT_STORE


def _target_months(mode, start):
    """按 mode 返回查询涉及的月份 [ym,...]；range 模式返回 None（走实时）。"""
    if mode == "month":
        return [f"{start.year:04d}-{start.month:02d}"]
    if mode == "year":
        return [f"{start.year:04d}-{m:02d}" for m in range(1, 13)]
    return None


def _all_completed(months):
    """所有月份是否都已结束（严格早于当前月）。含当前月/未来月则返回 False→走实时。"""
    today = date.today()
    cur = (today.year, today.month)
    for ym in months:
        y, m = [int(p) for p in ym.split("-")]
        if (y, m) >= cur:
            return False
    return True


def _rows_from_snapshots(months, names):
    """从外运月快照构建 rows（station×resource 粒度）。任一月缺快照返回 None→回退实时。"""
    if not months:
        return None
    store = _transfer_snapshot_store()
    rows = []
    for ym in months:
        snap = store.get_cached(f"transfer:{ym}")
        if not snap:
            return None
        for sr in snap.get("stationResources") or []:
            sk = int(sr["shopKey"])
            rows.append(
                {
                    "month": ym,
                    "shopKey": sk,
                    "resourceKey": int(sr["resourceKey"]),
                    "liters": float(sr.get("liters", 0) or 0),
                    "correctedMass": float(sr.get("mass", 0) or 0),
                    "nameKnown": sk in names,
                    "rows": int(sr.get("rows", 0) or 0),
                }
            )
    return rows


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
    mode = (request.args.get("mode") or "range").strip()

    names = _shop_names_bi()
    from_snapshot = False
    rows = None
    # 月/年模式且全部月份已结束 → 优先读外运月快照（每日零售快照流程已构建，快且口径一致）
    target_months = _target_months(mode, start)
    if target_months and _all_completed(target_months):
        rows = _rows_from_snapshots(target_months, names)
        from_snapshot = rows is not None
    if not from_snapshot:
        rows = _fetch_rows(start, end, sql_shop_filter)
        # 脏密度修正：好/坏行分离，坏行按参考密度回补质量（零售日报口径）。
        # 展示密度 = 该视图数据真实加权平均（总质量÷总体积），非固定值。
        rows = _enrich_corrected_mass(rows)
    elif shop_filter:
        # 快照路径的 shopKey 过滤在内存中做（实时路径已下推 SQL）
        wanted = set(shop_filter)
        rows = [r for r in rows if r["shopKey"] in wanted]

    # 资源过滤（柴油合并后判断）
    if resource_filter:
        merged_set = {RESOURCE_ALIASES.get(rk, rk) for rk in resource_filter}
        rows = [r for r in rows if r["resourceKey"] in merged_set]

    # 站名筛选：blank=仅未知站；known=仅已知站（默认 all 不过滤）
    if name_status == "blank":
        rows = [r for r in rows if not r["nameKnown"]]
    elif name_status == "known":
        rows = [r for r in rows if r["nameKnown"]]

    # 汇总（修正质量）
    total = _round_total(
        _aggregate(rows, lambda r: 1).get(1, {"liters": 0.0, "mass": 0.0, "rows": 0})
    )

    names = _shop_names_bi()
    by_station = [
        {"shopKey": k, "shopName": names.get(k, {}).get("zh", f"Station-{k}"), **v}
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
    # 站×油品（按加油站编号顺序）：未选站时显示全站各油品，选中站时仅该站油品
    agg_sr = _aggregate(rows, lambda r: (r["shopKey"], r["resourceKey"]))
    by_station_resource = [
        {
            "shopKey": sk,
            "shopName": names.get(sk, {}).get("zh", f"Station-{sk}"),
            "resourceKey": rk,
            "resourceLabel": RESOURCE_NAMES.get(rk, f"Other-{rk}"),
            **v,
        }
        for (sk, rk), v in sorted(
            agg_sr.items(), key=lambda kv: (kv[0][0], kv[0][1])
        )
    ]

    group_by_map = {
        "station": by_station,
        "resource": by_resource,
        "month": by_month,
        "station_resource": by_station_resource,
    }
    grouped = group_by_map.get(group_by, by_station_resource)

    # 站名下拉数据源（已知站，按加油站编号排序；双语 zh/ru）
    stations = [
        {"shopKey": k, "nameZh": v["zh"], "nameRu": v["ru"]}
        for k, v in names.items()
    ]
    stations.sort(key=lambda x: x["shopKey"])

    return jsonify(
        {
            "code": 0,
            "message": "success",
            "data": {
                "range": {"start": start.isoformat(), "end": end.isoformat()},
                "sourceNote": (
                    "零售库 supply 表未记录来源库（SupplierShopKey 恒为 0），故不做按来源库拆分；"
                    "密度按零售日报「脏密度修正」口径（好/坏行分离，坏行按参考密度回填）。"
                ),
                "total": total,
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
