import os
from datetime import date, datetime, timedelta
from pathlib import Path

import pymysql


PROJECT_ROOT = Path(__file__).resolve().parents[5]


def _load_env_file(path):
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def sales_db_config():
    _load_env_file(PROJECT_ROOT / "Sales" / ".env")
    _load_env_file(PROJECT_ROOT / "OilStation" / ".env")
    database = os.getenv("SALES_DB_NAME", os.getenv("DB_NAME", "sales_visualization"))
    if database == "ocw":
        database = "sales_visualization"
    return {
        "host": os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "user": os.getenv("DB_USER", "reader"),
        "password": os.getenv("DB_PASSWORD", ""),
        "database": database,
        "charset": os.getenv("DB_CHARSET", "utf8mb4"),
        "use_unicode": True,
        "autocommit": True,
    }


def parse_day(value):
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def load_cny_rates(start, end):
    rates = {}
    try:
        start_day = parse_day(start)
        end_day = parse_day(end)
    except (TypeError, ValueError):
        return rates
    if end_day <= start_day:
        return rates
    try:
        conn = pymysql.connect(**sales_db_config())
    except Exception:
        return rates
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT rate_date, cny_kgs
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
              AND cny_kgs IS NOT NULL
            """,
            (start_day, end_day),
        )
        for rate_date, cny_kgs in cur.fetchall():
            rates[parse_day(rate_date).isoformat()] = float(cny_kgs)
    finally:
        conn.close()
    return rates


def missing_rate_dates(start, end, rates):
    try:
        start_day = parse_day(start)
        end_day = parse_day(end)
    except (TypeError, ValueError):
        return []
    missing = []
    day = start_day
    while day < end_day:
        label = day.isoformat()
        if label not in rates:
            missing.append(label)
        day += timedelta(days=1)
    return missing


def average_cny_kgs_for_period(start, end):
    rates = load_cny_rates(start, end)
    values = [value for value in rates.values() if value]
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def cny_from_kgs_average(amount, avg_cny_kgs):
    try:
        numeric_amount = float(amount or 0)
        numeric_rate = float(avg_cny_kgs or 0)
    except (TypeError, ValueError):
        return None
    if numeric_rate <= 0:
        return None
    return round(numeric_amount / numeric_rate, 2)


def attach_amount_cny_average(target, amount_key="amount", output_key="amountCnyAvg", avg_cny_kgs=None):
    if not isinstance(target, dict):
        return False
    amount_cny = cny_from_kgs_average(target.get(amount_key), avg_cny_kgs)
    changed = False
    if target.get(output_key) != amount_cny:
        target[output_key] = amount_cny
        changed = True
    if avg_cny_kgs is not None and target.get("avgCnyKgs") != avg_cny_kgs:
        target["avgCnyKgs"] = avg_cny_kgs
        changed = True
    return changed
