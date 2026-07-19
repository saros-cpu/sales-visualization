from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from http.cookiejar import CookieJar
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
DEFAULT_BASE_URL = os.getenv("SALES_HEALTH_BASE_URL", "http://127.0.0.1:8900")
DEFAULT_EXTERNAL_URL = os.getenv("SALES_HEALTH_EXTERNAL_URL", "https://sales.example.com")
DEFAULT_YEAR = int(os.getenv("SALES_HEALTH_YEAR", time.strftime("%Y")))


@dataclass
class CheckResult:
    name: str
    ok: bool
    elapsed_ms: int | None = None
    detail: str = ""


def request_json(opener, url: str, method: str = "GET", payload: dict[str, Any] | None = None, timeout: int = 30):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=data, method=method, headers=headers)
    started = time.perf_counter()
    with opener.open(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if response.headers.get_content_type() == "application/json":
            parsed = json.loads(body or "{}")
        else:
            parsed = body
        return response.status, parsed, elapsed_ms


def request_page(opener, url: str, timeout: int = 20):
    request = Request(url, headers={"Accept": "text/html,application/xhtml+xml"})
    started = time.perf_counter()
    with opener.open(request, timeout=timeout) as response:
        response.read(2048)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return response.status, elapsed_ms


def add_result(results: list[CheckResult], name: str, ok: bool, elapsed_ms: int | None = None, detail: str = ""):
    results.append(CheckResult(name=name, ok=ok, elapsed_ms=elapsed_ms, detail=detail))


def check_endpoint(results: list[CheckResult], opener, base_url: str, path: str, name: str, timeout: int = 60):
    url = f"{base_url.rstrip('/')}{path}"
    try:
        status, payload, elapsed_ms = request_json(opener, url, timeout=timeout)
        ok = 200 <= status < 300
        detail = f"HTTP {status}"
        if isinstance(payload, dict) and payload.get("ok") is not None:
            detail += f", ok={payload.get('ok')}"
        add_result(results, name, ok, elapsed_ms, detail)
    except HTTPError as exc:
        add_result(results, name, False, None, f"HTTP {exc.code}: {exc.reason}")
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        add_result(results, name, False, None, str(exc))


def login_if_requested(results: list[CheckResult], opener, base_url: str, username: str | None, password: str | None) -> bool:
    if not username or not password:
        add_result(results, "登录态", True, None, "未提供账号，跳过需登录接口")
        return False
    try:
        status, payload, elapsed_ms = request_json(
            opener,
            f"{base_url.rstrip('/')}/api/v2/auth/login",
            method="POST",
            payload={"username": username, "password": password},
            timeout=20,
        )
        ok = status == 200 and bool(
            isinstance(payload, dict) and (payload.get("ok") or payload.get("code") == 0)
        )
        add_result(results, "登录态", ok, elapsed_ms, "登录成功" if ok else f"HTTP {status}")
        return ok
    except HTTPError as exc:
        add_result(results, "登录态", False, None, f"HTTP {exc.code}: {exc.reason}")
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        add_result(results, "登录态", False, None, str(exc))
    return False


def check_pages(results: list[CheckResult], opener, base_url: str):
    for path, name in (("/login", "登录页"), ("/", "主页访问控制")):
        try:
            status, elapsed_ms = request_page(opener, f"{base_url.rstrip('/')}{path}", timeout=20)
            add_result(results, name, 200 <= status < 400, elapsed_ms, f"HTTP {status}")
        except HTTPError as exc:
            add_result(results, name, exc.code in (302, 401), None, f"HTTP {exc.code}: {exc.reason}")
        except (URLError, TimeoutError, OSError) as exc:
            add_result(results, name, False, None, str(exc))


def check_tasks(results: list[CheckResult], strict: bool = False):
    tasks = [
        "SalesVisualizationProduction",
        "SalesVisualizationDailyExchangeRates",
        "SalesVisualizationDailyMarketWatch",
        "SalesVisualizationDailyRetailSnapshots",
    ]
    for task_name in tasks:
        started = time.perf_counter()
        try:
            completed = subprocess.run(
                ["schtasks", "/Query", "/TN", f"\\SalesVisualization\\{task_name}", "/FO", "LIST"],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            output = (completed.stdout or completed.stderr).strip()
            if completed.returncode != 0:
                detail = output.splitlines()[0] if output else "无法读取计划任务"
                add_result(results, f"计划任务 {task_name}", not strict, elapsed_ms, f"跳过: {detail}")
                continue
            ok = "Status:" in output or "Статус:" in output
            status = "未知"
            for line in output.splitlines():
                stripped = line.strip()
                if stripped.startswith("Status:") or stripped.startswith("Статус:"):
                    status = line.split(":", 1)[1].strip()
                    break
            add_result(results, f"计划任务 {task_name}", ok, elapsed_ms, status)
        except (OSError, subprocess.SubprocessError) as exc:
            add_result(results, f"计划任务 {task_name}", False, None, str(exc))


def check_logs(results: list[CheckResult]):
    log_files = [
        ROOT / "logs" / "production.log",
        ROOT / "logs" / "production-error.log",
        ROOT / "logs" / "daily_maintenance.log",
    ]
    for path in log_files:
        if not path.exists():
            add_result(results, f"日志 {path.name}", False, None, "文件不存在")
            continue
        size = path.stat().st_size
        if path.name == "production-error.log":
            text = path.read_text(encoding="utf-8", errors="ignore")[-2000:]
            has_bad_error = any(token in text.lower() for token in ("traceback", "exception", "error"))
            add_result(results, f"日志 {path.name}", not has_bad_error, None, f"{size} bytes")
        else:
            add_result(results, f"日志 {path.name}", size > 0, None, f"{size} bytes")


def run(args: argparse.Namespace) -> int:
    results: list[CheckResult] = []
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    base_url = args.base_url.rstrip("/")

    check_endpoint(results, opener, base_url, "/api/health", "本地健康接口", timeout=15)
    if args.external_url:
        check_endpoint(results, opener, args.external_url.rstrip("/"), "/api/health", "外网健康接口", timeout=15)
    check_pages(results, opener, base_url)

    logged_in = login_if_requested(results, opener, base_url, args.username, args.password)
    if logged_in:
        check_endpoint(results, opener, base_url, f"/api/dashboard/yearly?{urlencode({'year': args.year})}", "零售年度总览", timeout=180)
        check_endpoint(results, opener, base_url, f"/api/kpi/yearly?{urlencode({'year': args.year, 'inventory': 0})}", "零售KPI", timeout=180)
        check_endpoint(results, opener, base_url, "/api/months", "零售月份列表", timeout=60)
        check_endpoint(results, opener, base_url, "/api/home/exchange-current", "主页今日汇率", timeout=30)

    check_tasks(results, strict=args.strict_tasks)
    check_logs(results)

    print("销售数据可视化健康检查")
    print(f"项目目录: {PROJECT_ROOT}")
    print(f"检查地址: {base_url}")
    print("")
    for item in results:
        mark = "OK" if item.ok else "FAIL"
        elapsed = f" {item.elapsed_ms}ms" if item.elapsed_ms is not None else ""
        detail = f" - {item.detail}" if item.detail else ""
        print(f"[{mark}] {item.name}{elapsed}{detail}")

    failed = [item for item in results if not item.ok]
    print("")
    print(f"结果: {len(results) - len(failed)}/{len(results)} 通过")
    return 1 if failed else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sales Visualization quick health check")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--external-url", default=DEFAULT_EXTERNAL_URL)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--username", default=os.getenv("SALES_HEALTH_USERNAME"))
    parser.add_argument("--password", default=os.getenv("SALES_HEALTH_PASSWORD"))
    parser.add_argument("--strict-tasks", action="store_true", help="计划任务读取失败时判定为失败")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(run(parse_args()))
