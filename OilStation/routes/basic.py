import json

from flask import Blueprint, jsonify

from business_time import business_date_expr, shift_join
from cache_store import SNAPSHOT_DIR, get_cached, set_cached
from db import get_connection


basic_api = Blueprint("basic_api", __name__)


def _snapshot_months():
    months = []
    for path in SNAPSHOT_DIR.rglob("monthly_*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            continue
        month = payload.get("month") or path.stem.replace("monthly_", "")
        summary = payload.get("summary") or {}
        months.append({
            "month": month,
            "transactions": int(summary.get("totalTxn") or 0),
        })
    return sorted(months, key=lambda item: item["month"], reverse=True)


def _cached_snapshot_months():
    cache_key = "snapshot_months:list"
    cached = get_cached(cache_key)
    if cached:
        return cached
    months = _snapshot_months()
    if months:
        set_cached(cache_key, months, ttl=300)
    return months


@basic_api.route("/api/health")
def api_health():
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        conn.close()
        return jsonify({"status": "ok", "db": "connected"})
    except Exception as exc:
        return jsonify({"status": "error", "message": str(exc)}), 500


@basic_api.route("/api/months")
def api_months():
    snapshot_months = _cached_snapshot_months()
    if snapshot_months:
        return jsonify(snapshot_months)

    cache_key = "months:list"
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        business_date = business_date_expr("s", "sh")
        cur.execute(
            f"""
            SELECT DATE_FORMAT({business_date}, '%Y-%m') as ym, COUNT(*) as cnt
            FROM selling s
            {shift_join("s", "sh")}
            GROUP BY ym
            ORDER BY ym DESC
        """
        )
        months = [{"month": row[0], "transactions": row[1]} for row in cur.fetchall()]
        set_cached(cache_key, months)
        return jsonify(months)
    finally:
        conn.close()


@basic_api.route("/api/years")
def api_years():
    snapshot_months = _cached_snapshot_months()
    if snapshot_months:
        return jsonify(sorted({int(item["month"][:4]) for item in snapshot_months}, reverse=True))

    cache_key = "years:list"
    cached = get_cached(cache_key)
    if cached:
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        business_date = business_date_expr("s", "sh")
        cur.execute(
            f"""
            SELECT DISTINCT YEAR({business_date}) AS yr
            FROM selling s
            {shift_join("s", "sh")}
            ORDER BY yr DESC
        """
        )
        years = [row[0] for row in cur.fetchall() if row[0] is not None]
        set_cached(cache_key, years)
        return jsonify(years)
    finally:
        conn.close()


def register_basic_routes(app):
    app.register_blueprint(basic_api)
