from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from loguru import logger

cli = typer.Typer(name="sales", help="Sales Visualization 命令行工具")

APP_ROOT = Path(__file__).resolve().parent


def _init_env():
    from log_setup import setup_logging
    setup_logging()


@cli.command(help="启动开发服务器")
def run(
    host: str = "0.0.0.0",
    port: int = 8900,
    debug: bool = True,
):
    _init_env()
    os.environ["SALES_HOST"] = host
    os.environ["SALES_PORT"] = str(port)
    sys.path.insert(0, str(APP_ROOT))
    from api import app
    logger.info("Starting dev server on {}:{}", host, port)
    app.run(host=host, port=port, debug=debug)


@cli.command(help="启动生产服务器 (Waitress)")
def serve(
    host: str = "0.0.0.0",
    port: int = 8900,
    threads: int = 12,
):
    _init_env()
    os.environ["SALES_HOST"] = host
    os.environ["SALES_PORT"] = str(port)
    sys.path.insert(0, str(APP_ROOT))
    from waitress import serve as wsgi_serve
    from api import app
    from run_production import start_retail_cache_warmup

    start_retail_cache_warmup()
    logger.info("Starting production server on {}:{} ({} threads)", host, port, threads)
    wsgi_serve(app, host=host, port=port, threads=threads)


@cli.command(help="预热零售缓存")
def cache_warm():
    _init_env()
    sys.path.insert(0, str(APP_ROOT))
    from retail_internal import open_oilstation
    from datetime import datetime

    now = datetime.now()
    year_month = f"{now.year}-{now.month:02d}"
    paths = [
        ("/api/months", False, ""),
        ("/api/years", False, ""),
        (f"/api/dashboard/yearly", False, f"year={now.year}"),
        (f"/api/resources/yearly", False, f"year={now.year}"),
        (f"/api/monthly/{year_month}", False, ""),
        (f"/api/stations/{year_month}", False, ""),
        (f"/api/regions/{year_month}", False, ""),
        (f"/api/daily/{year_month}", False, ""),
    ]
    for path, refresh, query in paths:
        label = f"{path}?{query}" if query else path
        logger.info("Cache warmup: {}", label)
        qs = "&".join(p for p in (query, "refresh=1" if refresh else "") if p)
        response = open_oilstation(path, query_string=qs)
        if response.status_code >= 400:
            logger.error("Cache warmup failed: {} ({} {})", path, response.status_code, response.get_data(as_text=True))
        else:
            logger.info("Cache warmup OK: {}", label)
    logger.info("Cache warmup complete")


@cli.command(help="检查 AI 助手调用日志（ai_agent_call_logs / ai_agent_feedback），用于持续完善问答")
def assistant_log_digest(
    days: Annotated[int, typer.Option("--days", "-d", min=1, max=365, help="统计最近 N 天")] = 7,
    json_output: Annotated[bool, typer.Option("--json", help="输出 JSON 便于程序处理")] = False,
):
    _init_env()
    sys.path.insert(0, str(APP_ROOT))
    import json as _json

    import pymysql

    from config import DB_CONFIG

    cfg = dict(DB_CONFIG)
    cfg["autocommit"] = True
    conn = None
    try:
        conn = pymysql.connect(**cfg)
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = 'ai_agent_call_logs'"
        )
        if not (cur.fetchone() or (0,))[0]:
            logger.warning("ai_agent_call_logs 表不存在，跳过日志检查")
            return
        summary = {}
        cur.execute(
            "SELECT status, COUNT(*) FROM ai_agent_call_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s DAY) GROUP BY status ORDER BY 2 DESC",
            (days,),
        )
        summary["byStatus"] = dict(cur.fetchall())
        cur.execute(
            "SELECT route, COUNT(*), SUM(quality_status = 'fail'), SUM(quality_status = 'warn'), SUM(permission_status = 'denied') "
            "FROM ai_agent_call_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s DAY) "
            "GROUP BY route ORDER BY 2 DESC LIMIT 20",
            (days,),
        )
        summary["byRoute"] = [
            {"route": r[0], "total": int(r[1]), "qualityFail": int(r[2] or 0), "qualityWarn": int(r[3] or 0), "permissionDenied": int(r[4] or 0)}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT id, created_at, username, status, quality_status, route, LEFT(question, 100) "
            "FROM ai_agent_call_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s DAY) "
            "AND status <> 'ok' AND status <> 'disabled' AND status <> 'not_configured' "
            "ORDER BY created_at DESC LIMIT 15",
            (days,),
        )
        summary["recentIssues"] = [
            {"id": r[0], "createdAt": str(r[1]), "user": r[2], "status": r[3], "quality": r[4], "route": r[5], "question": r[6]}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT id, created_at, username, quality_status, diagnostics_status, route, LEFT(question, 100), LEFT(error, 80) "
            "FROM ai_agent_call_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s DAY) "
            "AND quality_status IN ('fail', 'warn') ORDER BY created_at DESC LIMIT 15",
            (days,),
        )
        summary["qualityIssues"] = [
            {"id": r[0], "createdAt": str(r[1]), "user": r[2], "quality": r[3], "diagnostics": r[4], "route": r[5], "question": r[6], "error": r[7]}
            for r in cur.fetchall()
        ]
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = 'ai_agent_feedback'"
        )
        summary["negativeFeedback"] = []
        if (cur.fetchone() or (0,))[0]:
            cur.execute(
                "SELECT id, created_at, rating, route, LEFT(question, 100), LEFT(comment, 120), LEFT(reason, 120) "
                "FROM ai_agent_feedback WHERE created_at >= DATE_SUB(NOW(), INTERVAL %s DAY) AND rating <> 'correct' "
                "ORDER BY created_at DESC LIMIT 20",
                (days,),
            )
            summary["negativeFeedback"] = [
                {"id": r[0], "createdAt": str(r[1]), "rating": r[2], "route": r[3], "question": r[4], "comment": r[5], "reason": r[6]}
                for r in cur.fetchall()
            ]
    finally:
        if conn is not None:
            conn.close()

    if json_output:
        print(_json.dumps(summary, ensure_ascii=False, indent=2, default=str))
        return
    print(f"\n== AI 助手日志摘要（最近 {days} 天）==")
    print(f"按状态：{'、'.join(f'{k} {v}' for k, v in summary['byStatus'].items()) or '无'}")
    print("\n按路由（total/质量fail/质量warn/权限拒绝）：")
    for item in summary["byRoute"]:
        if not item["route"]:
            continue
        print(f"  {item['route']:<28} {item['total']:>4} / {item['qualityFail']} / {item['qualityWarn']} / {item['permissionDenied']}")
    if summary["qualityIssues"]:
        print("\n质量 fail/warn：")
        for item in summary["qualityIssues"]:
            print(f"  [{item['createdAt']}] {item['user']} {item['quality']} {item['route']} | {item['question']}")
    if summary["recentIssues"]:
        print("\n近期非正常调用：")
        for item in summary["recentIssues"]:
            print(f"  [{item['createdAt']}] {item['user']} {item['status']} {item['route']} | {item['question']}")
    if summary["negativeFeedback"]:
        print("\n用户负面反馈（rating/question）：")
        for item in summary["negativeFeedback"]:
            print(f"  [{item['createdAt']}] {item['rating']} {item['route']} | {item['question']}")
    print("\n完成。可用 --json 获取结构化结果。")


if __name__ == "__main__":
    cli()
