"""零售「外运实收」(supply) 月度快照 —— 单一事实源。

供两处共用（避免逻辑分叉）：
1) OilStation/scripts/refresh_current_snapshots.py 的每日零售快照流程
   （_refresh_month_snapshots 内调用，set_cached("transfer:{ym}", ...)）。
2) Sales/api_v2/retail_transfer.py 查询端点（月/年模式优先读快照，缺快照回退实时）。

口径与 Sales/api_v2/retail_transfer.py 保持一致：
- 数据源：零售库 ocw.supply（到站实收）。
- 升：VolumeTTN 优先 / Volume；质量：Mass→MassTTN→TankerMass→体积×Density 兜底(kg)。
- 油品归类：export_excel.infer_supply_resource_key；109/110 柴油并入 106(Д/Т)。
- 脏密度修正：按 (站点,油品) 桶好/坏行分离；好行体积>1L 时坏行按好行实测密度回填；
  桶内无好行（全脏）时按油品固定参考密度(DENSITY_SANE_DEF_REF)补质量，保证吨位不失真为 0。
- 展示密度：月/年视图显示的是该月真实加权平均（总质量÷总体积），绝不把固定参考密度
  当作该视图密度显示；固定参考密度只用于给缺质量字段的脏桶回补质量。
- conn 由调用方传入（刷新脚本传 OilStation db 连接；端点传 Sales 零售连接）。
"""
from __future__ import annotations

from datetime import date, datetime

import pymysql

from export_excel import infer_supply_resource_key, DENSITY_SANE_WINDOWS, DENSITY_SANE_DEF_REF

# 展示名（与 OilStation/endpoints/v1/retail/analytics/service/shared.py RESOURCE_NAMES 一致）
RESOURCE_NAMES = {
    102: "АИ 80",
    103: "АИ 92",
    104: "АИ 95",
    106: "Д/Т",
    108: "СПБТ",
    109: "Д/Т",
    110: "Д/Т",
}
# 柴油口径合并：109/110 归并到 106
RESOURCE_ALIASES = {109: 106, 110: 106}

# 2026-06 数据清洗窗口（与 generator.py 月度快照去重一致）
DEDUP_WINDOW = (
    "NOT ((AcceptDateTime >= '2026-06-22 00:00:00' AND AcceptDateTime < '2026-06-23 00:00:00' "
    "AND ShopKey IN (29, 30) AND Volume BETWEEN 50 AND 500) "
    "OR (AcceptDateTime >= '2026-06-17 00:00:00' AND AcceptDateTime < '2026-06-18 00:00:00' "
    "AND ShopKey = 29 AND Volume BETWEEN 50 AND 500))"
)

SOURCE_NOTE = (
    "零售库 supply 表未记录来源库（SupplierShopKey 恒为 0），故不做按来源库拆分；"
    "密度按零售日报「脏密度修正」口径（好/坏行分离，坏行按参考密度回补质量），"
    "展示密度为该月真实加权平均（总质量÷总体积）。"
)


def _liters_expr() -> str:
    return "COALESCE(NULLIF(sp.VolumeTTN,0), NULLIF(sp.Volume,0), 0)"


def _mass_expr() -> str:
    l = _liters_expr()
    return (
        f"COALESCE(NULLIF(sp.Mass,0), NULLIF(sp.MassTTN,0), NULLIF(sp.TankerMass,0), "
        f"{l} * NULLIF(sp.Density,0), 0)"
    )


def _is_sane(rk: int, mass: float, vol: float) -> bool:
    if vol <= 0 or mass <= 0:
        return False
    w = DENSITY_SANE_WINDOWS.get(int(rk))
    if w is None:
        return True
    return w[0] <= mass / vol <= w[1]


def _ym_bounds(ym: str) -> tuple[str, str]:
    year, month = [int(p) for p in ym.split("-")]
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start.isoformat(), end.isoformat()


def _price_ref(conn, start: str, end: str):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT s.ShopKey, s.ResourceKey, AVG(s.BasePrice) AS avg_price
            FROM selling s
            WHERE s.TransactionDatetime >= %s AND s.TransactionDatetime < %s
              AND s.ResourceKey < 100 AND s.BasePrice > 0
            GROUP BY s.ShopKey, s.ResourceKey
            """,
            (start + " 00:00:00", end + " 00:00:00"),
        )
        return {(int(r[0]), int(r[1])): float(r[2] or 0) for r in cur.fetchall()}


def _fetch_supply_rows(conn, ym: str):
    """按 (日, 站, 油品) 聚合 supply 原始行。"""
    start, end = _ym_bounds(ym)
    price_ref = _price_ref(conn, start, end)
    l = _liters_expr()
    m = _mass_expr()
    sql = f"""
        SELECT DATE(sp.AcceptDateTime) AS d,
               sp.ShopKey, sp.ResourceKey, sp.ResourceShopKey,
               SUM({l}) AS liters, SUM({m}) AS raw_mass,
               AVG(sp.Density) AS avg_density, COUNT(*) AS rows
        FROM supply sp
        WHERE sp.AcceptDateTime >= %s AND sp.AcceptDateTime < %s
          AND COALESCE(sp.Deleted,0)=0 AND sp.CollectionKey>0
          AND IFNULL(sp.DocType, IF(sp.VolumeTTN<0,1,0))=0
          AND {DEDUP_WINDOW}
        GROUP BY DATE(sp.AcceptDateTime), sp.ShopKey, sp.ResourceKey, sp.ResourceShopKey
    """
    with conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(sql, (start + " 00:00:00", end + " 00:00:00"))
        raw = cur.fetchall()
    rows = []
    for r in raw:
        sk = int(r["ShopKey"] or 0)
        orig_rk = int(r["ResourceKey"] or 0)
        ds = r["d"]
        tx_date = ds.isoformat() if isinstance(ds, (date, datetime)) else str(ds)
        rk = infer_supply_resource_key(
            sk, orig_rk, r["ResourceShopKey"],
            ref_price=price_ref.get((sk, orig_rk), 0),
            avg_density=float(r["avg_density"] or 0), tx_date=tx_date,
        )
        if rk < 100:
            continue
        rk = RESOURCE_ALIASES.get(rk, rk)
        rows.append({
            "day": tx_date, "month": tx_date[:7], "shopKey": sk, "resourceKey": rk,
            "liters": float(r["liters"] or 0), "rawMass": float(r["raw_mass"] or 0),
            "rows": int(r["rows"] or 0),
        })
    return rows


def _correct_mass(rows):
    """脏密度修正（与零售日报 corrected_mass_from_split 同源）：桶内有好行→坏行按
    好行实测密度回填；无好行（全脏）→按油品固定参考密度补质量，保证吨位不失真为 0。

    展示密度 = 该月数据的真实加权平均（总质量÷总体积），不是把固定参考密度当结果显示。
    """
    buckets = {}
    for r in rows:
        key = (r["shopKey"], r["resourceKey"])
        b = buckets.setdefault(key, {"gv": 0.0, "gm": 0.0})
        if _is_sane(r["resourceKey"], r["rawMass"], r["liters"]):
            b["gv"] += r["liters"]
            b["gm"] += r["rawMass"]
    refs = {}
    for key, b in buckets.items():
        rk = key[1]
        refs[key] = (b["gm"] / b["gv"]) if b["gv"] > 1 else DENSITY_SANE_DEF_REF.get(rk, 0.8)
    for r in rows:
        key = (r["shopKey"], r["resourceKey"])
        if _is_sane(r["resourceKey"], r["rawMass"], r["liters"]):
            r["correctedMass"] = r["rawMass"]
        else:
            r["correctedMass"] = r["liters"] * refs[key]
    return rows


def _agg(rows, key_fn):
    agg = {}
    for r in rows:
        k = key_fn(r)
        it = agg.setdefault(k, {"liters": 0.0, "mass": 0.0, "rows": 0})
        it["liters"] += r["liters"]
        it["mass"] += r["correctedMass"]
        it["rows"] += r["rows"]
    for v in agg.values():
        v["liters"] = round(v["liters"], 3)
        v["mass"] = round(v["mass"], 3)
        v["tons"] = round(v["mass"] / 1000.0, 3)
        v["density"] = round(v["mass"] / v["liters"], 4) if v["liters"] else 0.0
    return agg


def build_transfer_month_snapshot(ym: str, conn) -> dict:
    """构建单月外运快照 payload（无固定兜底密度）。conn 由调用方提供。"""
    rows = _fetch_supply_rows(conn, ym)
    rows = _correct_mass(rows)

    total = _agg(rows, lambda r: 1).get(1, {"liters":0.0,"mass":0.0,"tons":0.0,"density":0.0,"rows":0})
    by_station = [
        {"shopKey": k, **v}
        for k, v in sorted(_agg(rows, lambda r: r["shopKey"]).items(), key=lambda kv: kv[0])
    ]
    by_resource = [
        {"resourceKey": k, "resourceLabel": RESOURCE_NAMES.get(k, f"Other-{k}"), **v}
        for k, v in sorted(_agg(rows, lambda r: r["resourceKey"]).items(),
                           key=lambda kv: kv[1]["tons"], reverse=True)
    ]
    by_day = [
        {"day": k, **v}
        for k, v in sorted(_agg(rows, lambda r: r["day"]).items())
    ]
    station_resources = [
        {"shopKey": sk, "resourceKey": rk,
         "resourceLabel": RESOURCE_NAMES.get(rk, f"Other-{rk}"), **v}
        for (sk, rk), v in sorted(_agg(rows, lambda r: (r["shopKey"], r["resourceKey"])).items(),
                                  key=lambda kv: (kv[0][0], kv[0][1]))
    ]
    return {
        "ym": ym,
        "densityPolicy": "retail-daily-corrected-mass/weighted-avg-density",
        "sourceNote": SOURCE_NOTE,
        "total": {"liters": total["liters"], "mass": total["mass"],
                  "tons": total["tons"], "density": total["density"], "rows": total["rows"]},
        "byStation": by_station,
        "byResource": by_resource,
        "byDay": by_day,
        "stationResources": station_resources,
    }
