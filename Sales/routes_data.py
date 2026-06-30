from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from email.utils import parsedate_to_datetime
from functools import wraps
import html
import importlib.util
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import pandas as pd
from flask import jsonify, request, session
from flask_jwt_extended import create_access_token, create_refresh_token, get_jwt_identity, verify_jwt_in_request
from pymysql.err import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from shared_utils import (
    admin_required, log_operation, log_system_operation, session_user, has_users,
    ensure_auth_schema, ensure_market_watch_schema, ensure_operation_log_schema,
    ensure_station_status_schema, review_detail_rows, review_issue_rows,
    recalculate_all_wholesale, record_automation_task,
    OILSTATION_ROOT, UPLOAD_ROOT, STATION_STATUS_TYPES,
    retail_station_catalog, retail_station_catalog_cached,
    market_region_label, market_type_label, market_watch_rows,
    import_source_label, active_station_statuses, apply_station_status,
)
from calculations import recalculate_wholesale_batch
from config import NBKR_DAILY_XML_URL
from db import get_connection
from import_helpers import (
    get_or_create_customer, load_entity_lookup, load_product_lookup,
    lookup_entity, lookup_product,
)
from scripts.import_contracts import import_contracts
from scripts.import_wholesale_excel import SHEET_DETAIL, import_wholesale
from summary_service import available_periods, period_bounds, summarize_combined, summarize_wholesale
from text_utils import clean_str, normalize_station_name, parse_date, parse_decimal
from wholesale_service import exchange_rates, summarize_wholesale_page
from retail_internal import open_oilstation



# ── Maintenance & helper functions (moved from register_data_routes inner scope) ──


def _round_half_up(value, digits=0):
    digits = int(digits or 0)
    try:
        quant = Decimal("1").scaleb(-digits)
        return float(Decimal(str(value or 0)).quantize(quant, rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return 0.0

def default_market_details(region):
    label = market_region_label(region)
    return [
        {
            "typeLabel": "市场行情",
            "title": f"{label}市场行情",
            "summary": "关注供应节奏、批发成交、运输变化、库存压力和价格波动对采购销售的影响。",
        },
        {
            "typeLabel": "原料油",
            "title": f"{label}原料油行情",
            "summary": "关注原油、凝析油、炼厂原料供应、炼厂开工负荷和外部价格传导。",
        },
        {
            "typeLabel": "成品油",
            "title": f"{label}成品油行情",
            "summary": "关注汽油、柴油、液化气供应变化、库存水平、区域价差和短期需求。",
        },
    ]


UZEX_QUOTES_URL = "https://www.uzex.uz/Quote/GetQuotes"
UZEX_SOURCE_URL = "https://www.uzex.uz/ru/pages/public-data"
CBU_KGS_RATE_URL = "https://cbu.uz/ru/arkhiv-kursov-valyut/json/KGS/{rate_date}/"
SPIMEX_INDICES_URL = "https://spimex.global/indices/"
UZEX_PRODUCT_CODES = {
    "汽油(80)": "AI80",
    "柴油": "DIESEL_K5",
    "液化气": "LPG",
}
UZEX_FALLBACK_DENSITIES = {
    "汽油(80)": 0.760,
    "柴油": 0.850,
    "液化气": 0.554,
}

MARKET_BENCHMARKS = [
    {"symbol": "BZ%3DF", "label": "Brent"},
    {"symbol": "CL%3DF", "label": "WTI"},
]


def extract_market_price_text(*values):
    text = " ".join(clean_str(value) or "" for value in values)
    price_parts = []
    for label, value in re.findall(
        r"\b(Brent|WTI|Urals)\b[^\d$]{0,28}\$?\s*(\d+(?:\.\d+)?)",
        text,
        flags=re.IGNORECASE,
    ):
        price_parts.append(f"{label.upper() if label.lower() == 'wti' else label.title()} {value} 美元/桶")
    return "；".join(dict.fromkeys(price_parts))


def fetch_market_benchmark_item():
    values = []
    quote_date = None
    for benchmark in MARKET_BENCHMARKS:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{benchmark['symbol']}?range=5d&interval=1d"
        req = Request(url, headers={"User-Agent": "SalesVisualization/1.0", "Accept": "application/json"})
        try:
            with urlopen(req, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            result = payload.get("chart", {}).get("result", [None])[0] or {}
            meta = result.get("meta", {})
            price = meta.get("regularMarketPrice")
            if price is None:
                closes = ((result.get("indicators", {}).get("quote") or [{}])[0].get("close") or [])
                price = next((value for value in reversed(closes) if value is not None), None)
            if price is None:
                continue
            market_time = meta.get("regularMarketTime")
            if market_time:
                market_date = datetime.fromtimestamp(market_time).date()
                quote_date = market_date if quote_date is None else max(quote_date, market_date)
            values.append(f"{benchmark['label']} {float(price):,.2f} 美元/桶")
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as exc:
            raise RuntimeError(f"国际原油价格获取失败：{exc}") from exc
    if not values:
        raise RuntimeError("国际原油价格获取失败：报价为空")
    price_text = "；".join(values)
    return {
        "region": "Global",
        "type": "crude",
        "title": "国际原油基准价格",
        "summary": f"{price_text}。用于观察国际原料油成本变化与成品油价格传导趋势。",
        "priceText": price_text,
        "sourceName": "Yahoo Finance",
        "sourceUrl": "https://finance.yahoo.com/markets/commodities/",
        "observedAt": quote_date or date.today(),
        "priority": 1,
    }


def fetch_cbu_uzs_per_kgs(rate_date):
    req = Request(
        CBU_KGS_RATE_URL.format(rate_date=rate_date.isoformat()),
        headers={"User-Agent": "SalesVisualization/1.0", "Accept": "application/json"},
    )
    last_error = None
    for timeout in (8, 15):
        try:
            with urlopen(req, timeout=timeout) as response:
                rates = json.loads(response.read().decode("utf-8"))
            break
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError) as exc:
            last_error = exc
    else:
        raise RuntimeError(f"乌兹别克央行索姆汇率获取失败：{last_error}") from last_error
    row = next(
        (item for item in rates if str(item.get("Ccy") or "").upper() == "KGS"),
        None,
    ) if isinstance(rates, list) else None
    value = parse_decimal(row.get("Rate") if row else None)
    if value is None or value <= 0:
        raise RuntimeError("乌兹别克央行索姆汇率获取失败：未找到 KGS 汇率")
    effective_date = parse_date(row.get("Date") if row else None) or rate_date
    return float(value), effective_date


def format_uzex_raw_price(value):
    return f"{float(value):,.2f} 千乌兹别克索姆/吨"


def build_uzex_price_text(label, value, density, uzs_per_kgs):
    if uzs_per_kgs:
        kgs_per_liter = float(value) * density / uzs_per_kgs
        return f"{label} {kgs_per_liter:,.2f} 索姆/升"
    return f"{label} {format_uzex_raw_price(value)}"


def market_refined_densities(cur, effective_date):
    product_codes = tuple(UZEX_PRODUCT_CODES.values())
    placeholders = ", ".join(["%s"] * len(product_codes))
    cur.execute(
        f"""
        SELECT p.product_code, d.density
        FROM product_density_history d
        JOIN products p ON p.id = d.product_id
        WHERE p.product_code IN ({placeholders}) AND d.effective_date <= %s
        ORDER BY p.product_code, d.effective_date DESC, d.id DESC
        """,
        (*product_codes, effective_date),
    )
    by_code = {}
    for product_code, density in cur.fetchall():
        by_code.setdefault(product_code, float(density))
    return {
        label: by_code.get(product_code, UZEX_FALLBACK_DENSITIES[label])
        for label, product_code in UZEX_PRODUCT_CODES.items()
    }


def fetch_uzex_market_item(cur):
    observed_at = date.today()
    req = Request(UZEX_QUOTES_URL, headers={"User-Agent": "SalesVisualization/1.0", "Accept": "application/json"})
    try:
        with urlopen(req, timeout=20) as response:
            quotes = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, TypeError) as exc:
        raise RuntimeError(f"UZEX 官方报价获取失败：{exc}") from exc

    quote_names = {
        "\u0411\u0415\u041d\u0417\u0418\u041d (80)": "汽油(80)",
        "\u0414\u0418\u0417\u0415\u041b\u042c \u0401\u049a\u0418\u041b\u0492\u0418\u0421\u0418": "柴油",
        "\u0421\u0423\u042e\u041b\u0422\u0418\u0420\u0418\u041b\u0413\u0410\u041d \u0413\u0410\u0417": "液化气",
    }
    uzs_per_kgs = None
    rate_date = None
    rate_error = None
    try:
        uzs_per_kgs, rate_date = fetch_cbu_uzs_per_kgs(observed_at)
    except RuntimeError as exc:
        rate_error = str(exc)
    densities = market_refined_densities(cur, observed_at)
    values = []
    movements = []
    for row in quotes if isinstance(quotes, list) else []:
        label = quote_names.get(clean_str(row.get("name")) or "")
        if not label:
            continue
        value = parse_decimal(row.get("summa"))
        if value is None:
            continue
        percent = clean_str(row.get("percent")) or "0.00"
        values.append(build_uzex_price_text(label, value, densities[label], uzs_per_kgs))
        movements.append(f"{label} {percent}%")
    if not values:
        raise RuntimeError("UZEX 官方报价获取失败：未找到油品报价")
    price_text = "；".join(values)
    density_text = "、".join(f"{label} {density:.3f}" for label, density in densities.items())
    if uzs_per_kgs:
        conversion_note = (
            f"按 UZEX 千乌兹别克索姆/吨报价、乌兹别克央行 {rate_date.isoformat()} 汇率"
            f"（1 索姆={uzs_per_kgs:,.2f} 乌兹别克索姆）及平台密度（{density_text}）换算"
        )
    else:
        conversion_note = (
            f"乌兹别克央行 KGS 汇率接口暂时不可用，今日先保留 UZEX 原始报价；"
            f"汇率恢复后可在后台重新获取并换算为索姆/升。{rate_error}"
        )
    return {
        "region": "Uzbekistan",
        "type": "refined",
        "title": "乌兹别克成品油公开报价",
        "summary": f"UZEX 官网公开报价折算：{price_text}；涨跌幅：{'；'.join(movements)}。{conversion_note}。",
        "priceText": price_text,
        "sourceName": "UZEX乌兹别克商品交易所",
        "sourceUrl": UZEX_SOURCE_URL,
        "observedAt": observed_at,
        "priority": 2,
    }


def spimex_official_reference_item():
    return {
        "region": "Russia",
        "type": "refined",
        "title": "俄罗斯成品油官方指数参考",
        "summary": "SPIMEX 官方提供成品油、液化气与原油指数。根据其信息使用条款，指数数值的再展示需按许可要求接入，当前平台先提供官方入口供经营复核。",
        "priceText": "",
        "sourceName": "SPIMEX彼得堡国际商品交易所",
        "sourceUrl": SPIMEX_INDICES_URL,
        "observedAt": date.today(),
        "priority": 2,
    }


def upsert_market_source_item(cur, item):
    cur.execute(
        """
        SELECT id FROM market_watch_items
        WHERE market_region = %s AND source_url = %s
        ORDER BY id DESC LIMIT 1
        """,
        (item["region"], item["sourceUrl"]),
    )
    existing = cur.fetchone()
    values = (
        item["title"], item["summary"], item.get("priceText") or None,
        item["sourceName"], item["sourceUrl"], item["observedAt"], item["priority"],
    )
    if existing:
        cur.execute(
            """
            UPDATE market_watch_items
            SET market_type = %s, title = %s, summary = %s, price_text = %s,
                source_name = %s, source_url = %s, observed_at = %s, priority = %s,
                is_active = TRUE
            WHERE id = %s
            """,
            (item["type"], *values, existing[0]),
        )
        cur.execute(
            """
            UPDATE market_watch_items
            SET is_active = FALSE
            WHERE market_region = %s AND source_url = %s AND id <> %s AND is_active = TRUE
            """,
            (item["region"], item["sourceUrl"], existing[0]),
        )
        return "updated"
    cur.execute(
        """
        INSERT INTO market_watch_items
            (market_region, market_type, title, summary, price_text, source_name, source_url, observed_at, priority, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
        """,
        (
            item["region"], item["type"], item["title"], item["summary"], item.get("priceText") or None,
            item["sourceName"], item["sourceUrl"], item["observedAt"], item["priority"],
        ),
    )
    return "inserted"


def has_chinese(text):
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


MARKET_TRANSLATION_TERMS = (
    ("centre for research on energy and clean air", "能源与清洁空气研究中心"),
    ("the times of emerging markets", "中亚时报"),
    ("times of emerging markets", "中亚时报"),
    ("s&p global", "标普全球"),
    ("the economic times", "经济时报"),
    ("tradingkey", "市场资讯"),
    ("oil slip", "油价回落"),
    ("kazakhstan enforces", "哈萨克斯坦实施"),
    ("kazakhstan", "哈萨克斯坦"),
    ("uzbekistan", "乌兹别克斯坦"),
    ("emerging markets", "中亚"),
    ("refined products", "成品油"),
    ("refined product", "成品油"),
    ("refinery margins", "炼厂利润"),
    ("refinery margin", "炼厂利润"),
    ("crack spread", "裂解价差"),
    ("condensate", "凝析油"),
    ("urals", "Urals 原油"),
    ("monthly analysis", "月度分析"),
    ("russian fossil fuel exports and sanctions", "俄罗斯化石燃料出口与制裁"),
    ("russian fossil fuel exports", "俄罗斯化石燃料出口"),
    ("russian", "俄罗斯"),
    ("russia", "俄罗斯"),
    ("fuel market situation in kyrgyzstan remains stable", "吉尔吉斯斯坦燃料市场形势保持稳定"),
    ("situation in kyrgyzstan remains stable", "吉尔吉斯斯坦市场形势保持稳定"),
    ("fuel market situation", "燃料市场形势"),
    ("market situation", "市场形势"),
    ("remains stable", "保持稳定"),
    ("kyrgyzstan", "吉尔吉斯斯坦"),
    ("fossil fuel", "化石燃料"),
    ("exports", "出口"),
    ("export", "出口"),
    ("sanctions", "制裁"),
    ("crude oil", "原油"),
    ("crude futures", "原油期货"),
    ("oil prices", "油价"),
    ("oil price", "油价"),
    ("diesel", "柴油"),
    ("gasoline", "汽油"),
    ("petrol", "汽油"),
    ("refinery", "炼厂"),
    ("refineries", "炼厂"),
    ("fuel", "燃料"),
    ("market", "市场"),
    ("situation", "形势"),
    ("inventory", "库存"),
    ("stocks", "库存"),
    ("stock", "库存"),
    ("enforces", "实施"),
    ("ban", "禁令"),
    ("opec", "OPEC"),
    ("brent", "Brent 原油"),
    ("wti", "WTI 原油"),
    ("april", "4月"),
    ("may", "5月"),
    ("june", "6月"),
    ("january", "1月"),
    ("february", "2月"),
    ("march", "3月"),
    ("july", "7月"),
    ("august", "8月"),
    ("september", "9月"),
    ("october", "10月"),
    ("november", "11月"),
    ("december", "12月"),
    (" of ", "的"),
    (" in ", "在"),
)


def translate_market_text(text):
    value = clean_str(text) or ""
    translated = value
    for raw, zh in MARKET_TRANSLATION_TERMS:
        pattern = rf"\b{raw}\b(?!\s*原油)" if raw in {"urals", "brent", "wti"} else raw
        translated = re.sub(pattern, zh, translated, flags=re.IGNORECASE)
    translated = re.sub(r"\b(Brent|WTI|Urals)\s*原油(?:\s*原油)+", r"\1 原油", translated)
    translated = re.sub(r"\s+-\s+[^-]{3,80}$", "", translated).strip()
    translated = translated.replace(" — ", "：").replace(" - ", "：")
    translated = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", translated)
    translated = re.sub(r"\s{2,}", " ", translated).strip(" -—：:")
    return translated or value


def market_source_display(source):
    source = clean_str(source) or ""
    if source.lower() == "yahoo finance":
        return "雅虎财经"
    return source if has_chinese(source) else "公开资讯"


def strip_market_source_echo(text, source):
    value = clean_str(text) or ""
    source = clean_str(source) or ""
    candidates = [source, translate_market_text(source)]
    for candidate in candidates:
        if candidate:
            value = re.sub(rf"\s*[-—：:]?\s*{re.escape(candidate)}\s*$", "", value, flags=re.IGNORECASE).strip()
    return value


def has_untranslated_market_english(text):
    value = clean_str(text) or ""
    value = re.sub(r"(OPEC|WTI|Brent|USD|CNY|KGS|SPIMEX|UZEX)", "", value, flags=re.IGNORECASE)
    return bool(re.search(r"[A-Za-z]{3,}", value))


def chinese_market_item(item):
    item = dict(item)
    title = item.get("title") or ""
    summary = item.get("summary") or ""
    source = market_source_display(item.get("sourceName"))
    translated_title = strip_market_source_echo(translate_market_text(title), item.get("sourceName"))
    translated_summary = strip_market_source_echo(
        translate_market_text(re.sub(r"\s+", " ", summary or title).strip()),
        item.get("sourceName"),
    )
    item["displayReady"] = not has_untranslated_market_english(translated_title + " " + translated_summary)
    if has_untranslated_market_english(translated_title):
        translated_title = f"{market_region_label(item.get('region'))}市场资讯更新"
    item["title"] = translated_title if translated_title else f"{market_region_label(item.get('region'))}市场资讯"
    translated_summary = re.sub(rf"^(?:{re.escape(source)}报道：)+", "", translated_summary).strip()
    if has_untranslated_market_english(translated_summary):
        translated_summary = item["title"]
    if translated_summary and translated_summary != item["title"]:
        item["summary"] = f"{source}报道：{translated_summary[:260]}"
    else:
        item["summary"] = f"{source}报道：{item['title']}"
    return item


def fetch_market_feed(feed):
    query = urlencode({
        "q": feed["query"],
        "hl": feed.get("hl", "en-US"),
        "gl": feed.get("gl", "KG"),
        "ceid": feed.get("ceid", "KG:en"),
    })
    request_url = f"https://news.google.com/rss/search?{query}"
    req = Request(
        request_url,
        headers={
            "User-Agent": "SalesVisualization/1.0",
            "Accept": "application/rss+xml,application/xml,text/xml,*/*",
        },
    )
    try:
        with urlopen(req, timeout=20) as response:
            raw_xml = response.read()
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"{market_region_label(feed['region'])}市场观察获取失败：{exc}") from exc

    try:
        root = ET.fromstring(raw_xml)
    except ET.ParseError as exc:
        raise RuntimeError(f"{market_region_label(feed['region'])}市场观察返回内容无法解析") from exc

    items = []
    for node in root.findall(".//item")[:3]:
        title = html.unescape(clean_str(node.findtext("title")) or "")
        link = clean_str(node.findtext("link")) or ""
        description = html.unescape(clean_str(node.findtext("description")) or "")
        description = re.sub(r"<.*?>", " ", description)
        description = re.sub(r"\s+", " ", description).strip()
        source_node = node.find("source")
        source_name = clean_str(source_node.text if source_node is not None else None) or "Google News"
        observed_at = date.today()
        pub_date = clean_str(node.findtext("pubDate"))
        if pub_date:
            try:
                observed_at = parsedate_to_datetime(pub_date).date()
            except (TypeError, ValueError, AttributeError):
                pass
        if title and link:
            items.append({
                "region": feed["region"],
                "type": feed["type"],
                "title": title[:255],
                "summary": (description or title)[:900],
                "priceText": extract_market_price_text(title, description),
                "sourceName": source_name[:128],
                "sourceUrl": link[:500],
                "observedAt": observed_at,
                "priority": feed["priority"] + len(items),
            })
    return items


def refresh_market_watch_chinese(cur, limit=120):
    ensure_market_watch_schema(cur)
    cur.execute(
        """
        SELECT id, market_region, title, summary, source_name, observed_at
        FROM market_watch_items
        WHERE is_active = TRUE
        ORDER BY observed_at DESC, priority ASC, id DESC
        LIMIT %s
        """,
        (limit,),
    )
    rows = cur.fetchall()
    updated = 0
    for item_id, region, title, summary, source_name, observed_at in rows:
        zh_item = chinese_market_item({
            "region": region,
            "title": title,
            "summary": summary,
            "sourceName": source_name,
            "observedAt": observed_at.isoformat() if observed_at else None,
        })
        new_title = zh_item.get("title") or title
        new_summary = zh_item.get("summary") or summary
        new_source = market_source_display(source_name)
        if new_title != title or new_summary != summary or new_source != source_name:
            cur.execute(
                """
                UPDATE market_watch_items
                SET title = %s, summary = %s, source_name = %s
                WHERE id = %s
                """,
                (new_title[:255], new_summary[:900], new_source[:128], item_id),
            )
            updated += 1
    return updated



def run_exchange_maintenance(cur):
    today = date.today()
    start = date(today.year, today.month, 1)
    end = today + timedelta(days=1)
    dates = missing_exchange_dates(cur, start, end)
    fetched = []
    unresolved = []
    errors = []
    for rate_date in dates:
        try:
            usd, cny, source_url = fetch_nbkr_daily_rates(rate_date)
            resolved = upsert_exchange_rate(cur, rate_date, usd, cny, f"NBKR 历史页面自动获取：{source_url}")
            fetched.append({
                "date": rate_date.isoformat(),
                "usdKgs": float(usd) if usd is not None else None,
                "cnyKgs": float(cny) if cny is not None else None,
                "resolved": resolved,
            })
            if not resolved:
                unresolved.append(rate_date.isoformat())
        except RuntimeError as exc:
            errors.append({"date": rate_date.isoformat(), "error": str(exc)})
    recalculation = recalculate_all_wholesale(cur) if fetched else {"matched": 0, "unmatched": 0, "missing_rates": 0}
    return {
        "requested": len(dates),
        "updated": len(fetched),
        "resolved": sum(1 for item in fetched if item["resolved"]),
        "unresolved": unresolved,
        "errors": errors,
        "recalculation": recalculation,
    }


def run_market_watch_maintenance(cur):
    ensure_market_watch_schema(cur)
    official_items = []
    source_errors = []
    try:
        official_items.append(fetch_market_benchmark_item())
    except RuntimeError as exc:
        source_errors.append(str(exc))
    try:
        official_items.append(fetch_uzex_market_item(cur))
    except RuntimeError as exc:
        source_errors.append(str(exc))
    official_items.append(spimex_official_reference_item())
    inserted = 0
    updated = 0
    for item in official_items:
        status = upsert_market_source_item(cur, item)
        inserted += status == "inserted"
        updated += status == "updated"
    translated = refresh_market_watch_chinese(cur)
    return {
        "fetched": len(official_items),
        "inserted": inserted,
        "updated": updated,
        "translated": translated,
        "warnings": source_errors if official_items else [],
        "errors": [] if official_items else source_errors,
    }


def run_retail_snapshot_maintenance():
    script = OILSTATION_ROOT / "scripts" / "refresh_current_snapshots.py"
    if not script.exists():
        raise RuntimeError(f"零售快照脚本不存在：{script}")
    completed = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(OILSTATION_ROOT),
        capture_output=True,
        text=True,
        timeout=900,
    )
    output = (completed.stdout or completed.stderr or "").strip()
    if completed.returncode != 0:
        raise RuntimeError(output[-1000:] or f"零售快照脚本退出码 {completed.returncode}")
    return {
        "returnCode": completed.returncode,
        "outputTail": output[-1200:],
    }


def _nbkr_daily_url(rate_date):
    separator = "&" if "?" in NBKR_DAILY_XML_URL else "?"
    query = urlencode({"date": rate_date.strftime("%d.%m.%Y")})
    return f"{NBKR_DAILY_XML_URL}{separator}{query}"


def _nbkr_history_url(rate_date, currency_id):
    return "https://www.nbkr.kg/index1.jsp?" + urlencode({
        "beg_day": f"{rate_date.day:02d}",
        "beg_month": f"{rate_date.month:02d}",
        "beg_year": rate_date.year,
        "end_day": f"{rate_date.day:02d}",
        "end_month": f"{rate_date.month:02d}",
        "end_year": rate_date.year,
        "item": 1562,
        "lang": "ENG",
        "valuta_id": currency_id,
    })


def fetch_nbkr_history_rate(rate_date, currency_id):
    request_url = _nbkr_history_url(rate_date, currency_id)
    req = Request(
        request_url,
        headers={
            "User-Agent": "SalesVisualization/1.0",
            "Accept": "text/html,*/*",
        },
    )
    try:
        with urlopen(req, timeout=20) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"NBKR 历史汇率页面获取失败：{exc}") from exc

    expected = rate_date.strftime("%d.%m.%Y")
    match = re.search(
        rf"<!--date-->\s*{re.escape(expected)}\s*<!--date-->.*?<!--value-->\s*([^<]+?)\s*<!--value-->",
        html,
        flags=re.S,
    )
    if not match:
        raise RuntimeError(f"NBKR 历史汇率页面未返回 {expected} 的汇率")
    value = parse_decimal(match.group(1))
    if value is None:
        raise RuntimeError(f"NBKR 历史汇率页面中 {expected} 的汇率无法解析")
    return value, request_url


def fetch_nbkr_daily_rates(rate_date):
    usd, usd_url = fetch_nbkr_history_rate(rate_date, 15)
    cny, cny_url = fetch_nbkr_history_rate(rate_date, 24)
    return usd, cny, f"USD:{usd_url}; CNY:{cny_url}"


def fetch_nbkr_latest_daily_rates(rate_date):
    request_url = _nbkr_daily_url(rate_date)
    req = Request(
        request_url,
        headers={
            "User-Agent": "SalesVisualization/1.0",
            "Accept": "application/xml,text/xml,*/*",
        },
    )
    try:
        with urlopen(req, timeout=20) as response:
            raw_xml = response.read()
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"NBKR 汇率获取失败：{exc}") from exc

    try:
        root = ET.fromstring(raw_xml)
    except ET.ParseError as exc:
        raise RuntimeError("NBKR 返回内容无法解析") from exc

    returned_date = parse_date(root.attrib.get("Date"))
    if returned_date and returned_date != rate_date:
        raise RuntimeError(
            f"NBKR daily.xml 返回日期为 {returned_date.isoformat()}，不是请求的 {rate_date.isoformat()}"
        )

    rates = {"USD": None, "CNY": None}
    for node in root.iter():
        iso = (node.attrib.get("ISOCode") or node.attrib.get("isocode") or "").upper()
        if iso not in rates:
            continue
        value_node = node.find("Value")
        if value_node is None:
            value_node = node.find("value")
        value = parse_decimal(value_node.text if value_node is not None else None)
        if value is not None:
            rates[iso] = value
    return rates["USD"], rates["CNY"], request_url


def missing_exchange_dates(cur, start, end):
    fetch_end = min(end, date.today() + timedelta(days=1))
    if start >= fetch_end:
        return []

    cur.execute(
        """
        SELECT DISTINCT rate_date
        FROM (
            SELECT rate_date
            FROM exchange_rate_gaps
            WHERE rate_date >= %s AND rate_date < %s
              AND status = 'open'
            UNION
            SELECT rate_date
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
              AND (
                usd_kgs IS NULL
                OR cny_kgs IS NULL
                OR (is_manual = FALSE AND note LIKE '%%/XML/daily.xml?date=%%')
              )
            UNION
            SELECT exchange_rate_date AS rate_date
            FROM calculation_results
            WHERE exchange_rate_date >= %s AND exchange_rate_date < %s
              AND exchange_missing = TRUE
            UNION
            SELECT issue_date AS rate_date
            FROM data_quality_issues
            WHERE issue_type = 'missing_exchange_rate'
              AND issue_date >= %s AND issue_date < %s
        ) missing_dates
        WHERE rate_date IS NOT NULL
        ORDER BY rate_date
        """,
        (start, fetch_end, start, fetch_end, start, fetch_end, start, fetch_end),
    )
    dates = {row[0] for row in cur.fetchall()}

    cur.execute(
        """
        SELECT rate_date
        FROM exchange_rates
        WHERE rate_date >= %s AND rate_date < %s
          AND usd_kgs IS NOT NULL
          AND cny_kgs IS NOT NULL
          AND NOT (is_manual = FALSE AND note IS NOT NULL AND note LIKE '%%/XML/daily.xml?date=%%')
        """,
        (start, fetch_end),
    )
    complete_dates = {row[0] for row in cur.fetchall()}

    current = start
    while current < fetch_end:
        if current not in complete_dates:
            dates.add(current)
        current += timedelta(days=1)

    return sorted(dates)


def upsert_exchange_rate(cur, rate_date, usd, cny, note):
    cur.execute(
        """
        INSERT INTO exchange_rates
            (rate_date, usd_kgs, cny_kgs, source, is_manual, fetched_at, note)
        VALUES (%s, %s, %s, 'NBKR', FALSE, CURRENT_TIMESTAMP, %s)
        ON DUPLICATE KEY UPDATE
            usd_kgs = IF(is_manual = TRUE AND usd_kgs IS NOT NULL, usd_kgs, COALESCE(VALUES(usd_kgs), usd_kgs)),
            cny_kgs = IF(is_manual = TRUE AND cny_kgs IS NOT NULL, cny_kgs, COALESCE(VALUES(cny_kgs), cny_kgs)),
            source = IF(is_manual = TRUE, source, 'NBKR'),
            fetched_at = CURRENT_TIMESTAMP,
            note = IF(is_manual = TRUE AND note IS NOT NULL, note, VALUES(note))
        """,
        (rate_date, usd, cny, note),
    )
    cur.execute("SELECT usd_kgs, cny_kgs FROM exchange_rates WHERE rate_date = %s", (rate_date,))
    saved = cur.fetchone()
    missing_usd = not saved or saved[0] is None
    missing_cny = not saved or saved[1] is None
    if missing_usd or missing_cny:
        cur.execute(
            """
            INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, status, note)
            VALUES (%s, %s, %s, 'open', 'NBKR 自动获取后仍缺少部分汇率。')
            ON DUPLICATE KEY UPDATE
                missing_usd = VALUES(missing_usd),
                missing_cny = VALUES(missing_cny),
                status = 'open',
                note = VALUES(note)
            """,
            (rate_date, missing_usd, missing_cny),
        )
        return False

    cur.execute(
        """
        INSERT INTO exchange_rate_gaps (rate_date, missing_usd, missing_cny, status, resolved_at, note)
        VALUES (%s, FALSE, FALSE, 'resolved', CURRENT_TIMESTAMP, 'Resolved by NBKR automatic fetch.')
        ON DUPLICATE KEY UPDATE
            missing_usd = FALSE,
            missing_cny = FALSE,
            status = 'resolved',
            resolved_at = CURRENT_TIMESTAMP,
            note = VALUES(note)
        """,
        (rate_date,),
    )
    return True



def register_data_routes(app):
    """Register data routes."""
    def create_manual_batch(cur, note, period_date=None):
        period_year = period_date.year if period_date else None
        period_month = period_date.month if period_date else None
        cur.execute(
            """
            INSERT INTO import_batches
                (source_type, period_year, period_month, status, imported_at, note)
            VALUES ('manual', %s, %s, 'imported', CURRENT_TIMESTAMP, %s)
            """,
            (period_year, period_month, note),
        )
        return cur.lastrowid


    def detect_upload_type(path):
        xl = pd.ExcelFile(path)
        if len(xl.sheet_names) > SHEET_DETAIL:
            return "wholesale"
        return "contracts"


    def upload_type_label(upload_type):
        return "外运外销表" if upload_type == "wholesale" else "合同登记表"




    def issue_auth_tokens(user):
        identity = str(user.get("id"))
        access_token = create_access_token(
            identity=identity,
            additional_claims={
                "username": user.get("username"),
                "role": user.get("role"),
                "mustChangePassword": bool(user.get("mustChangePassword")),
            },
            expires_delta=timedelta(hours=2),
        )
        refresh_token = create_refresh_token(identity=identity, expires_delta=timedelta(days=7))
        return {"accessToken": access_token, "refreshToken": refresh_token}


    @app.route("/api/auth/status")
    def api_auth_status():
        conn = get_connection()
        try:
            cur = conn.cursor()
            user = session_user()
            if user:
                ensure_auth_schema(cur)
                cur.execute(
                    """
                    SELECT id, username, display_name, role, must_change_password
                    FROM system_users
                    WHERE id = %s AND is_active = TRUE
                    """,
                    (user.get("id"),),
                )
                row = cur.fetchone()
                if row:
                    user = {
                        "id": row[0],
                        "username": row[1],
                        "displayName": row[2],
                        "role": row[3],
                        "mustChangePassword": bool(row[4]),
                    }
                    session["user"] = user
                else:
                    session.clear()
                    user = None
            if not user:
                identity = None
                try:
                    verify_jwt_in_request(optional=True)
                    identity = get_jwt_identity()
                except Exception:
                    identity = None
                if identity:
                    ensure_auth_schema(cur)
                    cur.execute(
                        """
                        SELECT id, username, display_name, role, must_change_password
                        FROM system_users
                        WHERE id = %s AND is_active = TRUE
                        """,
                        (identity,),
                    )
                    row = cur.fetchone()
                    if row:
                        user = {
                            "id": row[0],
                            "username": row[1],
                            "displayName": row[2],
                            "role": row[3],
                            "mustChangePassword": bool(row[4]),
                        }
                        session.permanent = True
                        session["user"] = user
            response = {
                "hasUsers": has_users(cur),
                "authenticated": bool(user),
                "user": user,
            }
            if user:
                response.update(issue_auth_tokens(user))
            return jsonify(response)
        finally:
            conn.close()


    _ASSISTANT_DIGIT_TRANSLATION = str.maketrans("０１２３４５６７８９", "0123456789")

    @app.route("/api/auth/bootstrap", methods=["POST"])
    def api_auth_bootstrap():
        payload = request.get_json(force=True)
        username = clean_str(payload.get("username"))
        password = payload.get("password") or ""
        display_name = clean_str(payload.get("displayName")) or username
        if password and len(password) < 8:
            return jsonify({"error": "密码长度不能少于8位"}), 400
        if not username or len(password) < 6:
            return jsonify({"error": "用户名和至少 6 位密码必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            if has_users(cur):
                return jsonify({"error": "系统已完成首次管理员创建"}), 409
            cur.execute(
                """
                INSERT INTO system_users
                    (username, password_hash, display_name, role, must_change_password, password_changed_at)
                VALUES (%s, %s, %s, 'admin', FALSE, CURRENT_TIMESTAMP)
                """,
                (username, generate_password_hash(password), display_name),
            )
            user_id = cur.lastrowid
            log_operation(cur, "bootstrap_admin", "system_users", user_id, {"username": username})
            conn.commit()
            session.permanent = True
            session["user"] = {
                "id": user_id,
                "username": username,
                "displayName": display_name,
                "role": "admin",
                "mustChangePassword": False,
            }
            return jsonify({"ok": True, "user": session["user"], **issue_auth_tokens(session["user"])})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/auth/login", methods=["POST"])
    def api_auth_login():
        payload = request.get_json(force=True)
        username = clean_str(payload.get("username"))
        password = payload.get("password") or ""
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_auth_schema(cur)
            cur.execute(
                """
                SELECT id, username, password_hash, display_name, role, is_active, must_change_password
                FROM system_users
                WHERE username = %s
                """,
                (username,),
            )
            row = cur.fetchone()
            if not row or not row[5] or not check_password_hash(row[2], password):
                log_operation(
                    cur,
                    "login_failed",
                    "system_users",
                    username,
                    {"username": username, "reason": "invalid_credentials", "remoteAddr": request.remote_addr},
                )
                conn.commit()
                return jsonify({"error": "用户名或密码不正确"}), 401
            cur.execute("UPDATE system_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = %s", (row[0],))
            log_operation(cur, "login_success", "system_users", row[0], {"username": row[1], "remoteAddr": request.remote_addr})
            conn.commit()
            session.permanent = True
            session["user"] = {
                "id": row[0],
                "username": row[1],
                "displayName": row[3],
                "role": row[4],
                "mustChangePassword": bool(row[6]),
            }
            return jsonify({"ok": True, "user": session["user"], **issue_auth_tokens(session["user"])})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/auth/logout", methods=["POST"])
    def api_auth_logout():
        user = session_user()
        if user:
            log_system_operation("logout", "system_users", user.get("id"), {"username": user.get("username")})
        session.clear()
        return jsonify({"ok": True})


    @app.route("/api/auth/change-password", methods=["POST"])
    def api_auth_change_password():
        user = session_user()
        if not user:
            return jsonify({"error": "login_required"}), 401
        payload = request.get_json(force=True)
        old_password = payload.get("oldPassword") or ""
        new_password = payload.get("newPassword") or ""
        if not old_password or not new_password:
            return jsonify({"error": "旧密码和新密码不能为空"}), 400
        if len(new_password) < 8:
            return jsonify({"error": "新密码长度不能少于8位"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_auth_schema(cur)
            cur.execute("SELECT password_hash FROM system_users WHERE id = %s AND is_active = TRUE", (user.get("id"),))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "user_not_found"}), 404
            if not check_password_hash(row[0], old_password):
                return jsonify({"error": "旧密码不正确"}), 401
            if check_password_hash(row[0], new_password):
                return jsonify({"error": "新密码不能与旧密码相同"}), 400
            cur.execute(
                """
                UPDATE system_users
                SET password_hash = %s,
                    must_change_password = FALSE,
                    password_changed_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (generate_password_hash(new_password), user.get("id")),
            )
            log_operation(cur, "change_password", "system_users", user.get("id"), {"username": user.get("username")})
            conn.commit()
            session["user"] = {
                **user,
                "mustChangePassword": False,
            }
            return jsonify({"ok": True, "mustChangePassword": False, **issue_auth_tokens(session["user"])})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()



    @app.route("/api/retail/station-catalog")
    @admin_required
    def api_retail_station_catalog():
        return jsonify({"items": list(retail_station_catalog().values())})


    @app.route("/api/retail/station-statuses")
    def api_retail_station_statuses():
        conn = get_connection()
        try:
            cur = conn.cursor()
            statuses = active_station_statuses(cur)
            return jsonify({"items": list(statuses.values())})
        finally:
            conn.close()

    @app.route("/api/periods")
    def api_periods():
        conn = get_connection()
        try:
            cur = conn.cursor()
            return jsonify(available_periods(cur))
        finally:
            conn.close()


    @app.route("/api/summary")
    def api_summary():
        year = int(request.args.get("year", "2026"))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        conn = get_connection()
        try:
            cur = conn.cursor()
            return jsonify(summarize_combined(cur, year, month))
        finally:
            conn.close()


    @app.route("/api/home/exchange-current")
    def api_home_exchange_current():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT rate_date, usd_kgs, cny_kgs, source, is_manual, note
                FROM exchange_rates
                WHERE rate_date <= CURDATE()
                  AND (usd_kgs IS NOT NULL OR cny_kgs IS NOT NULL)
                ORDER BY rate_date DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
            if not row:
                return jsonify({
                    "available": False,
                    "message": "暂无汇率快照，请在后台补录。",
                })
            rate_date, usd_kgs, cny_kgs, source, is_manual, note = row
            return jsonify({
                "available": True,
                "date": rate_date.isoformat() if rate_date else None,
                "usdKgs": float(usd_kgs) if usd_kgs is not None else None,
                "cnyKgs": float(cny_kgs) if cny_kgs is not None else None,
                "source": source,
                "isManual": bool(is_manual),
                "isToday": rate_date == date.today() if rate_date else False,
            })
        finally:
            conn.close()


    @app.route("/api/home/market-watch")
    def api_home_market_watch():
        conn = get_connection()
        try:
            cur = conn.cursor()
            ensure_market_watch_schema(cur)
            cur.execute(
                """
                SELECT id, market_region, market_type, title, summary,
                       price_text, source_name, source_url, observed_at
                FROM market_watch_items
                WHERE is_active = TRUE
                  AND market_region IN ('Russia', 'Uzbekistan', 'Global')
                ORDER BY observed_at DESC, priority ASC, id DESC
                LIMIT 30
                """
            )
            rows = [
                {
                    "id": row[0],
                    "region": row[1],
                    "type": row[2],
                    "typeLabel": market_type_label(row[2]),
                    "title": row[3],
                    "summary": row[4],
                    "priceText": row[5] or "",
                    "sourceName": row[6] or "",
                    "sourceUrl": row[7] or "",
                    "observedAt": row[8].isoformat() if row[8] else None,
                }
                for row in cur.fetchall()
            ]
            rows = [chinese_market_item(item) for item in rows]
            by_region = {}
            grouped = {}
            for item in rows:
                grouped.setdefault(item["region"], []).append(item)
                by_region.setdefault(item["region"], item)
            items = []
            for key in ("Russia", "Uzbekistan", "Global"):
                if key not in by_region:
                    continue
                region_rows = grouped.get(key, [])
                display_rows = [row for row in region_rows if row.get("displayReady")]
                item = dict(display_rows[0] if display_rows else by_region[key])
                detail_rows = [
                    {
                        "title": detail.get("title") or "",
                        "summary": detail.get("summary") or "",
                        "priceText": detail.get("priceText") or "",
                        "typeLabel": detail.get("typeLabel") or market_type_label(detail.get("type")),
                        "sourceName": detail.get("sourceName") or "",
                        "sourceUrl": detail.get("sourceUrl") or "",
                        "observedAt": detail.get("observedAt"),
                    }
                    for detail in (display_rows or region_rows)[:5]
                ]
                seen_detail_labels = {detail.get("typeLabel") for detail in detail_rows if detail.get("typeLabel")}
                for fallback_detail in default_market_details(key):
                    if fallback_detail["typeLabel"] not in seen_detail_labels:
                        detail_rows.append(fallback_detail)
                        seen_detail_labels.add(fallback_detail["typeLabel"])
                item["details"] = detail_rows[:5]
                items.append(item)
            latest_observed_at = None
            for item in rows:
                observed_at = item.get("observedAt")
                if observed_at and (latest_observed_at is None or observed_at > latest_observed_at):
                    latest_observed_at = observed_at
            if not items:
                items = [
                    {
                        "id": 0,
                        "region": "Russia",
                        "type": "refined",
                        "typeLabel": "成品油",
                        "title": "俄罗斯成品油市场",
                        "summary": "市场观察数据尚未维护，建议由后台录入俄罗斯炼厂开工、出口限制、铁路运输、批发价格和汽柴油供应变化。",
                        "sourceName": "",
                        "sourceUrl": "",
                        "observedAt": None,
                        "details": [
                            {"typeLabel": "市场行情", "title": "俄罗斯市场行情", "summary": "跟踪批发价格、区域供应和运输变化。"},
                            {"typeLabel": "原料油", "title": "俄罗斯原料油", "summary": "关注 Urals 原油、炼厂开工和出口流向。"},
                            {"typeLabel": "成品油", "title": "俄罗斯成品油", "summary": "关注汽油、柴油库存、出口政策和铁路发运。"},
                        ],
                    },
                    {
                        "id": 0,
                        "region": "Uzbekistan",
                        "type": "refined",
                        "typeLabel": "成品油",
                        "title": "乌兹别克成品油市场",
                        "summary": "市场观察数据尚未维护，建议跟踪当地汽柴油生产、进口、库存、批发价格和邻国供应变化。",
                        "sourceName": "",
                        "sourceUrl": "",
                        "observedAt": None,
                        "details": [
                            {"typeLabel": "市场行情", "title": "乌兹别克市场行情", "summary": "跟踪国内供应、进口节奏和批发成交。"},
                            {"typeLabel": "原料油", "title": "乌兹别克原料油", "summary": "关注凝析油、炼厂原料供应和生产负荷。"},
                            {"typeLabel": "成品油", "title": "乌兹别克成品油", "summary": "关注汽油、柴油供应、库存和周边价格变化。"},
                        ],
                    },
                    {
                        "id": 0,
                        "region": "Global",
                        "type": "crude",
                        "typeLabel": "原油",
                        "title": "国际原油参考",
                        "summary": "待录入 Brent、WTI、OPEC+、国际库存、裂解价差和炼厂利润等参考信息，用于辅助批发与零售经营判断。",
                        "sourceName": "",
                        "sourceUrl": "",
                        "observedAt": None,
                        "details": [
                            {"typeLabel": "市场行情", "title": "国际市场行情", "summary": "关注宏观需求、航运、库存和风险事件。"},
                            {"typeLabel": "原料油", "title": "国际原油", "summary": "关注 Brent、WTI、OPEC+ 和库存变化。"},
                            {"typeLabel": "成品油", "title": "国际成品油", "summary": "关注汽柴油裂解价差、炼厂利润和区域套利。"},
                        ],
                    },
                ]
            return jsonify({"items": items, "updatedAt": latest_observed_at or date.today().isoformat()})
        finally:
            conn.close()


    @app.route("/api/exchange-rates")
    def api_exchange_rates():
        year = int(request.args.get("year", str(date.today().year)))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            return jsonify(exchange_rates(cur, start, end))
        finally:
            conn.close()


    @app.route("/api/wholesale")
    def api_wholesale():
        year = int(request.args.get("year", "2026"))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        conn = get_connection()
        try:
            cur = conn.cursor()
            return jsonify(summarize_wholesale_page(cur, year, month))
        finally:
            conn.close()


    @app.route("/api/review/details")
    def api_review_details():
        kind = request.args.get("kind", "pending")
        year = int(request.args.get("year", "2026"))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            if kind == "issues":
                items = review_issue_rows(cur, start, end)
            else:
                items = review_detail_rows(cur, start, end, kind)
            return jsonify({"kind": kind, "items": items})
        finally:
            conn.close()


    @app.route("/api/review/correct", methods=["POST"])
    def api_review_correct():
        payload = request.get_json(force=True)
        detail_ids = payload.get("detailIds") or []
        issue_ids = payload.get("issueIds") or []
        detail_ids = [int(i) for i in detail_ids if str(i).isdigit()]
        issue_ids = [int(i) for i in issue_ids if str(i).isdigit()]
        conn = get_connection()
        try:
            cur = conn.cursor()
            updated_details = 0
            updated_issues = 0
            if detail_ids:
                updates = []
                classification = payload.get("classification")
                if classification:
                    updates.append(f"classification = '{classification}'")
                entity_name = payload.get("entityName", "").strip()
                if entity_name:
                    cur.execute("SELECT standard_name FROM customers WHERE normalized_name = %s LIMIT 1", (normalize_text(entity_name),))
                    c = cur.fetchone()
                    if c:
                        updates.append(f"standard_entity_name = '{c[0]}'")
                    else:
                        updates.append(f"standard_entity_name = '{entity_name}'")
                if updates:
                    cur.execute(f"UPDATE wholesale_detail_records SET {', '.join(updates)} WHERE id IN ({','.join('?' * len(detail_ids)).replace('?', '%s')})", detail_ids)
                    updated_details = cur.rowcount
            if issue_ids:
                issue_status = payload.get("issueStatus")
                if issue_status:
                    cur.execute(f"UPDATE data_quality_issues SET severity = %s WHERE id IN ({','.join('?' * len(issue_ids)).replace('?', '%s')})", (issue_status, *issue_ids))
                    updated_issues = cur.rowcount
            conn.commit()
            return jsonify({"ok": True, "updatedDetails": updated_details, "updatedIssues": updated_issues})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.route("/api/admin/weigh/audit", methods=["GET", "POST"])
    @admin_required
    def api_admin_weigh_audit():
        if request.method == "GET":
            conn = get_connection()
            try:
                cur = conn.cursor()
                year = int(request.args.get("year", str(date.today().year)))
                month_raw = request.args.get("month")
                month = int(month_raw) if month_raw else None
                start, end = period_bounds(year, month)
                items = review_detail_rows(cur, start, end, "weigh")
                return jsonify({"items": items, "kind": "weigh"})
            finally:
                conn.close()
        payload = request.get_json(force=True)
        detail_ids = payload.get("detailIds") or []
        action = payload.get("action", "approve")
        detail_ids = [int(i) for i in detail_ids if str(i).isdigit()]
        if not detail_ids:
            return jsonify({"error": "no detailIds provided"}), 400
        audit_status = "approved" if action == "approve" else "rejected"
        conn = get_connection()
        try:
            cur = conn.cursor()
            placeholders = ", ".join(["%s"] * len(detail_ids))
            cur.execute(f"UPDATE wholesale_detail_records SET audit_status = %s WHERE id IN ({placeholders})", [audit_status] + detail_ids)
            conn.commit()
            return jsonify({"ok": True, "updated": cur.rowcount, "auditStatus": audit_status})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.route("/api/reference/options")
    def api_reference_options():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT product_code, display_name FROM products WHERE is_active = TRUE ORDER BY display_name")
            products = [{"code": row[0], "name": row[1]} for row in cur.fetchall()]
            cur.execute("SELECT standard_name, customer_type FROM customers ORDER BY standard_name LIMIT 500")
            customers = [{"name": row[0], "type": row[1]} for row in cur.fetchall()]
            return jsonify({"products": products, "customers": customers})
        finally:
            conn.close()


    @app.route("/api/import/upload", methods=["POST"])
    @admin_required
    def api_import_upload():
        file = request.files.get("file")
        if not file or not file.filename:
            return jsonify({"error": "请选择 Excel 文件"}), 400
        UPLOAD_ROOT.mkdir(exist_ok=True)
        filename = secure_filename(file.filename) or "upload.xlsx"
        suffix = Path(filename).suffix or ".xlsx"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=UPLOAD_ROOT) as tmp:
            file.save(tmp.name)
            saved_path = tmp.name
        try:
            upload_type = detect_upload_type(saved_path)
            if upload_type == "wholesale":
                batch_id = import_wholesale(saved_path)
                recalc = None
                conn = get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute("UPDATE import_batches SET original_filename = %s WHERE id = %s", (file.filename, batch_id))
                    log_operation(cur, "upload_wholesale_excel", "import_batches", batch_id, {"filename": file.filename})
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.close()
            else:
                batch_id = import_contracts(saved_path)
                conn = get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute("UPDATE import_batches SET original_filename = %s WHERE id = %s", (file.filename, batch_id))
                    recalc = recalculate_all_wholesale(cur)
                    log_operation(cur, "upload_contract_excel", "import_batches", batch_id, {"filename": file.filename})
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.close()
            return jsonify({
                "ok": True,
                "batchId": batch_id,
                "uploadType": upload_type,
                "uploadLabel": upload_type_label(upload_type),
                "recalculation": recalc,
            })
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500


    @app.route("/api/manual/wholesale-detail", methods=["POST"])
    @admin_required
    def api_manual_wholesale_detail():
        payload = request.get_json(force=True)
        business_date = parse_date(payload.get("businessDate"))
        raw_product = clean_str(payload.get("productName"))
        product_code = clean_str(payload.get("productCode"))
        raw_entity = clean_str(payload.get("entityName"))
        classification = payload.get("classification") or "unknown"
        weight_kg = parse_decimal(payload.get("weightKg"))
        if classification not in ("local_wholesale", "export_wholesale", "transfer", "processing", "procurement", "unknown"):
            classification = "unknown"
        if not business_date or not raw_entity or weight_kg is None or (not raw_product and not product_code):
            return jsonify({"error": "日期、油品、客户/去向、重量必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            product = None
            if product_code:
                cur.execute("SELECT id, display_name FROM products WHERE product_code = %s", (product_code,))
                row = cur.fetchone()
                if row:
                    product = {"id": row[0], "display_name": row[1]}
                    raw_product = raw_product or row[1]
            if not product:
                product = lookup_product(load_product_lookup(cur), raw_product)
            entity = lookup_entity(load_entity_lookup(cur), raw_entity)
            if classification in ("local_wholesale", "export_wholesale", "unknown"):
                get_or_create_customer(cur, raw_entity, classification if classification != "unknown" else "unknown")
            batch_id = create_manual_batch(cur, "Manual wholesale detail entry.", business_date)
            match_status = "matched" if classification in ("transfer", "processing", "procurement") else "unmatched"
            weigh_serial_no = clean_str(payload.get("weighSerialNo"))
            sender_name = clean_str(payload.get("senderName"))
            cur.execute(
                """
                INSERT INTO wholesale_detail_records
                    (batch_id, source_row_number, business_date, raw_product_name, product_id,
                     vehicle_no, weigh_serial_no, raw_entity_name, sender_name, entity_type,
                     entity_code, standard_entity_name, classification, weight_kg, remark, match_status)
                VALUES (%s, 1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    batch_id,
                    business_date,
                    raw_product,
                    product["id"] if product else None,
                    clean_str(payload.get("vehicleNo")),
                    weigh_serial_no,
                    raw_entity,
                    sender_name,
                    entity["entity_type"] if entity else "unknown",
                    entity["entity_code"] if entity else None,
                    entity["standard_name"] if entity else None,
                    classification,
                    weight_kg,
                    clean_str(payload.get("remark")),
                    match_status,
                ),
            )
            if not product:
                cur.execute(
                    """
                    INSERT INTO data_quality_issues
                        (issue_type, severity, related_table, issue_date, message)
                    VALUES ('unknown_product', 'warning', 'wholesale_detail_records', %s, %s)
                    """,
                    (business_date, f"Manual detail product is not mapped: {raw_product}"),
                )
            result = recalculate_wholesale_batch(cur, batch_id)
            log_operation(
                cur,
                "manual_wholesale_detail",
                "import_batches",
                batch_id,
                {"businessDate": business_date.isoformat(), "classification": classification, "entityName": raw_entity},
            )
            conn.commit()
            return jsonify({"ok": True, "batchId": batch_id, "recalculation": result})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/manual/contract", methods=["POST"])
    @admin_required
    def api_manual_contract():
        payload = request.get_json(force=True)
        customer = clean_str(payload.get("customerName"))
        contract_no = clean_str(payload.get("contractNo"))
        raw_product = clean_str(payload.get("productName"))
        product_code = clean_str(payload.get("productCode"))
        if not customer or not contract_no or (not raw_product and not product_code):
            return jsonify({"error": "客户、合同号、油品必填"}), 400
        conn = get_connection()
        try:
            cur = conn.cursor()
            product = None
            if product_code:
                cur.execute("SELECT id, display_name FROM products WHERE product_code = %s", (product_code,))
                row = cur.fetchone()
                if row:
                    product = {"id": row[0], "display_name": row[1]}
                    raw_product = raw_product or row[1]
            if not product:
                product = lookup_product(load_product_lookup(cur), raw_product)
            sales_type = payload.get("salesType") if payload.get("salesType") in ("local_wholesale", "export_wholesale", "internal", "unknown") else "unknown"
            customer_id = get_or_create_customer(cur, customer, sales_type if sales_type != "internal" else "unknown")
            signed_date = parse_date(payload.get("signedDate"))
            batch_id = create_manual_batch(cur, "Manual contract entry.", signed_date or date.today())
            cur.execute(
                """
                INSERT INTO contracts
                    (batch_id, customer_id, raw_customer_name, contract_no, appendix_no,
                     signed_date, effective_start, effective_end, product_id, raw_product_name,
                     destination, sales_type, price_with_logistics, price_without_logistics,
                     contract_quantity_tons, contract_amount_original, currency_code, remark)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    batch_id,
                    customer_id,
                    customer,
                    contract_no,
                    clean_str(payload.get("appendixNo")),
                    signed_date,
                    parse_date(payload.get("effectiveStart")),
                    parse_date(payload.get("effectiveEnd")),
                    product["id"] if product else None,
                    raw_product,
                    clean_str(payload.get("destination")),
                    sales_type,
                    parse_decimal(payload.get("priceWithLogistics")),
                    parse_decimal(payload.get("priceWithoutLogistics")),
                    parse_decimal(payload.get("quantityTons")),
                    parse_decimal(payload.get("amountOriginal")),
                    (payload.get("currencyCode") or "KGS").upper(),
                    clean_str(payload.get("remark")),
                ),
            )
            result = recalculate_all_wholesale(cur)
            log_operation(
                cur,
                "manual_contract",
                "import_batches",
                batch_id,
                {"customerName": customer, "contractNo": contract_no, "salesType": sales_type},
            )
            conn.commit()
            return jsonify({"ok": True, "batchId": batch_id, "recalculation": result})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/densities")
    def api_densities():
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT p.product_code, p.display_name, d.density, d.effective_date, d.source, d.created_at
                FROM product_density_history d
                JOIN products p ON p.id = d.product_id
                ORDER BY p.product_code, d.effective_date DESC
                """
            )
            rows = [
                {
                    "productCode": row[0],
                    "productName": row[1],
                    "density": float(row[2]),
                    "effectiveDate": row[3].isoformat(),
                    "source": row[4],
                    "createdAt": row[5].isoformat() if row[5] else None,
                }
                for row in cur.fetchall()
            ]
            return jsonify({"items": rows})
        finally:
            conn.close()

    @app.route("/api/export/wholesale/details/<year_month>")
    @admin_required
    def api_export_wholesale_details(year_month):
        parts = year_month.split("-")
        year = int(parts[0])
        month = int(parts[1]) if len(parts) > 1 else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT d.business_date, d.raw_product_name, d.weigh_serial_no,
                       d.vehicle_no, d.sender_name, d.raw_entity_name,
                       d.weight_kg, d.remark
                FROM wholesale_detail_records d
                WHERE d.batch_id IS NULL AND d.business_date >= %s AND d.business_date < %s
                ORDER BY d.business_date, d.id
            """, (start, end))
            rows = cur.fetchall()
            import io
            from openpyxl import Workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "称重批发明细"
            headers = ["序号", "入厂日期", "油品名称", "磅单号", "车号",
                       "油品所属公司", "供应商/客户", "过磅重量", "备注"]
            ws.append(headers)
            for idx, r in enumerate(rows, 1):
                ws.append([
                    idx,
                    r[0].isoformat() if r[0] else "",
                    r[1] or "", r[2] or "", r[3] or "",
                    r[4] or "", r[5] or "",
                    _round_half_up(r[6], 3) if r[6] else 0,
                    r[7] or "",
                ])
                ws.cell(row=idx + 1, column=8).number_format = "#,##0.000"
            output = io.BytesIO()
            wb.save(output)
            output.seek(0)
            from flask import send_file
            return send_file(output, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", as_attachment=True, download_name=f"称重批发明细_{year_month}.xlsx")
        finally:
            conn.close()

    @app.route("/api/densities", methods=["POST"])
    @admin_required
    def api_create_density():
        payload = request.get_json(force=True)
        product_code = payload["productCode"]
        density = payload["density"]
        effective_date = payload["effectiveDate"]
        note = payload.get("note")
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM products WHERE product_code = %s", (product_code,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "unknown_product"}), 400
            cur.execute(
                """
                INSERT INTO product_density_history
                    (product_id, density, effective_date, source, created_by, note)
                VALUES (%s, %s, %s, 'manual', 'user', %s)
                ON DUPLICATE KEY UPDATE
                    density = VALUES(density),
                    source = VALUES(source),
                    created_by = VALUES(created_by),
                    note = VALUES(note)
                """,
                (row[0], density, effective_date, note),
            )
            log_operation(
                cur,
                "save_density",
                "product_density_history",
                f"{product_code}:{effective_date}",
                {"productCode": product_code, "density": str(density), "effectiveDate": effective_date},
            )
            conn.commit()
            return jsonify({"ok": True})
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


    @app.route("/api/wholesale/weigh-details")
    def api_wholesale_weigh_details():
        year = int(request.args.get("year", "2026"))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)

        vehicle = request.args.get("vehicle", "").strip()
        entity = request.args.get("entity", "").strip()
        product = request.args.get("product", "").strip()
        classification = request.args.get("classification", "").strip()
        matchStatus = request.args.get("matchStatus", "").strip()
        auditStatus = request.args.get("auditStatus", "").strip()
        col_product = request.args.get("col_product", "").strip()
        col_sender = request.args.get("col_sender", "").strip()
        col_receiver = request.args.get("col_receiver", "").strip()
        col_classification = request.args.get("col_classification", "").strip()

        where = ["d.batch_id IS NULL", "d.business_date >= %s", "d.business_date < %s"]
        params = [start, end]
        if vehicle:
            where.append("d.vehicle_no LIKE %s")
            params.append(f"%{vehicle}%")
        if entity:
            where.append("(d.raw_entity_name LIKE %s OR d.standard_entity_name LIKE %s OR d.sender_name LIKE %s)")
            params.extend([f"%{entity}%", f"%{entity}%", f"%{entity}%"])
        if product:
            where.append("(d.raw_product_name LIKE %s OR p.display_name LIKE %s)")
            params.extend([f"%{product}%", f"%{product}%"])
        if classification:
            where.append("d.classification = %s")
            params.append(classification)
        if matchStatus:
            where.append("d.match_status = %s")
            params.append(matchStatus)
        if auditStatus:
            where.append("d.audit_status = %s")
            params.append(auditStatus)
        if col_product:
            vals = [v.strip() for v in col_product.split(",") if v.strip()]
            if vals:
                placeholders = ",".join(["%s"] * len(vals))
                where.append(f"d.raw_product_name IN ({placeholders})")
                params.extend(vals)
        if col_sender:
            vals = [v.strip() for v in col_sender.split(",") if v.strip()]
            if vals:
                placeholders = ",".join(["%s"] * len(vals))
                where.append(f"d.sender_name IN ({placeholders})")
                params.extend(vals)
        if col_receiver:
            vals = [v.strip() for v in col_receiver.split(",") if v.strip()]
            if vals:
                placeholders = ",".join(["%s"] * len(vals))
                where.append(f"d.raw_entity_name IN ({placeholders})")
                params.extend(vals)
        if col_classification:
            vals = [v.strip() for v in col_classification.split(",") if v.strip()]
            if vals:
                placeholders = ",".join(["%s"] * len(vals))
                where.append(f"d.classification IN ({placeholders})")
                params.extend(vals)

        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute(f"""
                SELECT d.id, d.business_date, d.raw_product_name, p.display_name AS product_name,
                       d.vehicle_no, d.weigh_serial_no, d.raw_entity_name, d.sender_name,
                       d.standard_entity_name,
                       COALESCE(NULLIF(p.display_name, ''), d.raw_product_name) AS display_product_name,
                       COALESCE(NULLIF(d.standard_entity_name, ''), d.raw_entity_name) AS display_entity_name,
                       d.classification, d.weight_kg, d.weight_tons,
                       d.match_status, d.audit_status, d.weigh_source, d.remark, d.created_at
                FROM wholesale_detail_records d
                LEFT JOIN products p ON p.id = d.product_id
                WHERE {' AND '.join(where)}
                ORDER BY d.business_date DESC, d.id DESC
            """, params)
            items = [{
                "id": r[0], "businessDate": r[1].isoformat() if r[1] else None,
                "rawProductName": r[2], "productName": r[3], "displayProductName": r[9],
                "vehicleNo": r[4], "weighSerialNo": r[5] or "",
                "rawEntityName": r[6], "senderName": r[7] or "",
                "standardEntityName": r[8], "displayEntityName": r[10],
                "classification": r[11], "weightKg": float(r[12]) if r[12] else 0,
                "weightTons": float(r[13]) if r[13] else 0, "matchStatus": r[14],
                "auditStatus": r[15], "weighSource": r[16],
                "remark": r[17] or "", "createdAt": r[18].isoformat() if r[18] else None,
            } for r in cur.fetchall()]
            return jsonify({"items": items})
        finally:
            conn.close()


    @app.route("/api/wholesale/weigh-details/filter-options")
    def api_wholesale_weigh_details_filter_options():
        year = int(request.args.get("year", "2026"))
        month_raw = request.args.get("month")
        month = int(month_raw) if month_raw else None
        start, end = period_bounds(year, month)
        conn = get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT
                    COALESCE(GROUP_CONCAT(DISTINCT d.raw_product_name ORDER BY d.raw_product_name SEPARATOR '||'), ''),
                    COALESCE(GROUP_CONCAT(DISTINCT d.sender_name ORDER BY d.sender_name SEPARATOR '||'), ''),
                    COALESCE(GROUP_CONCAT(DISTINCT d.raw_entity_name ORDER BY d.raw_entity_name SEPARATOR '||'), ''),
                    COALESCE(GROUP_CONCAT(DISTINCT d.classification ORDER BY d.classification SEPARATOR '||'), '')
                FROM wholesale_detail_records d
                LEFT JOIN products p ON p.id = d.product_id
                WHERE d.batch_id IS NULL AND d.business_date >= %s AND d.business_date < %s
            """, [start, end])
            row = cur.fetchone()
            return jsonify({
                "product_name": [x for x in (row[0] or "").split("||") if x],
                "sender_name": [x for x in (row[1] or "").split("||") if x],
                "standard_entity_name": [x for x in (row[2] or "").split("||") if x],
                "classification": [x for x in (row[3] or "").split("||") if x],
            })
        finally:
            conn.close()


    if __name__ == "__main__":
        logging.getLogger("werkzeug").disabled = True
        host = os.getenv("SALES_HOST", "127.0.0.1")
        port = int(os.getenv("SALES_PORT", "8900"))
        try:
            from waitress import serve

            serve(app, host=host, port=port)
        except ImportError:
            app.run(host=host, port=port, debug=False, use_reloader=False)
