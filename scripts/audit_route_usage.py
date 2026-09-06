from __future__ import annotations

"""audit_route_usage.py — 解析 nginx access.log，统计生产真实调用的 API/页面路径。

用途（整改方案 任务2 证据层A）：
  1. 找出日志窗口内"真正被调用"的路由，作为判定死路由的第一层证据。
  2. 输出归一化后的 方法+路径 -> 调用次数 / 最后调用时间 / 状态码分布。

注意：
  - 日志仅保留约 7 周，年度/月末类接口可能是季节性的，缺失只是信号不是结论。
  - 需结合 测试套件(层B)/源码调用方(层C)/文档(层D) 交叉验证后再判定死路由。

用法：
  python scripts/audit_route_usage.py [--log logs/access.log] [--json outputs/route_usage.json]
"""

import argparse
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG = REPO_ROOT / "logs" / "access.log"
DEFAULT_JSON = REPO_ROOT / "outputs" / "route_usage.json"

# 组合日志: IP - - [08/Jul/2026:18:43:29 +0600] "GET /path?q=1 HTTP/1.1" 200 size
LINE_RE = re.compile(
    r"^\S+\s+-\s+-\s+\[([^\]]+)\]\s+\"([A-Z]+)\s+(\S+)(?:\s+HTTP/[\d.]+)?\"\s+(\d{3})"
)

# 归一化: 数字段(年月/站号/资源id) -> {ym} {id}
_SEG_NUM = re.compile(r"^\d{4}-\d{2}$|^\d+$|^\d{4}$|^[\w.-]*\d[\w.-]*$")


def normalize_path(path: str) -> str:
    p = path.split("?", 1)[0]
    segs = []
    for s in p.split("/"):
        if not s:
            continue
        if s == "v2" or _SEG_NUM.match(s) is None:
            segs.append(s)
        else:
            segs.append("{id}" if len(s) >= 4 and "-" not in s else "{ym}")
    return "/" + "/".join(segs)


def parse_log(path: Path) -> dict:
    stats = defaultdict(lambda: {"count": 0, "last": "", "status": defaultdict(int), "example": ""})
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = LINE_RE.match(raw)
        if not m:
            continue
        when_raw, method, target, status = m.groups()
        try:
            when = datetime.strptime(when_raw, "%d/%b/%Y:%H:%M:%S %z")
        except ValueError:
            continue
        ts = when.strftime("%Y-%m-%d")
        key = (method, normalize_path(target))
        st = stats[key]
        st["count"] += 1
        st["status"][status] += 1
        if ts > st["last"]:
            st["last"] = ts
        if not st["example"]:
            st["example"] = target
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=Path, default=DEFAULT_LOG)
    ap.add_argument("--json", type=Path, default=DEFAULT_JSON)
    ap.add_argument("--min", type=int, default=1, help="只输出调用次数 >= min 的路径")
    args = ap.parse_args()

    stats = parse_log(args.log)
    rows = []
    for (method, path), st in sorted(stats.items(), key=lambda kv: (-kv[1]["count"], kv[0])):
        if st["count"] < args.min:
            continue
        top_status = max(st["status"].items(), key=lambda kv: kv[1])[0]
        rows.append({
            "method": method,
            "path": path,
            "count": st["count"],
            "last": st["last"],
            "topStatus": top_status,
            "example": st["example"],
        })

    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(
        json.dumps({"source": str(args.log), "rows": rows}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"log={args.log} lines_parsed={sum(r['count'] for r in rows)} routes={len(rows)}")
    print(f"{'count':>6} {'method':<6} {'last':<10} top  path")
    for r in rows[:60]:
        print(f"{r['count']:>6} {r['method']:<6} {r['last']:<10} {r['topStatus']:<4} {r['path']}")


if __name__ == "__main__":
    main()
