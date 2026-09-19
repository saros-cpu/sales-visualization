# -*- coding: utf-8 -*-
"""从 OilStation/constants.py 单向生成 business_points.json（两处副本）。

背景：站点坐标曾有三处副本（constants.py 为主，assets 与 SalesDesktop/public 各一份 JSON），
手工同步迟早漂移。本脚本确立「constants.py 唯一主数据 → JSON 自动生成」的单向关系。

保留项：oil_sources / export_customers 不在 constants.py 中，沿用现有 JSON 内容。

用法：
  python scripts/sync_business_points.py [--check]   # --check 只比对不写入
"""

import argparse
import hashlib
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("c", os.path.join(ROOT, "OilStation", "constants.py"))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

TARGETS = [
    os.path.join(ROOT, "assets", "kgz-map", "data", "business_points.json"),
    os.path.join(ROOT, "SalesDesktop", "public", "kgz-map", "data", "business_points.json"),
]
SOURCE_JSON = TARGETS[0]


def build():
    stations = []
    for sk in sorted(C.SHOP_KEY_MAP):
        info = C.SHOP_KEY_MAP[sk]
        cd = C.SHOP_COORDS.get(sk, {})
        item = {
            "id": sk,
            "type": "station",
            "name": info.get("name", ""),
            "nameRu": info.get("short", ""),
            "region": info.get("region", ""),
            "lng": cd.get("lng"),
            "lat": cd.get("lat"),
        }
        for key in ("source", "accuracy_m", "confirmed_at"):
            if key in cd:
                item[key] = cd[key]
        if sk in C.CLOSED_STATIONS:
            item["status"] = "closed"
            item["closedReason"] = C.CLOSED_STATIONS[sk]
        stations.append(item)

    depots = []
    for name, d in C.DEPOT_COORDS.items():
        item = {
            "type": d.get("type", "depot"),
            "name": name,
            "nameRu": d.get("short", ""),
            "region": d.get("region", ""),
            "lng": d.get("lng"),
            "lat": d.get("lat"),
            "status": d.get("status", "normal"),
        }
        # code 是油库改名后唯一稳定的物理身份，前端地图靠它去重，必须带出。
        if d.get("code"):
            item["code"] = d["code"]
        if d.get("closedReason"):
            item["closedReason"] = d["closedReason"]
        depots.append(item)

    old = {}
    if os.path.exists(SOURCE_JSON):
        old = json.load(open(SOURCE_JSON, encoding="utf-8"))
    return {
        "stations": stations,
        "depots": depots,
        "oil_sources": old.get("oil_sources", []),
        "export_customers": old.get("export_customers", []),
    }


def dump(obj):
    """每项一行紧凑输出，贴近原文件风格（前端按 JSON 解析，格式不影响）。"""
    parts = ["{"]
    keys = list(obj)
    for ki, k in enumerate(keys):
        items = obj[k]
        comma = "," if ki < len(keys) - 1 else ""
        if not items:
            parts.append(f'  "{k}": []{comma}')
            continue
        parts.append(f'  "{k}": [')
        for i, it in enumerate(items):
            tail = "," if i < len(items) - 1 else ""
            parts.append("    " + json.dumps(it, ensure_ascii=False, separators=(",", ":")) + tail)
        parts.append(f"  ]{comma}")
    parts.append("}")
    return "\n".join(parts) + "\n"


def diff_summary(new, path):
    if not os.path.exists(path):
        return ["文件缺失"]
    old = json.load(open(path, encoding="utf-8"))
    msgs = []
    for key in ("stations", "depots"):
        o = {str(x.get("id", x.get("name"))): x for x in old.get(key, [])}
        n = {str(x.get("id", x.get("name"))): x for x in new.get(key, [])}
        for k in sorted(set(o) | set(n)):
            if k not in o:
                msgs.append(f"{key}[{k}] 新增")
            elif k not in n:
                msgs.append(f"{key}[{k}] 缺失")
            elif o[k] != n[k]:
                dd = {kk: (o[k].get(kk), n[k].get(kk)) for kk in set(o[k]) | set(n[k]) if o[k].get(kk) != n[k].get(kk)}
                msgs.append(f"{key}[{k}] 差异 {dd}")
    return msgs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    data = build()
    text = dump(data)

    if args.check:
        for t in TARGETS:
            msgs = diff_summary(data, t)
            tag = "一致" if not msgs else f"★{len(msgs)} 处差异"
            print(f"{tag}  {t}")
            for m in msgs[:20]:
                print("    -", m)
        return

    for t in TARGETS:
        os.makedirs(os.path.dirname(t), exist_ok=True)
        with open(t, "w", encoding="utf-8") as f:
            f.write(text)
        print("已同步", t)
    print("站点", len(data["stations"]), "油库", len(data["depots"]))


if __name__ == "__main__":
    main()
