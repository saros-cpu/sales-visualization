# -*- coding: utf-8 -*-
"""路由表快照护栏：api.py 拆分/重构后，注册路由必须与拆分前快照逐条一致。

用于防回归：任何路由被误删/误加/端点改名都会让本测试失败。
（Flask 自动注册的 static 路由不在快照范围内。）
"""
import json
from pathlib import Path

from api import app


def _load_snapshot():
    path = Path(__file__).resolve().parent / "fixtures" / "route_table_snapshot.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload if isinstance(payload, list) else payload["rules"]
    return {
        (entry["rule"], entry["endpoint"]): sorted(entry.get("methods") or [])
        for entry in entries
    }


def test_route_table_matches_pre_split_snapshot():
    base = _load_snapshot()
    current = {
        (rule.rule, rule.endpoint): sorted(rule.methods - {"HEAD", "OPTIONS"})
        for rule in app.url_map._rules
        if rule.endpoint != "static"
    }
    missing = {k: v for k, v in base.items() if k not in current}
    extra = {k: v for k, v in current.items() if k not in base}
    assert not missing, f"路由缺失（相对拆分前快照）: {sorted(missing)[:10]}"
    assert not extra, f"路由新增（相对拆分前快照）: {sorted(extra)[:10]}"
    assert len(current) == len(base)
