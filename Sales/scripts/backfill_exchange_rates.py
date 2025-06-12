from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
import sys
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen
import xml.etree.ElementTree as ET
import re

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from config import NBKR_DAILY_XML_URL, NBKR_RATES_PAGE_URL
from db import get_connection


REQUIRED_CODES = ("USD", "CNY")
NBKR_HISTORICAL_VALUTA_IDS = {
    "USD": "15",
    "CNY": "24",
}


def parse_nbkr_value(text):
    if text in (None, ""):
        return None
    return float(str(text).replace(",", ".").strip())


def parse_daily_xml(payload):
    root = ET.fromstring(payload)
    rate_date = datetime.strptime(root.attrib["Date"], "%d.%m.%Y").date()
    rates = {}
    for node in root.findall("Currency"):
        code = node.attrib.get("ISOCode")
        if code in REQUIRED_CODES:
            nominal = parse_nbkr_value(node.findtext("Nominal")) or 1
            value = parse_nbkr_value(node.findtext("Value"))
            rates[code] = value / nominal if value is not None else None
    return rate_date, rates


def fetch_current_daily(timeout=20):
    with urlopen(NBKR_DAILY_XML_URL, timeout=timeout) as response:
        return parse_daily_xml(response.read())


def fetch_historical_currency(day, code, timeout=20):
    params = {
        "item": "1562",
        "lang": "ENG",
        "beg_day": f"{day.day:02d}",
        "beg_month": f"{day.month:02d}",
        "beg_year": day.year,
        "end_day": f"{day.day:02d}",
        "end_month": f"{day.month:02d}",
        "end_year": day.year,
        "valuta_id": NBKR_HISTORICAL_VALUTA_IDS[code],
    }
    url = NBKR_RATES_PAGE_URL + "?" + urlencode(params)
    with urlopen(url, timeout=timeout) as response:
        html = response.read().decode("utf-8", errors="ignore")

    date_token = day.strftime("%d.%m.%Y")
    pattern = (
        re.escape(date_token)
        + r".{0,500}?<!--value-->\s*([0-9]{1,3},[0-9]{4,6})\s*<!--value-->"
    )
    match = re.search(pattern, html, flags=re.DOTALL)
    if match:
        return parse_nbkr_value(match.group(1))
    return None


def fetch_historical_currency_range(start, end, code, timeout=60):
    params = {
        "item": "1562",
        "lang": "ENG",
        "beg_day": f"{start.day:02d}",
        "beg_month": f"{start.month:02d}",
        "beg_year": start.year,
        "end_day": f"{end.day:02d}",
        "end_month": f"{end.month:02d}",
        "end_year": end.year,
        "valuta_id": NBKR_HISTORICAL_VALUTA_IDS[code],
    }
    url = NBKR_RATES_PAGE_URL + "?" + urlencode(params)
    with urlopen(url, timeout=timeout) as response:
        html = response.read().decode("utf-8", errors="ignore")

    rates = {}
    pattern = r"(\d{2}\.\d{2}\.\d{4}).{0,500}?<!--value-->\s*([0-9]{1,3},[0-9]{4,6})\s*<!--value-->"
    for match in re.finditer(pattern, html, flags=re.DOTALL):
        rate_date = datetime.strptime(match.group(1), "%d.%m.%Y").date()
        rates[rate_date] = parse_nbkr_value(match.group(2))
    return rates


def fetch_historical_range(start, end, timeout=60):
    by_code = {}
    for code in REQUIRED_CODES:
        by_code[code] = fetch_historical_currency_range(start, end, code, timeout=timeout)
    rates_by_day = {}
    for day in daterange(start, end):
        rates_by_day[day] = {code: by_code.get(code, {}).get(day) for code in REQUIRED_CODES}
    return rates_by_day


def fetch_historical_page(day, timeout=20):
    rates = {}
    for code in REQUIRED_CODES:
        rates[code] = fetch_historical_currency(day, code, timeout=timeout)
    return rates


def upsert_rate(cur, rate_date, rates, source, note=None):
    usd = rates.get("USD")
    cny = rates.get("CNY")
    cur.execute(
        """
        INSERT INTO exchange_rates
            (rate_date, usd_kgs, cny_kgs, source, is_manual, fetched_at, note)
        VALUES (%s, %s, %s, %s, FALSE, CURRENT_TIMESTAMP, %s)
        ON DUPLICATE KEY UPDATE
            usd_kgs = COALESCE(VALUES(usd_kgs), usd_kgs),
            cny_kgs = COALESCE(VALUES(cny_kgs), cny_kgs),
            source = IF(is_manual, source, VALUES(source)),
            fetched_at = IF(is_manual, fetched_at, CURRENT_TIMESTAMP),
            note = COALESCE(VALUES(note), note)
        """,
        (rate_date, usd, cny, source, note),
    )

    missing_usd = usd is None
    missing_cny = cny is None
    if missing_usd or missing_cny:
        cur.execute(
            """
            INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, note)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                missing_usd = VALUES(missing_usd),
                missing_cny = VALUES(missing_cny),
                status = 'open'
            """,
            (rate_date, missing_usd, missing_cny, "NBKR rate missing; manual entry required."),
        )
    else:
        cur.execute(
            """
            INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, status, resolved_at, note)
            VALUES (%s, FALSE, FALSE, 'resolved', CURRENT_TIMESTAMP, 'Resolved by NBKR snapshot.')
            ON DUPLICATE KEY UPDATE
                missing_usd = FALSE,
                missing_cny = FALSE,
                status = 'resolved',
                resolved_at = CURRENT_TIMESTAMP
            """,
            (rate_date,),
        )


def daterange(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def chunk_ranges(start, end, chunk_days):
    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=chunk_days - 1), end)
        yield current, chunk_end
        current = chunk_end + timedelta(days=1)


def existing_complete_dates(cur, start, end):
    cur.execute(
        """
        SELECT rate_date
        FROM exchange_rates
        WHERE rate_date >= %s AND rate_date <= %s
          AND usd_kgs IS NOT NULL AND cny_kgs IS NOT NULL
        """,
        (start, end),
    )
    return {row[0] for row in cur.fetchall()}


def fetch_day(day):
    try:
        return day, fetch_historical_page(day), None
    except URLError as exc:
        return day, {}, f"Fetch failed: {exc}"


def main():
    parser = argparse.ArgumentParser(description="Fetch NBKR USD/CNY daily exchange-rate snapshots.")
    parser.add_argument("--start", default="2023-12-01", help="Start date YYYY-MM-DD.")
    parser.add_argument("--end", default=date.today().isoformat(), help="End date YYYY-MM-DD.")
    parser.add_argument("--current-only", action="store_true", help="Only fetch NBKR daily.xml.")
    parser.add_argument("--limit", type=int, help="Maximum number of dates to process.")
    parser.add_argument("--workers", type=int, default=1, help="Parallel workers for historical page fetching.")
    parser.add_argument("--skip-complete", action="store_true", help="Skip dates that already have USD and CNY.")
    parser.add_argument("--daily-pages", action="store_true", help="Fetch one NBKR page per date instead of range pages.")
    parser.add_argument("--chunk-days", type=int, default=370, help="Date-range size for NBKR range page fetching.")
    args = parser.parse_args()

    conn = get_connection()
    try:
        cur = conn.cursor()
        processed = 0
        if args.current_only:
            rate_date, rates = fetch_current_daily()
            upsert_rate(cur, rate_date, rates, "NBKR")
            processed = 1
        else:
            start = date.fromisoformat(args.start)
            end = date.fromisoformat(args.end)
            days = list(daterange(start, end))
            if args.skip_complete:
                complete = existing_complete_dates(cur, start, end)
                days = [day for day in days if day not in complete]
            if args.limit:
                days = days[:args.limit]

            if not args.daily_pages:
                day_set = set(days)
                for chunk_start, chunk_end in chunk_ranges(start, end, args.chunk_days):
                    chunk_days = [day for day in daterange(chunk_start, chunk_end) if day in day_set]
                    if not chunk_days:
                        continue
                    chunk_rates = fetch_historical_range(chunk_days[0], chunk_days[-1])
                    for day in chunk_days:
                        upsert_rate(cur, day, chunk_rates.get(day, {}), "NBKR")
                        processed += 1
                    conn.commit()
                    print(f"processed {processed} dates...")
            elif args.workers <= 1:
                for day in days:
                    rates = fetch_historical_page(day)
                    upsert_rate(cur, day, rates, "NBKR")
                    processed += 1
                    if processed % 50 == 0:
                        conn.commit()
                        print(f"processed {processed} dates...")
            else:
                with ThreadPoolExecutor(max_workers=args.workers) as executor:
                    futures = [executor.submit(fetch_day, day) for day in days]
                    for future in as_completed(futures):
                        day, rates, note = future.result()
                        upsert_rate(cur, day, rates, "NBKR", note=note)
                        processed += 1
                        if processed % 50 == 0:
                            conn.commit()
                            print(f"processed {processed} dates...")
        conn.commit()
        print(f"exchange-rate snapshot run complete: {processed} dates")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
