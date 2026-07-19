from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask_jwt_extended import create_access_token


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api import app  # noqa: E402


BASE_URL = "http://127.0.0.1:8900"
CURRENT_YEAR = date.today().year
COMPLETED_DAY = date.today() - timedelta(days=1)
CURRENT_MONTH = f"{COMPLETED_DAY.year}-{COMPLETED_DAY.month:02d}"


@dataclass
class Result:
    name: str
    ok: bool
    elapsed_ms: int | None = None
    detail: str = ""


def session_cookie() -> str:
    serializer = app.session_interface.get_signing_serializer(app)
    return serializer.dumps({
        "user": {
            "id": 1,
            "username": "health",
            "displayName": "health",
            "role": "admin",
        }
    })


COOKIE = "session=" + session_cookie()


def access_token() -> str:
    with app.app_context():
        return create_access_token(
            identity="1",
            additional_claims={"username": "health", "role": "admin", "mustChangePassword": False},
        )


AUTH_TOKEN = access_token()


def request_json(path: str, method: str = "GET", payload: dict | None = None, timeout: int = 30):
    data = None
    headers = {"Accept": "application/json", "Cookie": COOKIE, "Authorization": f"Bearer {AUTH_TOKEN}"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    started = time.perf_counter()
    req = Request(BASE_URL + path, data=data, method=method, headers=headers)
    with urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return response.status, json.loads(body or "{}"), elapsed_ms


def add(results: list[Result], name: str, ok: bool, elapsed_ms: int | None = None, detail: str = ""):
    results.append(Result(name, ok, elapsed_ms, detail))


def check_get(results: list[Result], name: str, path: str, keys: tuple[str, ...] = (), timeout: int = 60):
    try:
        status, payload, elapsed_ms = request_json(path, timeout=timeout)
        ok = status == 200 and isinstance(payload, (dict, list))
        for key in keys:
            ok = ok and isinstance(payload, dict) and key in payload
        detail = f"HTTP {status}"
        if isinstance(payload, dict):
            if "source" in payload:
                detail += f", source={payload.get('source')}"
            if "snapshot" in payload:
                detail += f", snapshot={payload.get('snapshot')}"
            if "month" in payload:
                detail += f", month={payload.get('month')}"
        elif isinstance(payload, list):
            detail += f", items={len(payload)}"
        add(results, name, ok, elapsed_ms, detail)
    except HTTPError as exc:
        add(results, name, False, None, f"HTTP {exc.code}: {exc.reason}")
    except (TimeoutError, URLError, OSError, json.JSONDecodeError) as exc:
        add(results, name, False, None, str(exc))


def check_post_question(results: list[Result], question: str, expected_period: str | None = None):
    try:
        status, payload, elapsed_ms = request_json(
            "/api/v2/assistant/query",
            method="POST",
            payload={"question": question, "useLlm": False},
            timeout=45,
        )
        body = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        period = str(body.get("periodLabel") or "")
        ok = status == 200 and bool(payload.get("code") == 0 or body.get("ok")) and (not expected_period or expected_period in period)
        liters = ((body.get("data") or {}).get("summary") or {}).get("totalLiters")
        detail = f"period={period}, liters={liters}"
        add(results, f"数据问答：{question}", ok, elapsed_ms, detail)
    except HTTPError as exc:
        add(results, f"数据问答：{question}", False, None, f"HTTP {exc.code}: {exc.reason}")
    except (TimeoutError, URLError, OSError, json.JSONDecodeError) as exc:
        add(results, f"数据问答：{question}", False, None, str(exc))


def check_snapshot_files(results: list[Result]):
    snapshot_root = PROJECT_ROOT / "OilStation" / "cache_snapshots"
    monthly_dir = snapshot_root / "monthly"
    daily_dir = snapshot_root / "daily"
    yearly_dir = snapshot_root / "yearly"
    expected_daily = []
    cursor = date(COMPLETED_DAY.year, COMPLETED_DAY.month, 1)
    while cursor <= COMPLETED_DAY:
        expected_daily.append(daily_dir / str(cursor.year) / f"{cursor.month:02d}" / f"day_{cursor.day:02d}.json")
        cursor += timedelta(days=1)
    missing_daily = [path.name for path in expected_daily if not path.exists()]
    add(
        results,
        f"日快照完整性 {CURRENT_MONTH}",
        not missing_daily,
        None,
        "缺失：" + "、".join(missing_daily[:8]) if missing_daily else f"{len(expected_daily)} 天完整",
    )
    ym_year, ym_month = CURRENT_MONTH.split("-")
    for prefix in ("monthly", "stations", "regions", "daily"):
        path = monthly_dir / ym_year / f"{prefix}_{int(ym_month):02d}.json"
        add(results, f"月快照文件 {prefix}_{CURRENT_MONTH}", path.exists() and path.stat().st_size > 40, None, f"{path.stat().st_size if path.exists() else 0} bytes")
    for name in (
        f"dashboard_yearly_{CURRENT_YEAR}.json",
        f"kpi_yearly_{CURRENT_YEAR}_summary.json",
        f"resources_yearly_{CURRENT_YEAR}_year.json",
    ):
        path = yearly_dir / name
        add(results, f"年快照文件 {name}", path.exists() and path.stat().st_size > 40, None, f"{path.stat().st_size if path.exists() else 0} bytes")


def run() -> int:
    results: list[Result] = []
    check_snapshot_files(results)

    check_get(results, "健康接口", "/api/health", ("ok",), 15)
    check_get(results, "主页期间", "/api/periods", (), 30)
    check_get(results, "主页汇率", "/api/home/exchange-current", (), 30)
    check_get(results, "主页市场观察", "/api/home/market-watch", (), 30)
    check_get(results, "主页汇总 2026-05", "/api/summary?" + urlencode({"year": CURRENT_YEAR, "month": COMPLETED_DAY.month}), (), 60)
    check_get(results, "批发汇总 2026-05", "/api/wholesale?" + urlencode({"year": CURRENT_YEAR, "month": COMPLETED_DAY.month}), (), 60)
    check_get(results, "汇率列表 2026-05", "/api/exchange-rates?" + urlencode({"year": CURRENT_YEAR, "month": COMPLETED_DAY.month}), (), 30)
    check_get(results, "零售预警KPI", "/api/kpi", ("summary",), 60)
    check_get(results, "零售站点状态", "/api/retail/station-statuses", (), 30)
    check_get(results, "零售年份", "/api/years", (), 30)
    check_get(results, "零售月份", "/api/months", (), 30)
    check_get(results, "零售月度", f"/api/monthly/{CURRENT_MONTH}", ("summary", "byResource"), 60)
    check_get(results, "零售站点", f"/api/stations/{CURRENT_MONTH}", ("stations",), 60)
    check_get(results, "零售区域", f"/api/regions/{CURRENT_MONTH}", ("regions",), 60)
    check_get(results, "零售日趋势", f"/api/daily/{CURRENT_MONTH}", ("daily",), 60)
    check_get(results, "零售站点详情", f"/api/station/{CURRENT_MONTH}/1", (), 60)
    check_get(results, "零售年总览", f"/api/dashboard/yearly?{urlencode({'year': CURRENT_YEAR})}", ("stations", "regions", "byResource"), 180)
    check_get(results, "零售年KPI", f"/api/kpi/yearly?{urlencode({'year': CURRENT_YEAR, 'inventory': 0})}", ("summary",), 90)
    check_get(results, "零售油品年排行", f"/api/resources/yearly?{urlencode({'year': CURRENT_YEAR})}", ("resources", "summary"), 90)
    check_get(results, "零售地图悬停", "/api/station-map-details", ("items",), 60)
    check_get(results, "零售月报导出", f"/api/export/monthly/{CURRENT_MONTH}", (), 180)

    check_post_question(results, "5月零售销量", "2026年5月")
    check_post_question(results, "五月零售销量", "2026年5月")
    check_post_question(results, "上周零售销量", "上周")
    check_post_question(results, "本月零售销量", "本月")
    check_post_question(results, "2026年零售销量", "2026年")
    check_post_question(results, "本月批发分类统计", "本月")
    check_post_question(results, "今日汇率", None)
    check_post_question(results, "市场观察", None)

    print("销售数据可视化数据调用自检")
    print(f"服务地址：{BASE_URL}")
    print(f"快照月份：{CURRENT_MONTH}")
    print("")
    for item in results:
        mark = "OK" if item.ok else "FAIL"
        elapsed = f" {item.elapsed_ms}ms" if item.elapsed_ms is not None else ""
        detail = f" - {item.detail}" if item.detail else ""
        print(f"[{mark}] {item.name}{elapsed}{detail}")
    failed = [item for item in results if not item.ok]
    slow = [item for item in results if item.elapsed_ms is not None and item.elapsed_ms > 3000]
    print("")
    print(f"结果：{len(results) - len(failed)}/{len(results)} 通过")
    if slow:
        print("慢接口：" + "；".join(f"{item.name} {item.elapsed_ms}ms" for item in slow[:8]))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(run())
