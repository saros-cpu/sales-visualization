from __future__ import annotations

from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import wraps
import html
import json
import logging
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
import pandas as pd
from flask import jsonify, request
from db import get_connection
from shared_utils import (
    ensure_market_watch_schema, OILSTATION_ROOT,
    active_station_statuses, retail_station_catalog_cached,
)
from text_utils import clean_str, normalize_station_name, parse_date, parse_decimal
from retail_internal import open_oilstation
from summary_service import available_periods, period_bounds, summarize_combined, summarize_wholesale
from wholesale_service import summarize_wholesale_page
from routes_data import chinese_market_item, market_source_display


def register_assistant_routes(app):
    """Register assistant routes."""

    def _assistant_question_score(value):
        text = str(value or "")
        score = len(re.findall(r"\d{1,2}", text))
        for word in ("年", "月", "周", "今天", "昨天", "零售", "批发", "销量", "销售", "金额", "统计"):
            if word in text:
                score += 3
        return score


    _ASSISTANT_DIGIT_TRANSLATION = str.maketrans("０１２３４５６７８９", "0123456789")

    def _assistant_prepare_question_text(value):
        text = str(value or "").strip().translate(_ASSISTANT_DIGIT_TRANSLATION)
        candidates = [text]
        for encoding in ("cp1252", "latin1", "gbk", "cp936"):
            try:
                candidate = text.encode(encoding, errors="ignore").decode("utf-8", errors="ignore")
            except (LookupError, UnicodeError):
                continue
            if candidate and candidate not in candidates:
                candidates.append(candidate.translate(_ASSISTANT_DIGIT_TRANSLATION))
        return max(candidates, key=_assistant_question_score)


    def _assistant_month_number(value):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            month = int(text)
            return month if 1 <= month <= 12 else None
        except ValueError:
            pass
        month_map = {
            "一": 1,
            "二": 2,
            "两": 2,
            "三": 3,
            "四": 4,
            "五": 5,
            "六": 6,
            "七": 7,
            "八": 8,
            "九": 9,
            "十": 10,
            "十一": 11,
            "十二": 12,
        }
        return month_map.get(text)


    _ASSISTANT_DATE_PATTERN = (
        r"(20\d{2})\s*(?:年|[-/.])\s*"
        r"(\d{1,2})\s*(?:月|[-/.])\s*"
        r"(\d{1,2})\s*(?:日|号)?"
    )
    _ASSISTANT_RANGE_PATTERN = r"(?:至|到|--?|—|~|～)"

    def _assistant_safe_date(year, month, day):
        try:
            return date(int(year), int(month), int(day))
        except (TypeError, ValueError):
            return None


    def _assistant_explicit_date_range(text):
        full_range = re.search(
            rf"{_ASSISTANT_DATE_PATTERN}\s*{_ASSISTANT_RANGE_PATTERN}\s*{_ASSISTANT_DATE_PATTERN}",
            text,
        )
        if full_range:
            start = _assistant_safe_date(*full_range.group(1, 2, 3))
            end_day = _assistant_safe_date(*full_range.group(4, 5, 6))
            if start and end_day and end_day >= start:
                label = f"{start.year}年{start.month}月{start.day}日至{end_day.year}年{end_day.month}月{end_day.day}日"
                return label, start, end_day + timedelta(days=1)

        same_year_range = re.search(
            rf"{_ASSISTANT_DATE_PATTERN}\s*{_ASSISTANT_RANGE_PATTERN}\s*"
            r"(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?",
            text,
        )
        if same_year_range:
            start = _assistant_safe_date(*same_year_range.group(1, 2, 3))
            end_day = _assistant_safe_date(same_year_range.group(1), same_year_range.group(4), same_year_range.group(5))
            if start and end_day and end_day >= start:
                label = f"{start.year}年{start.month}月{start.day}日至{end_day.month}月{end_day.day}日"
                return label, start, end_day + timedelta(days=1)

        return None


    def _assistant_period(question):
        today = date.today()
        text = _assistant_prepare_question_text(question)
        explicit_range = _assistant_explicit_date_range(text)
        if explicit_range:
            return explicit_range
        if "昨天" in text:
            start = today - timedelta(days=1)
            return "昨天", start, today
        if "今天" in text or "今日" in text:
            return "今天", today, today + timedelta(days=1)
        current_monday = today - timedelta(days=today.weekday())
        if "上周" in text or "上星期" in text:
            start = current_monday - timedelta(days=7)
            return "上周", start, current_monday
        if "本周" in text or "这周" in text:
            return "本周", current_monday, today + timedelta(days=1)
        if "上月" in text:
            first_this_month = today.replace(day=1)
            last_month_end = first_this_month
            if first_this_month.month == 1:
                start = date(first_this_month.year - 1, 12, 1)
            else:
                start = date(first_this_month.year, first_this_month.month - 1, 1)
            return "上月", start, last_month_end
        match = re.search(r"(20\d{2})\s*[年/-]\s*(\d{1,2})\s*月?", text)
        if match:
            year = int(match.group(1))
            month = int(match.group(2))
            if 1 <= month <= 12:
                start = date(year, month, 1)
                end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
                return f"{year}年{month}月", start, end
        relative_month = re.search(r"(?:当年|今年|本年|当前年|这个年)\s*(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十|十一|十二)\s*月", text)
        if not relative_month:
            relative_month = re.search(r"(?<!\d)(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十|十一|十二)\s*月(?:份)?(?=.*(?:零售|批发|销量|销售|金额|数据|统计))", text)
        if not relative_month:
            relative_month = re.search(r"(?<!\d)(\d{1,2}|一|二|两|三|四|五|六|七|八|九|十|十一|十二)\s*月(?:份)?(?!\s*\d)", text)
        if relative_month:
            month = _assistant_month_number(relative_month.group(1))
            if month:
                start = date(today.year, month, 1)
                end = date(today.year + 1, 1, 1) if month == 12 else date(today.year, month + 1, 1)
                return f"{today.year}年{month}月", start, end
        if "本月" in text or "这个月" in text:
            start = today.replace(day=1)
            return "本月", start, today + timedelta(days=1)
        year_match = re.search(r"(20\d{2})\s*年(?!\s*\d)", text)
        if year_match:
            year = int(year_match.group(1))
            return f"{year}年", date(year, 1, 1), date(year + 1, 1, 1)
        if "年销量" in text or "年度" in text or "全年" in text:
            return f"{today.year}年", date(today.year, 1, 1), today + timedelta(days=1)
        start = today - timedelta(days=7)
        return "最近7天", start, today + timedelta(days=1)


    def _assistant_period_display(label, start, end):
        try:
            end_day = end - timedelta(days=1)
            return f"{label}（{start.isoformat()} 至 {end_day.isoformat()}）"
        except Exception:
            return label


    def _retail_density_map():
        oilstation_path = str(OILSTATION_ROOT)
        sys.path.insert(0, oilstation_path)
        try:
            from export_excel import RESOURCE_DENSITY
            return {int(key): float(value) for key, value in RESOURCE_DENSITY.items()}
        except Exception:
            return {102: 0.76, 103: 0.74, 104: 0.75, 106: 0.85, 108: 0.54, 109: 0.85, 110: 0.85}
        finally:
            sys.path = [item for item in sys.path if item != oilstation_path]


    def _retail_snapshot_file(kind, key):
        prefix = {"daily": "day", "monthly": "monthly"}.get(kind, kind)
        if kind == "daily":
            year, month, day = key.split("-")
            return OILSTATION_ROOT / "cache_snapshots" / "daily" / year / month / f"{prefix}_{int(day):02d}.json"
        year, month = key.split("-")
        return OILSTATION_ROOT / "cache_snapshots" / "monthly" / year / f"{prefix}_{int(month):02d}.json"


    def _read_retail_snapshot(kind, key):
        path = _retail_snapshot_file(kind, key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None


    def _report_extras_snapshot_path(ym):
        year, month = ym.split("-")
        return OILSTATION_ROOT / "cache_snapshots" / "report_extras" / year / f"report_extras_{int(month):02d}.json"


    def _retail_report_index():
        path = OILSTATION_ROOT / "exports" / ".monthly_report_index.json"
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}


    def _retail_report_workbook_from_index(ym):
        item = _retail_report_index().get(ym) or {}
        filename = item.get("file")
        if not filename:
            return None
        path = OILSTATION_ROOT / "exports" / filename
        return path if path.exists() else None


    def _station_key_from_cell(value):
        try:
            station_key = int(float(value))
        except (TypeError, ValueError):
            return None
        return station_key if station_key in retail_station_catalog_cached() else None


    def _float_cell(value):
        if value is None or value == "":
            return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0


    def _retail_report_extras_from_workbook(ym):
        workbook_path = _retail_report_workbook_from_index(ym)
        if not workbook_path:
            return None
        try:
            from openpyxl import load_workbook
        except Exception:
            return None
        workbook = None
        try:
            workbook = load_workbook(workbook_path, read_only=True, data_only=True)
            sheet_name = "总表" if "总表" in workbook.sheetnames else workbook.sheetnames[0]
            sheet = workbook[sheet_name]
            result = {
                "totalEndInventory": 0.0,
                "totalEndInventoryTons": 0.0,
                "stations": {},
                "source": "daily_report_workbook",
                "sourceFile": workbook_path.name,
                "sourceMtime": workbook_path.stat().st_mtime,
            }
            current_shop_key = None
            for row in sheet.iter_rows(min_row=5, values_only=True):
                station_key = _station_key_from_cell(row[0] if len(row) > 0 else None)
                if station_key is not None:
                    current_shop_key = station_key
                if current_shop_key is None:
                    continue
                product_name = str(row[3] if len(row) > 3 and row[3] is not None else "").strip()
                if not product_name or "合计" in product_name or "итого" in product_name.lower():
                    continue
                end_inventory = _float_cell(row[23] if len(row) > 23 else None)
                end_inventory_tons = _float_cell(row[24] if len(row) > 24 else None)
                if not end_inventory and not end_inventory_tons:
                    continue
                item = result["stations"].setdefault(str(current_shop_key), {
                    "endInventory": 0.0,
                    "endInventoryTons": 0.0,
                })
                item["endInventory"] += end_inventory
                item["endInventoryTons"] += end_inventory_tons
                result["totalEndInventory"] += end_inventory
                result["totalEndInventoryTons"] += end_inventory_tons
            result["totalEndInventory"] = round(result["totalEndInventory"], 2)
            result["totalEndInventoryTons"] = round(result["totalEndInventoryTons"], 3)
            for item in result["stations"].values():
                item["endInventory"] = round(item["endInventory"], 2)
                item["endInventoryTons"] = round(item["endInventoryTons"], 3)
            return result
        except Exception:
            return None
        finally:
            if workbook is not None:
                workbook.close()


    def _retail_station_tons_from_report(ym):
        workbook_path = _retail_report_workbook_from_index(ym)
        if not workbook_path:
            return {}
        try:
            from openpyxl import load_workbook
        except Exception:
            return {}
        workbook = None
        station_tons = {}
        try:
            workbook = load_workbook(workbook_path, read_only=True, data_only=True)
            sheet_name = "总表" if "总表" in workbook.sheetnames else workbook.sheetnames[0]
            sheet = workbook[sheet_name]
            current_shop_key = None
            for row in sheet.iter_rows(min_row=5, values_only=True):
                station_key = _station_key_from_cell(row[0] if len(row) > 0 else None)
                if station_key is not None:
                    current_shop_key = station_key
                if current_shop_key is None:
                    continue
                product_name = str(row[3] if len(row) > 3 and row[3] is not None else "").strip()
                if not product_name or "合计" in product_name or "итого" in product_name.lower():
                    continue
                station_tons[current_shop_key] = station_tons.get(current_shop_key, 0.0) + _float_cell(row[20] if len(row) > 20 else None)
        except Exception:
            return {}
        finally:
            if workbook is not None:
                workbook.close()
        return {key: round(value, 3) for key, value in station_tons.items()}


    def _read_retail_report_extras(ym):
        path = _report_extras_snapshot_path(ym)
        data = None
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8-sig"))
                data = loaded if isinstance(loaded, dict) else None
            except (OSError, json.JSONDecodeError):
                data = None
        workbook_path = _retail_report_workbook_from_index(ym)
        if data and workbook_path and data.get("source") == "daily_report_workbook":
            stale = data.get("sourceFile") != workbook_path.name
            source_mtime = data.get("sourceMtime")
            try:
                stale = stale or (source_mtime is not None and workbook_path.stat().st_mtime > float(source_mtime) + 0.5)
            except (OSError, TypeError, ValueError):
                stale = True
            if stale:
                data = None
        if data is None:
            data = _retail_report_extras_from_workbook(ym)
        return data


    def _month_after(year, month):
        return (year + 1, 1) if month == 12 else (year, month + 1)


    def _full_month_ym(start, end):
        if start.day != 1:
            return None
        next_year, next_month = _month_after(start.year, start.month)
        if end == date(next_year, next_month, 1):
            return f"{start.year}-{start.month:02d}"
        return None


    def _retail_inventory_for_period(start, end):
        months = []
        cursor = start
        while cursor < end:
            ym = _full_month_ym(cursor, min(end, date(*_month_after(cursor.year, cursor.month), 1)))
            if not ym:
                break
            months.append(ym)
            next_year, next_month = _month_after(cursor.year, cursor.month)
            cursor = date(next_year, next_month, 1)
        if not months:
            ym = _full_month_ym(start, end)
            months = [ym] if ym else []
        result = {
            "totalEndInventory": 0.0,
            "totalEndInventoryTons": 0.0,
            "stations": {},
            "sourceFile": "",
            "month": months[-1] if months else "",
        }
        for ym in months:
            extras = _read_retail_report_extras(ym)
            if not extras:
                continue
            result["totalEndInventory"] = float(extras.get("totalEndInventory") or 0)
            result["totalEndInventoryTons"] = float(extras.get("totalEndInventoryTons") or 0)
            result["stations"] = extras.get("stations") or {}
            result["sourceFile"] = extras.get("sourceFile") or ""
            result["month"] = ym
        if not result["month"]:
            return None
        return result


    def _normalize_retail_snapshot_payload(payload, ym=None):
        if not payload:
            return None
        density = _retail_density_map()
        if ym is None:
            ym = payload.get("month")
        station_tons_from_report = _retail_station_tons_from_report(ym) if ym else {}
        summary = payload.get("summary") or {}
        resources = []
        for item in payload.get("byResource") or []:
            resource_key = int(item.get("resourceKey") or item.get("key") or 0)
            volume = float(item.get("volume") or 0)
            amount = float(item.get("amount") or 0)
            resources.append({
                "resourceKey": resource_key,
                "key": resource_key,
                "name": item.get("name") or "--",
                "volume": round(volume, 2),
                "tons": round(volume * density.get(resource_key, 0) / 1000, 3),
                "amount": round(amount, 2),
            })
        resource_total_liters = round(sum(float(item.get("volume") or 0) for item in resources), 2)
        resource_total_tons = round(sum(float(item.get("tons") or 0) for item in resources), 3)
        resource_total_sales = round(sum(float(item.get("amount") or 0) for item in resources), 2)
        stations = []
        for item in payload.get("stations") or []:
            shop_key = item.get("shopKey")
            try:
                shop_key_int = int(shop_key)
            except (TypeError, ValueError):
                shop_key_int = None
            tons_value = item.get("tons")
            if (tons_value is None or not float(tons_value or 0)) and shop_key_int in station_tons_from_report:
                tons_value = station_tons_from_report[shop_key_int]
            stations.append({
                "shopKey": shop_key,
                "name": item.get("name") or "--",
                "short": item.get("short") or "",
                "region": item.get("region") or "--",
                "volume": round(float(item.get("volume") or 0), 2),
                "tons": round(float(tons_value or 0), 3) if tons_value is not None else None,
                "amount": round(float(item.get("amount") or 0), 2),
            })
        region_tons_from_stations = {}
        for item in stations:
            if item.get("tons") is not None:
                region = item.get("region") or "--"
                region_tons_from_stations[region] = region_tons_from_stations.get(region, 0.0) + float(item.get("tons") or 0)
        raw_regions = payload.get("regions") or []
        if isinstance(raw_regions, dict):
            region_iter = ({**value, "region": key} for key, value in raw_regions.items())
        else:
            region_iter = raw_regions
        regions = [
            {
                "region": item.get("region") or item.get("name") or "--",
                "volume": round(float(item.get("volume") or 0), 2),
                "tons": round(float(item.get("tons") or region_tons_from_stations.get(item.get("region") or item.get("name") or "--") or 0), 3),
                "amount": round(float(item.get("amount") or 0), 2),
            }
            for item in region_iter
        ]
        stations.sort(key=lambda item: item["amount"], reverse=True)
        regions.sort(key=lambda item: item["amount"], reverse=True)
        return {
            "source": payload.get("source") or "OilStationSnapshot",
            "summary": {
                "totalTxn": int(summary.get("totalTxn") or 0),
                "totalLiters": round(float(summary.get("totalLiters") or resource_total_liters or 0), 2),
                "totalTons": round(float(summary.get("totalTons") or resource_total_tons or 0), 3),
                "totalSales": round(float(summary.get("totalSales") or resource_total_sales or 0), 2),
                "totalSalesCny": round(float(summary.get("totalSalesCny") or 0), 2),
            },
            "byResource": resources,
            "stations": stations,
            "regions": regions,
        }


    def _merge_retail_snapshot_payloads(payloads):
        merged = {"summary": {"totalTxn": 0, "totalLiters": 0, "totalTons": 0, "totalSales": 0, "totalSalesCny": 0}, "byResource": [], "stations": [], "regions": []}
        resource_map = {}
        station_map = {}
        region_map = {}
        for payload in payloads:
            normalized = _normalize_retail_snapshot_payload(payload, (payload or {}).get("month"))
            if not normalized:
                continue
            summary = normalized["summary"]
            for key in ("totalTxn", "totalLiters", "totalTons", "totalSales", "totalSalesCny"):
                merged["summary"][key] += float(summary.get(key) or 0)
            for item in normalized.get("byResource") or []:
                bucket = resource_map.setdefault(item.get("resourceKey"), {**item, "volume": 0, "tons": 0, "amount": 0})
                bucket["volume"] += float(item.get("volume") or 0)
                bucket["tons"] += float(item.get("tons") or 0)
                bucket["amount"] += float(item.get("amount") or 0)
            for item in normalized.get("stations") or []:
                key = item.get("shopKey") or item.get("name")
                bucket = station_map.setdefault(key, {**item, "volume": 0, "tons": 0, "amount": 0})
                bucket["volume"] += float(item.get("volume") or 0)
                bucket["tons"] += float(item.get("tons") or 0)
                bucket["amount"] += float(item.get("amount") or 0)
            for item in normalized.get("regions") or []:
                key = item.get("region")
                bucket = region_map.setdefault(key, {**item, "volume": 0, "tons": 0, "amount": 0})
                bucket["volume"] += float(item.get("volume") or 0)
                bucket["tons"] += float(item.get("tons") or 0)
                bucket["amount"] += float(item.get("amount") or 0)
        merged["byResource"] = sorted(
            ({**item, "volume": round(item["volume"], 2), "tons": round(item["tons"], 3), "amount": round(item["amount"], 2)} for item in resource_map.values()),
            key=lambda item: item["volume"],
            reverse=True,
        )
        merged["summary"] = {key: round(value, 3 if key == "totalTons" else 2) for key, value in merged["summary"].items()}
        if merged["byResource"]:
            resource_tons = round(sum(float(item.get("tons") or 0) for item in merged["byResource"]), 3)
            summary_tons = float(merged["summary"].get("totalTons") or 0)
            if resource_tons and (not summary_tons or abs(summary_tons - resource_tons) > max(1.0, resource_tons * 0.05)):
                merged["summary"]["totalTons"] = resource_tons
        merged["stations"] = sorted(
            ({**item, "volume": round(item["volume"], 2), "tons": round(item["tons"], 3), "amount": round(item["amount"], 2)} for item in station_map.values()),
            key=lambda item: item["amount"],
            reverse=True,
        )
        merged["regions"] = sorted(
            ({**item, "volume": round(item["volume"], 2), "tons": round(item["tons"], 3), "amount": round(item["amount"], 2)} for item in region_map.values()),
            key=lambda item: item["amount"],
            reverse=True,
        )
        return merged


    def _empty_retail_snapshot_payload(start, end, source="OilStationSnapshot"):
        return {
            "source": source,
            "summary": {
                "totalTxn": 0,
                "totalLiters": 0.0,
                "totalTons": 0.0,
                "totalSales": 0.0,
                "totalSalesCny": 0.0,
                "queryStart": start.isoformat() if hasattr(start, "isoformat") else "",
                "queryEnd": end.isoformat() if hasattr(end, "isoformat") else "",
            },
            "byResource": [],
            "stations": [],
            "regions": [],
        }


    def _retail_snapshot_for_period(start, end):
        today = date.today()
        if end <= start:
            return _empty_retail_snapshot_payload(start, end)

        if start.day == 1 and start.year == today.year and start.month == today.month and end >= today:
            ym = f"{start.year}-{start.month:02d}"
            current_month = _normalize_retail_snapshot_payload(_read_retail_snapshot("monthly", ym), ym)
            if current_month:
                return current_month
        if start.day == 1 and end == (date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)):
            ym = f"{start.year}-{start.month:02d}"
            return _normalize_retail_snapshot_payload(_read_retail_snapshot("monthly", ym), ym)
        if start.month == 1 and start.day == 1 and end == date(start.year + 1, 1, 1):
            payloads = [
                _read_retail_snapshot("monthly", f"{start.year}-{month:02d}")
                for month in range(1, 13)
            ]
            payloads = [item for item in payloads if item]
            return _merge_retail_snapshot_payloads(payloads) if payloads else None

        if start.day == 1:
            payloads = []
            cursor = start
            while cursor < end:
                next_year, next_month = _month_after(cursor.year, cursor.month)
                next_month_start = date(next_year, next_month, 1)
                if next_month_start > end:
                    payloads = []
                    break
                ym = f"{cursor.year}-{cursor.month:02d}"
                payload = _read_retail_snapshot("monthly", ym)
                if not payload:
                    payloads = []
                    break
                payloads.append(payload)
                cursor = next_month_start
            if payloads and cursor == end:
                return _merge_retail_snapshot_payloads(payloads)

        # Daily snapshots are generated only after a business day is complete.
        # If the requested range includes today, use completed days only and avoid
        # falling back to the live retail DB for incomplete shifts.
        effective_end = min(end, today)
        if effective_end <= start:
            return _empty_retail_snapshot_payload(start, effective_end)

        dates = []
        current = start
        while current < effective_end:
            payload = _read_retail_snapshot("daily", current.isoformat())
            if not payload:
                return None
            dates.append(payload)
            current += timedelta(days=1)
        return _merge_retail_snapshot_payloads(dates)


    def _combined_data_from_snapshots(cur, year, month, start, end):
        retail_snapshot = _retail_snapshot_for_period(start, end)
        if not retail_snapshot:
            return summarize_combined(cur, year, month)
        wholesale = summarize_wholesale(cur, year, month)
        retail_summary = retail_snapshot.get("summary") or {}
        retail = {
            "liters": round(float(retail_summary.get("totalLiters") or 0), 2),
            "tons": round(float(retail_summary.get("totalTons") or 0), 3),
            "amountKgs": round(float(retail_summary.get("totalSales") or 0), 2),
            "amountCny": round(float(retail_summary.get("totalSalesCny") or 0), 2),
            "source": "snapshot",
        }
        combined = {
            "salesTons": round(retail["tons"] + wholesale["salesTons"], 3),
            "salesAmountCny": round(retail["amountCny"] + wholesale["salesAmountCny"], 2),
            "transferTons": wholesale["transferTons"],
        }
        return {"retail": retail, "wholesale": wholesale, "combined": combined}


    def _format_assistant_retail_answer(label, payload):
        summary = payload.get("summary") or {}
        question = payload.get("question") or ""
        rows = [
            item for item in payload.get("byResource") or []
            if float(item.get("volume") or 0) or float(item.get("amount") or 0)
        ]
        lines = [
            f"{label}零售销量统计如下：",
            f"合计销量 {float(summary.get('totalLiters') or 0):,.2f} 升，折算 {float(summary.get('totalTons') or 0):,.3f} 吨，合计金额 {float(summary.get('totalSales') or 0):,.2f} 索姆。",
        ]
        if rows:
            lines.append("各油品明细：")
            for item in rows:
                lines.append(
                    f"{item.get('name') or '--'}：{float(item.get('volume') or 0):,.2f} 升，"
                    f"{float(item.get('tons') or 0):,.3f} 吨，"
                    f"{float(item.get('amount') or 0):,.2f} 索姆"
                )
        else:
            lines.append("该区间暂未查询到已结束班组的销售数据。")
        if any(word in question for word in ("站点", "加油站", "排行", "排名", "最好")) and payload.get("stations"):
            lines.append("站点排行：")
            for item in payload.get("stations", [])[:10]:
                lines.append(
                    f"{item.get('name') or '--'}：{float(item.get('volume') or 0):,.2f} 升，"
                    f"{float(item.get('tons') or 0):,.3f} 吨，{float(item.get('amount') or 0):,.2f} 索姆"
                )
        if any(word in question for word in ("区域", "州", "地区")) and payload.get("regions"):
            lines.append("区域排行：")
            for item in payload.get("regions", [])[:8]:
                lines.append(
                    f"{item.get('region') or '--'}：{float(item.get('volume') or 0):,.2f} 升，"
                    f"{float(item.get('tons') or 0):,.3f} 吨，{float(item.get('amount') or 0):,.2f} 索姆"
                )
        return "\n".join(lines)


    def _assistant_has_any(question, words):
        return any(word in question for word in words)


    def _append_rank_lines(lines, title, rows, limit=5, amount_label="元"):
        clean_rows = [item for item in rows or [] if float(item.get("tons") or item.get("volume") or 0)]
        if not clean_rows:
            return
        lines.append(title)
        for item in clean_rows[:limit]:
            name = item.get("name") or item.get("region") or item.get("product") or "--"
            if "volume" in item:
                lines.append(f"{name}：{float(item.get('volume') or 0):,.2f} 升，{float(item.get('amount') or 0):,.2f} 索姆")
            elif "amountCny" in item:
                lines.append(f"{name}：{float(item.get('tons') or 0):,.3f} 吨，{float(item.get('amountCny') or 0):,.2f} {amount_label}")
            else:
                lines.append(f"{name}：{float(item.get('tons') or 0):,.3f} 吨")


    def _assistant_table(title, columns, rows):
        return {
            "title": title,
            "columns": columns,
            "rows": [
                ["" if value is None else str(value) for value in row]
                for row in rows
            ],
        }


    def _fmt_amount(value, unit=""):
        suffix = f" {unit}" if unit else ""
        return f"{float(value or 0):,.2f}{suffix}"


    def _fmt_volume(value):
        return f"{float(value or 0):,.2f} 升"


    def _fmt_tons(value):
        return f"{float(value or 0):,.3f} 吨"


    def _assistant_retail_tables(label, payload, question):
        tables = []
        summary = payload.get("summary") or {}
        resources = [item for item in payload.get("byResource") or [] if float(item.get("volume") or 0) or float(item.get("amount") or 0)]
        if resources:
            resource_rows = [
                [item.get("name") or "--", _fmt_volume(item.get("volume")), _fmt_tons(item.get("tons")), _fmt_amount(item.get("amount"), "索姆")]
                for item in resources
            ]
            resource_rows.append([
                "合计",
                _fmt_volume(summary.get("totalLiters")),
                _fmt_tons(summary.get("totalTons")),
                _fmt_amount(summary.get("totalSales"), "索姆"),
            ])
            tables.append(_assistant_table(
                f"{label}零售油品明细",
                ["油品", "销量", "吨位", "销售金额"],
                resource_rows,
            ))
        if _assistant_has_any(question, ("站点", "加油站", "排行", "排名", "最好")) and payload.get("stations"):
            tables.append(_assistant_table(
                f"{label}站点排行",
                ["站点", "区域", "销量", "吨位", "销售金额"],
                [
                    [item.get("name") or "--", item.get("region") or "--", _fmt_volume(item.get("volume")), _fmt_tons(item.get("tons")), _fmt_amount(item.get("amount"), "索姆")]
                    for item in payload.get("stations", [])[:12]
                ],
            ))
        if _assistant_has_any(question, ("区域", "州", "地区")) and payload.get("regions"):
            tables.append(_assistant_table(
                f"{label}区域排行",
                ["区域", "销量", "吨位", "销售金额"],
                [
                    [item.get("region") or "--", _fmt_volume(item.get("volume")), _fmt_tons(item.get("tons")), _fmt_amount(item.get("amount"), "索姆")]
                    for item in payload.get("regions", [])[:10]
                ],
            ))
        return tables


    def _assistant_retail_inventory_answer(label, data):
        return (
            f"{label}零售期末库存如下：\n"
            f"合计库存 {float(data.get('totalEndInventory') or 0):,.2f} 升，"
            f"折算 {float(data.get('totalEndInventoryTons') or 0):,.3f} 吨。\n"
            f"数据来源：{data.get('sourceFile') or '日销表'}。"
        )


    def _assistant_retail_inventory_tables(label, data):
        catalog = retail_station_catalog_cached()
        station_rows = []
        for raw_shop_key, item in (data.get("stations") or {}).items():
            try:
                shop_key = int(raw_shop_key)
            except (TypeError, ValueError):
                continue
            info = catalog.get(shop_key, {})
            inventory = float(item.get("endInventory") or 0)
            tons = float(item.get("endInventoryTons") or 0)
            if not inventory and not tons:
                continue
            station_rows.append([
                info.get("name") or f"Station-{shop_key}",
                info.get("region") or "--",
                _fmt_volume(inventory),
                _fmt_tons(tons),
            ])
        station_rows.sort(key=lambda row: float(str(row[2]).replace(",", "").split()[0] or 0), reverse=True)
        station_rows.append([
            "合计",
            "全部区域",
            _fmt_volume(data.get("totalEndInventory")),
            _fmt_tons(data.get("totalEndInventoryTons")),
        ])
        return [_assistant_table(
            f"{label}零售期末库存",
            ["加油站", "区域", "期末库存", "折算吨位"],
            station_rows,
        )]


    def _assistant_wholesale_tables(label, data, question):
        cards = data.get("cards") or {}
        labels = {"export_wholesale": "出口批发", "local_wholesale": "本地批发", "unknown": "待识别", "transfer": "外运", "processing": "代加工", "procurement": "采购"}
        sales_keys = ("export_wholesale", "local_wholesale", "unknown")
        sales_total_tons = sum(float((cards.get(key) or {}).get("tons") or 0) for key in sales_keys)
        sales_total_amount = sum(float((cards.get(key) or {}).get("amountCny") or 0) for key in ("export_wholesale", "local_wholesale"))
        sales_total_review = sum(int((cards.get(key) or {}).get("reviewRows") or 0) for key in sales_keys)
        category_rows = [
            [
                labels.get(key, key),
                _fmt_tons((cards.get(key) or {}).get("tons")),
                "--" if key in ("unknown", "transfer") else _fmt_amount((cards.get(key) or {}).get("amountCny"), "元"),
                (cards.get(key) or {}).get("entities") or 0,
                (cards.get(key) or {}).get("reviewRows") or 0,
            ]
            for key in ("export_wholesale", "local_wholesale", "unknown", "transfer")
        ]
        category_rows.append(["销售合计", _fmt_tons(sales_total_tons), _fmt_amount(sales_total_amount, "元"), "--", sales_total_review])
        tables = [_assistant_table(
            f"{label}批发分类统计",
            ["分类", "吨数", "金额", "客户/去向数", "待复核"],
            category_rows,
        )]
        rankings = data.get("customerRankings") or {}
        if _assistant_has_any(question, ("客户", "排行", "排名", "top", "TOP")):
            for key in ("export_wholesale", "local_wholesale", "unknown"):
                rows = rankings.get(key) or []
                if rows:
                    tables.append(_assistant_table(
                        f"{labels[key]}客户排行",
                        ["客户", "吨数", "金额", "记录数"],
                        [[item.get("name") or "--", _fmt_tons(item.get("tons")), _fmt_amount(item.get("amountCny"), "元"), item.get("rows") or 0] for item in rows[:10]],
                    ))
        if _assistant_has_any(question, ("油品", "产品", "结构", "品类")):
            products = data.get("productRankings") or {}
            for key in ("export_wholesale", "local_wholesale", "unknown", "transfer"):
                rows = products.get(key) or []
                if rows:
                    tables.append(_assistant_table(
                        f"{labels[key]}油品排行",
                        ["油品", "吨数", "金额"],
                        [[item.get("name") or "--", _fmt_tons(item.get("tons")), "--" if key in ("unknown", "transfer") else _fmt_amount(item.get("amountCny"), "元")] for item in rows[:10]],
                    ))
        if "外运" in question:
            transfer_summary = data.get("transferSummary") or {}
            if transfer_summary.get("byRegion"):
                tables.append(_assistant_table(
                    f"{label}外运区域汇总",
                    ["区域", "吨数", "记录数"],
                    [[item.get("region") or "--", _fmt_tons(item.get("tons")), item.get("rows") or 0] for item in transfer_summary.get("byRegion", [])[:10]],
                ))
        return tables


    def _assistant_combined_tables(label, data):
        retail = data.get("retail") or {}
        wholesale = data.get("wholesale") or {}
        combined = data.get("combined") or {}
        return [_assistant_table(
            f"{label}合并统计",
            ["板块", "销量/销售吨数", "销售金额"],
            [
                ["合计", _fmt_tons(combined.get("salesTons")), _fmt_amount(combined.get("salesAmountCny"), "元")],
                ["零售", _fmt_tons(retail.get("tons")), _fmt_amount(retail.get("amountCny"), "元")],
                ["批发销售", _fmt_tons(wholesale.get("salesTons")), _fmt_amount(wholesale.get("salesAmountCny"), "元")],
                ["外运", _fmt_tons(combined.get("transferTons")), "--"],
            ],
        )]


    def _assistant_review_tables(label, data):
        review = data.get("review") or {}
        status = review.get("status") or {}
        tables = []
        if status:
            tables.append(_assistant_table(
                f"{label}匹配状态",
                ["状态", "记录数", "吨数"],
                [[key or "--", value.get("rows") or 0, _fmt_tons(value.get("tons"))] for key, value in status.items()],
            ))
        if review.get("topNeedsReview"):
            tables.append(_assistant_table(
                f"{label}待复核数据",
                ["客户/去向", "油品", "记录数", "吨数"],
                [[item.get("entity") or "--", item.get("product") or "--", item.get("rows") or 0, _fmt_tons(item.get("tons"))] for item in review["topNeedsReview"][:10]],
            ))
        issues = data.get("issues") or []
        if issues:
            tables.append(_assistant_table(
                f"{label}数据审核",
                ["类型", "级别", "日期", "提示"],
                [[item.get("type") or "--", item.get("severity") or "--", item.get("date") or "--", item.get("message") or ""] for item in issues[:12]],
            ))
        return tables


    def _assistant_year_month_from_period(start, end):
        if start.month == 1 and start.day == 1 and end == date(start.year + 1, 1, 1):
            return start.year, None
        if start.day == 1:
            next_month = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
            if end == next_month:
                return start.year, start.month
        return start.year, start.month if start.year == end.year and start.month == end.month else None


    def _format_assistant_wholesale_answer(label, data, question):
        cards = data.get("cards") or {}
        export_card = cards.get("export_wholesale") or {}
        local_card = cards.get("local_wholesale") or {}
        pending_card = cards.get("unknown") or {}
        transfer_card = cards.get("transfer") or {}
        lines = [f"{label}批发数据如下："]
        if "出口" in question:
            lines.append(f"出口批发：{float(export_card.get('tons') or 0):,.3f} 吨，金额 {float(export_card.get('amountCny') or 0):,.2f} 元，客户数 {export_card.get('entities') or 0}。")
        elif "本地" in question:
            lines.append(f"本地批发：{float(local_card.get('tons') or 0):,.3f} 吨，金额 {float(local_card.get('amountCny') or 0):,.2f} 元，客户数 {local_card.get('entities') or 0}。")
        elif "外运" in question:
            lines.append(f"外运：{float(transfer_card.get('tons') or 0):,.3f} 吨，去向数 {transfer_card.get('entities') or 0}；外运仅统计吨数，不计算金额。")
        else:
            total_tons = float(export_card.get("tons") or 0) + float(local_card.get("tons") or 0) + float(pending_card.get("tons") or 0)
            total_amount = float(export_card.get("amountCny") or 0) + float(local_card.get("amountCny") or 0)
            lines.append(f"批发销售合计：{total_tons:,.3f} 吨，金额 {total_amount:,.2f} 元。")
            lines.append(f"出口批发：{float(export_card.get('tons') or 0):,.3f} 吨，{float(export_card.get('amountCny') or 0):,.2f} 元。")
            lines.append(f"本地批发：{float(local_card.get('tons') or 0):,.3f} 吨，{float(local_card.get('amountCny') or 0):,.2f} 元。")
            lines.append(f"待识别：{float(pending_card.get('tons') or 0):,.3f} 吨，数量已统计，金额待合同复核。")
            lines.append(f"外运：{float(transfer_card.get('tons') or 0):,.3f} 吨。")
        rankings = data.get("customerRankings") or {}
        key = "export_wholesale" if "出口" in question else ("local_wholesale" if "本地" in question else None)
        if key and rankings.get(key):
            _append_rank_lines(lines, "客户排行：", rankings[key], limit=8)
        elif _assistant_has_any(question, ("客户", "排行", "排名", "top", "TOP")):
            _append_rank_lines(lines, "出口批发客户排行：", rankings.get("export_wholesale"), limit=5)
            _append_rank_lines(lines, "本地批发客户排行：", rankings.get("local_wholesale"), limit=5)
        if _assistant_has_any(question, ("油品", "产品", "结构", "品类")):
            products = data.get("productRankings") or {}
            if "出口" in question:
                _append_rank_lines(lines, "出口批发油品排行：", products.get("export_wholesale"), limit=8)
            elif "本地" in question:
                _append_rank_lines(lines, "本地批发油品排行：", products.get("local_wholesale"), limit=8)
            elif "外运" in question:
                _append_rank_lines(lines, "外运油品排行：", products.get("transfer"), limit=8)
            else:
                _append_rank_lines(lines, "出口批发油品排行：", products.get("export_wholesale"), limit=5)
                _append_rank_lines(lines, "本地批发油品排行：", products.get("local_wholesale"), limit=5)
                _append_rank_lines(lines, "待识别油品排行：", products.get("unknown"), limit=5)
                _append_rank_lines(lines, "外运油品排行：", products.get("transfer"), limit=5)
        if "外运" in question and _assistant_has_any(question, ("区域", "去向", "详情", "油库", "加油站")):
            transfer_summary = data.get("transferSummary") or {}
            _append_rank_lines(lines, "外运区域汇总：", transfer_summary.get("byRegion"), limit=8)
            _append_rank_lines(lines, "外运去向排行：", data.get("transferTargets"), limit=8)
        return "\n".join(lines)


    def _assistant_exchange_answer(cur, label, start, end):
        cur.execute(
            """
            SELECT rate_date, usd_kgs, cny_kgs, source, is_manual
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
            ORDER BY rate_date DESC
            LIMIT 31
            """,
            (start, end),
        )
        rows = cur.fetchall()
        if not rows:
            return f"{label}没有查询到汇率快照。"
        latest = rows[0]
        usd_vals = [float(row[1]) for row in rows if row[1] is not None]
        cny_vals = [float(row[2]) for row in rows if row[2] is not None]
        return "\n".join([
            f"{label}汇率数据如下：",
            f"最新日期 {latest[0]}：USD/KGS {float(latest[1] or 0):.4f}，CNY/KGS {float(latest[2] or 0):.4f}，来源 {'手工录入' if latest[4] else (latest[3] or 'NBKR')}。",
            f"区间平均：USD/KGS {(sum(usd_vals)/len(usd_vals)):.4f}，CNY/KGS {(sum(cny_vals)/len(cny_vals)):.4f}。",
        ])


    def _assistant_exchange_tables(cur, label, start, end):
        cur.execute(
            """
            SELECT rate_date, usd_kgs, cny_kgs, source, is_manual
            FROM exchange_rates
            WHERE rate_date >= %s AND rate_date < %s
            ORDER BY rate_date DESC
            LIMIT 31
            """,
            (start, end),
        )
        rows = cur.fetchall()
        if not rows:
            return []
        usd_vals = [float(row[1]) for row in rows if row[1] is not None]
        cny_vals = [float(row[2]) for row in rows if row[2] is not None]
        table_rows = [
            [
                row[0],
                f"{float(row[1] or 0):.4f}",
                f"{float(row[2] or 0):.4f}",
                f"{(1 / float(row[2])):.4f}" if row[2] else "--",
                "手工录入" if row[4] else (row[3] or "NBKR"),
            ]
            for row in rows
        ]
        if usd_vals or cny_vals:
            cny_avg = (sum(cny_vals) / len(cny_vals)) if cny_vals else 0
            table_rows.append([
                "区间平均",
                f"{(sum(usd_vals) / len(usd_vals)):.4f}" if usd_vals else "--",
                f"{cny_avg:.4f}" if cny_vals else "--",
                f"{(1 / cny_avg):.4f}" if cny_avg else "--",
                "--",
            ])
        return [_assistant_table(
            f"{label}汇率快照",
            ["日期", "美元/索姆", "人民币/索姆", "索姆/人民币", "来源"],
            table_rows,
        )]


    def _assistant_density_answer(cur):
        cur.execute(
            """
            SELECT p.display_name, d.density, d.effective_date, d.source
            FROM product_density_history d
            JOIN products p ON p.id = d.product_id
            JOIN (
                SELECT product_id, MAX(effective_date) effective_date
                FROM product_density_history
                GROUP BY product_id
            ) latest ON latest.product_id = d.product_id AND latest.effective_date = d.effective_date
            ORDER BY p.product_code
            """
        )
        rows = cur.fetchall()
        if not rows:
            return "暂未查询到密度维护记录。"
        lines = ["当前最新密度如下："]
        for name, density, effective_date, source in rows:
            lines.append(f"{name}：{float(density):.6f}，生效日期 {effective_date}，来源 {source or '--'}")
        return "\n".join(lines)


    def _assistant_density_tables(cur):
        cur.execute(
            """
            SELECT p.display_name, d.density, d.effective_date, d.source
            FROM product_density_history d
            JOIN products p ON p.id = d.product_id
            JOIN (
                SELECT product_id, MAX(effective_date) effective_date
                FROM product_density_history
                GROUP BY product_id
            ) latest ON latest.product_id = d.product_id AND latest.effective_date = d.effective_date
            ORDER BY p.product_code
            """
        )
        rows = cur.fetchall()
        if not rows:
            return []
        return [_assistant_table(
            "当前密度",
            ["油品", "密度", "生效日期", "来源"],
            [[name, f"{float(density):.6f}", effective_date, source or "--"] for name, density, effective_date, source in rows],
        )]


    def _assistant_contract_answer(cur, question):
        where = []
        if "出口" in question:
            where.append("c.sales_type = 'export_wholesale'")
        if "本地" in question:
            where.append("c.sales_type = 'local_wholesale'")
        sql_where = "WHERE " + " AND ".join(where) if where else ""
        cur.execute(
            f"""
            SELECT COUNT(*),
                   SUM(CASE
                       WHEN (c.effective_start IS NULL OR c.effective_start <= CURDATE())
                        AND (c.effective_end IS NULL OR c.effective_end >= CURDATE())
                       THEN 1 ELSE 0 END),
                   MIN(c.effective_start),
                   MAX(c.effective_end)
            FROM contracts c
            {sql_where}
            """
        )
        count, active_count, min_from, max_to = cur.fetchone()
        cur.execute(
            f"""
            SELECT
                c.contract_no,
                COALESCE(cu.standard_name, c.raw_customer_name),
                COALESCE(p.display_name, c.raw_product_name),
                COALESCE(c.price_with_logistics, c.price_without_logistics, 0),
                c.currency_code,
                c.effective_start,
                c.effective_end,
                c.sales_type
            FROM contracts c
            LEFT JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN products p ON p.id = c.product_id
            {sql_where}
            ORDER BY COALESCE(c.effective_end, c.effective_start, c.signed_date) DESC, c.id DESC
            LIMIT 8
            """
        )
        rows = cur.fetchall()
        lines = [f"合同信息：共 {int(count or 0)} 条，其中有效合同 {int(active_count or 0)} 条；日期范围 {min_from or '--'} 至 {max_to or '--'}。"]
        if rows:
            lines.append("近期合同：")
            for no, customer, product, price, currency, valid_from, valid_to, sales_type in rows:
                label = "出口批发" if sales_type == "export_wholesale" else ("本地批发" if sales_type == "local_wholesale" else "其他")
                lines.append(f"{no or '--'}｜{customer or '--'}｜{product or '--'}｜{float(price or 0):,.2f} {currency}｜{valid_from or '--'} 至 {valid_to or '--'}｜{label}")
        return "\n".join(lines)


    def _assistant_contract_tables(cur, question):
        where = []
        if "出口" in question:
            where.append("c.sales_type = 'export_wholesale'")
        if "本地" in question:
            where.append("c.sales_type = 'local_wholesale'")
        sql_where = "WHERE " + " AND ".join(where) if where else ""
        cur.execute(
            f"""
            SELECT
                c.contract_no,
                COALESCE(cu.standard_name, c.raw_customer_name),
                COALESCE(p.display_name, c.raw_product_name),
                COALESCE(c.price_with_logistics, c.price_without_logistics, 0),
                c.currency_code,
                c.effective_start,
                c.effective_end,
                c.sales_type
            FROM contracts c
            LEFT JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN products p ON p.id = c.product_id
            {sql_where}
            ORDER BY COALESCE(c.effective_end, c.effective_start, c.signed_date) DESC, c.id DESC
            LIMIT 12
            """
        )
        rows = []
        for no, customer, product, price, currency, valid_from, valid_to, sales_type in cur.fetchall():
            label = "出口批发" if sales_type == "export_wholesale" else ("本地批发" if sales_type == "local_wholesale" else "其他")
            rows.append([no or "--", customer or "--", product or "--", f"{float(price or 0):,.2f} {currency or ''}".strip(), valid_from or "--", valid_to or "--", label])
        return [_assistant_table("合同明细", ["合同号", "客户", "油品", "价格", "生效", "到期", "类型"], rows)] if rows else []


    def _assistant_market_watch_answer(cur):
        ensure_market_watch_schema(cur)
        cur.execute(
            """
            SELECT market_region, title, summary, price_text, source_name, observed_at
            FROM market_watch_items
            WHERE is_active = 1
            ORDER BY observed_at DESC, priority DESC, id DESC
            LIMIT 12
            """
        )
        rows = cur.fetchall()
        if not rows:
            return "暂未查询到市场观察信息。可以在后台执行“立即获取市场观察”后再查看。", []
        latest = max((row[5] for row in rows if row[5]), default=None)
        lines = [f"市场观察信息如下（最新获取时间 {latest or '--'}）："]
        region_names = {
            "russia": "俄罗斯",
            "Russia": "俄罗斯",
            "uzbekistan": "乌兹别克",
            "Uzbekistan": "乌兹别克",
            "global": "国际",
            "Global": "国际",
        }
        table_rows = []
        for region, title, summary, price_text, source, observed_at in rows[:9]:
            item = chinese_market_item({
                "region": region,
                "title": title,
                "summary": summary,
                "sourceName": source,
                "observedAt": observed_at.isoformat() if observed_at else None,
            })
            label = region_names.get(region, region or "市场")
            lines.append(f"{label}｜{item.get('title') or '--'}")
            if item.get("summary"):
                lines.append(f"  {item['summary'][:180]}")
            if price_text:
                lines.append(f"  价格：{price_text}")
            source_label = market_source_display(item.get("sourceName") or source)
            lines.append(f"  来源：{source_label}，时间：{observed_at or '--'}")
            table_rows.append([
                label,
                item.get("title") or "--",
                price_text or "--",
                item.get("summary") or "--",
                source_label,
                observed_at or "--",
            ])
        return "\n".join(lines), [_assistant_table("市场观察", ["区域", "标题", "价格信息", "摘要", "来源", "日期"], table_rows)]


    def _assistant_review_answer(label, data):
        review = data.get("review") or {}
        issues = data.get("issues") or []
        status = review.get("status") or {}
        matched = status.get("matched", {})
        need_review_rows = sum(int(item.get("rows") or 0) for key, item in status.items() if key != "matched")
        lines = [f"{label}审核信息如下："]
        lines.append(
            f"已匹配 {int(matched.get('rows') or 0)} 条，"
            f"待复核 {need_review_rows} 条，"
            f"开放数据问题 {len(issues)} 条。"
        )
        if review.get("topNeedsReview"):
            lines.append("待复核数据排行：")
            for item in review["topNeedsReview"][:8]:
                lines.append(
                    f"{item.get('entity') or '--'}｜{item.get('product') or '--'}："
                    f"{int(item.get('rows') or 0)} 条，{float(item.get('tons') or 0):,.3f} 吨"
                )
        if issues:
            lines.append("待处理问题：")
            for item in issues[:8]:
                lines.append(f"{item.get('type') or '--'}｜{item.get('severity') or '--'}｜{item.get('date') or '--'}：{item.get('message') or ''}")
        return "\n".join(lines)


    def _assistant_combined_answer(label, data):
        retail = data.get("retail") or {}
        wholesale = data.get("wholesale") or {}
        combined = data.get("combined") or {}
        lines = [f"{label}合并统计如下："]
        lines.append(f"合并销售量：{float(combined.get('salesTons') or 0):,.3f} 吨，销售金额：{float(combined.get('salesAmountCny') or 0):,.2f} 元。")
        lines.append(f"零售：{float(retail.get('tons') or 0):,.3f} 吨，{float(retail.get('amountCny') or 0):,.2f} 元。")
        lines.append(f"批发销售：{float(wholesale.get('salesTons') or 0):,.3f} 吨，{float(wholesale.get('salesAmountCny') or 0):,.2f} 元。")
        lines.append(f"外运：{float(combined.get('transferTons') or 0):,.3f} 吨。")
        if wholesale.get("byProductCategory"):
            products = wholesale["byProductCategory"]
            _append_rank_lines(lines, "出口批发油品排行：", products.get("export_wholesale"), limit=3)
            _append_rank_lines(lines, "本地批发油品排行：", products.get("local_wholesale"), limit=3)
        return "\n".join(lines)


    # ── Enhanced assistant: new query types ──

    def _read_daily_trend_snapshot(ym):
        year, month = ym.split("-")
        path = OILSTATION_ROOT / "cache_snapshots" / "monthly" / year / f"daily_{int(month):02d}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None


    def _read_yearly_kpi_snapshot(year):
        path = OILSTATION_ROOT / "cache_snapshots" / "yearly" / f"kpi_yearly_{year}_summary.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None


    def _read_yearly_dashboard_snapshot(year):
        path = OILSTATION_ROOT / "cache_snapshots" / "yearly" / f"dashboard_yearly_{year}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None


    def _assistant_daily_trend_answer(label, data):
        daily = data.get("daily") or []
        if not daily:
            return f"{label}趋势数据暂未生成。"
        volumes = [float(d.get("volume") or 0) for d in daily]
        amounts = [float(d.get("amount") or 0) for d in daily]
        total_vol = sum(volumes)
        total_amt = sum(amounts)
        avg_vol = total_vol / len(volumes) if volumes else 0
        max_idx = volumes.index(max(volumes)) if volumes else -1
        min_idx = volumes.index(min(volumes)) if volumes else -1
        lines = [f"{label}每日销量趋势（共 {len(daily)} 天数据）："]
        lines.append(f"合计销量 {_fmt_volume(total_vol)}，合计金额 {_fmt_amount(total_amt, '索姆')}")
        lines.append(f"日均销量 {_fmt_volume(avg_vol)}")
        if max_idx >= 0:
            lines.append(f"最高日：{daily[max_idx]['date']} 销量 {_fmt_volume(volumes[max_idx])} 金额 {_fmt_amount(amounts[max_idx], '索姆')}")
        if min_idx >= 0:
            lines.append(f"最低日：{daily[min_idx]['date']} 销量 {_fmt_volume(volumes[min_idx])} 金额 {_fmt_amount(amounts[min_idx], '索姆')}")
        return "\n".join(lines)


    def _assistant_daily_trend_tables(label, data):
        daily = data.get("daily") or []
        if not daily:
            return []
        return [_assistant_table(
            f"{label}每日趋势",
            ["日期", "销量(升)", "金额(索姆)"],
            [
                [d.get("date", ""), _fmt_volume(d.get("volume")), _fmt_amount(d.get("amount"), "索姆")]
                for d in daily
            ],
        )]


    def _assistant_yearly_kpi_answer(label, data):
        summary = data.get("summary") or {}
        comp = data.get("comparison") or {}
        lines = [f"{label}年度KPI如下："]
        lines.append(f"累计销量 {_fmt_volume(summary.get('totalVolume') or summary.get('totalLiters'))}")
        lines.append(f"累计金额 {_fmt_amount(summary.get('totalSales') or summary.get('totalAmount'), '索姆')}")
        lines.append(f"交易笔数 {int(summary.get('transactionCount') or 0)} 笔")
        lines.append(f"活跃站点 {int(summary.get('activeShops') or 0)} 个")
        yoy_vol = comp.get("yoyVolume")
        yoy_sales = comp.get("yoySales")
        if yoy_vol is not None:
            lines.append(f"同比销量：{_fmt_pct(yoy_vol)}")
        if yoy_sales is not None:
            lines.append(f"同比金额：{_fmt_pct(yoy_sales)}")
        return "\n".join(lines)


    def _assistant_yearly_kpi_tables(label, data):
        summary = data.get("summary") or {}
        comp = data.get("comparison") or {}
        rows = [
            ["累计销量", _fmt_volume(summary.get("totalVolume") or summary.get("totalLiters"))],
            ["累计金额", _fmt_amount(summary.get("totalSales") or summary.get("totalAmount"), "索姆")],
            ["交易笔数", str(int(summary.get("transactionCount") or 0))],
            ["活跃站点", str(int(summary.get("activeShops") or 0))],
        ]
        yoy_vol = comp.get("yoyVolume")
        yoy_sales = comp.get("yoySales")
        if yoy_vol is not None:
            rows.append(["同比销量", _fmt_pct(yoy_vol)])
        if yoy_sales is not None:
            rows.append(["同比金额", _fmt_pct(yoy_sales)])
        inventory = summary.get("inventory")
        if inventory is not None and float(inventory) > 0:
            rows.append(["期末库存", _fmt_volume(inventory)])
        return [_assistant_table(f"{label}年度KPI", ["指标", "数值"], rows)]


    def _fmt_pct(v):
        if v is None:
            return "--"
        sign = "+" if v > 0 else ""
        return f"{sign}{v:.1f}%"


    def _assistant_station_status_answer():
        conn = get_connection()
        try:
            cur = conn.cursor()
            statuses = active_station_statuses(cur)
        finally:
            conn.close()
        if not statuses:
            return "当前所有站点正常营业。"
        closed = [s for s in statuses.values() if s.get("status") == "closed"]
        warning = [s for s in statuses.values() if s.get("status") == "warning"]
        lines = []
        if closed:
            lines.append(f"暂停营业/停站点（{len(closed)} 个）：")
            for s in closed:
                reason = s.get("closedReason") or s.get("statusLabel") or "未知"
                lines.append(f"  {s.get('name')}（{s.get('region')}）— {reason}")
        if warning:
            if closed:
                lines.append("")
            lines.append(f"异常状态站点（{len(warning)} 个）：")
            for s in warning:
                reason = s.get("closedReason") or s.get("statusLabel") or "未知"
                lines.append(f"  {s.get('name')}（{s.get('region')}）— {reason}（不影响销售）")
        if not closed and not warning:
            lines.append("当前所有站点状态正常。")
        return "\n".join(lines)


    def _assistant_station_status_tables():
        conn = get_connection()
        try:
            cur = conn.cursor()
            statuses = active_station_statuses(cur)
        finally:
            conn.close()
        if not statuses:
            return []
        closed = [s for s in statuses.values() if s.get("status") == "closed"]
        warning = [s for s in statuses.values() if s.get("status") == "warning"]
        all_items = closed + warning
        if not all_items:
            return []
        return [_assistant_table(
            "当前站点异常状态",
            ["站点", "区域", "状态", "原因", "开始时间"],
            [
                [
                    s.get("name", "--"),
                    s.get("region", "--"),
                    "停业" if s.get("status") == "closed" else "异常",
                    s.get("closedReason") or s.get("statusLabel") or "",
                    s.get("startedAt") or "--",
                ]
                for s in all_items
            ],
        )]


    def _assistant_comparison_answer(label, monthly_data):
        comp = monthly_data.get("comparison") or {}
        mom = comp.get("mom") or {}
        yoy = comp.get("yoy") or {}
        lines = [f"{label}同比环比："]
        yoy_amt = yoy.get("sales")
        yoy_vol = yoy.get("volume")
        mom_amt = mom.get("sales")
        mom_vol = mom.get("volume")
        if yoy_amt is not None:
            lines.append(f"同比金额：{_fmt_pct(yoy_amt)}")
        if yoy_vol is not None:
            lines.append(f"同比销量：{_fmt_pct(yoy_vol)}")
        if mom_amt is not None:
            lines.append(f"环比金额：{_fmt_pct(mom_amt)}")
        if mom_vol is not None:
            lines.append(f"环比销量：{_fmt_pct(mom_vol)}")
        if yoy_amt is None and yoy_vol is None and mom_amt is None and mom_vol is None:
            lines.append("暂无对比数据（快照未生成对比字段，刷新后重试）。")
        return "\n".join(lines)


    def _assistant_comparison_tables(label, monthly_data):
        comp = monthly_data.get("comparison") or {}
        mom = comp.get("mom") or {}
        yoy = comp.get("yoy") or {}
        rows = []
        for v, label_k in [(yoy.get("volume"), "同比销量"), (yoy.get("sales"), "同比金额"),
                            (mom.get("volume"), "环比销量"), (mom.get("sales"), "环比金额")]:
            if v is not None:
                rows.append([label_k, _fmt_pct(v)])
        if not rows:
            return []
        return [_assistant_table(f"{label}同比环比", ["指标", "变化"], rows)]


    def _assistant_resource_share_answer(label, data):
        resources = [item for item in (data.get("byResource") or []) if float(item.get("volume") or 0) > 0]
        if not resources:
            return f"{label}无油品数据。"
        total_vol = sum(float(r.get("volume") or 0) for r in resources)
        total_amt = sum(float(r.get("amount") or 0) for r in resources)
        lines = [f"{label}油品结构与占比："]
        for item in sorted(resources, key=lambda r: float(r.get("amount") or 0), reverse=True):
            vol = float(item.get("volume") or 0)
            amt = float(item.get("amount") or 0)
            pct = vol / total_vol * 100 if total_vol else 0
            lines.append(f"  {item.get('name')}：{_fmt_volume(vol)}（占比 {pct:.1f}%），{_fmt_amount(amt, '索姆')}")
        lines.append(f"  合计：{_fmt_volume(total_vol)}，{_fmt_amount(total_amt, '索姆')}")
        return "\n".join(lines)


    @app.route("/api/data-assistant/query", methods=["POST"])
    def api_data_assistant_query():
        payload = request.get_json(force=True) or {}
        question = clean_str(payload.get("question"))
        if not question:
            return jsonify({"error": "question_required"}), 400

        label, start, end = _assistant_period(question)
        label = _assistant_period_display(label, start, end)
        if _assistant_has_any(question, ("停业", "站点状态", "异常站点", "暂停营业", "维修", "停电")):
            return jsonify({
                "ok": True,
                "question": question,
                "periodLabel": "当前",
                "answer": _assistant_station_status_answer(),
                "tables": _assistant_station_status_tables(),
            })
        if _assistant_has_any(question, ("趋势", "每日", "日趋势", "日销量", "走势")):
            ym = f"{start.year}-{start.month:02d}"
            trend_data = _read_daily_trend_snapshot(ym)
            if trend_data:
                return jsonify({
                    "ok": True,
                    "question": question,
                    "periodLabel": ym,
                    "answer": _assistant_daily_trend_answer(ym, trend_data),
                    "tables": _assistant_daily_trend_tables(ym, trend_data),
                    "data": trend_data,
                })
        if _assistant_has_any(question, ("同比", "环比", "对比", "较去年", "较上月")):
            ym = f"{start.year}-{start.month:02d}"
            monthly_data = _read_retail_snapshot("monthly", ym)
            if monthly_data:
                return jsonify({
                    "ok": True,
                    "question": question,
                    "periodLabel": ym,
                    "answer": _assistant_comparison_answer(ym, monthly_data),
                    "tables": _assistant_comparison_tables(ym, monthly_data),
                    "data": monthly_data,
                })
        if _assistant_has_any(question, ("占比", "结构", "油品结构", "油品占比", "构成")):
            data = _retail_snapshot_for_period(start, end)
            if not data:
                response = open_oilstation(
                    "/api/assistant/retail-summary",
                    query_string={"start": start.isoformat(), "end": end.isoformat()},
                )
                data = response.get_json() if response.status_code < 400 else {}
            return jsonify({
                "ok": True,
                "question": question,
                "periodLabel": label,
                "answer": _assistant_resource_share_answer(label, data),
                "tables": _assistant_retail_tables(label, data, question),
                "data": data,
            })
        if _assistant_has_any(question, ("KPI", "关键指标", "累计", "年度指标", "今年")):
            year = start.year
            kpi_data = _read_yearly_kpi_snapshot(year)
            if kpi_data:
                return jsonify({
                    "ok": True,
                    "question": question,
                    "periodLabel": f"{year}年",
                    "answer": _assistant_yearly_kpi_answer(f"{year}年", kpi_data),
                    "tables": _assistant_yearly_kpi_tables(f"{year}年", kpi_data),
                    "data": kpi_data,
                })
        if _assistant_has_any(question, ("价格", "单价", "售价", "零售价")):
            data = _retail_snapshot_for_period(start, end)
            if not data:
                response = open_oilstation(
                    "/api/assistant/retail-summary",
                    query_string={"start": start.isoformat(), "end": end.isoformat()},
                )
                data = response.get_json() if response.status_code < 400 else {}
            resources = [item for item in (data.get("byResource") or []) if float(item.get("volume") or 0) > 0]
            lines = [f"{label}零售价格（均价 = 金额 ÷ 销量）："]
            price_rows = []
            for item in sorted(resources, key=lambda r: float(r.get("amount") or 0), reverse=True):
                vol = float(item.get("volume") or 0)
                amt = float(item.get("amount") or 0)
                price = amt / vol if vol else 0
                lines.append(f"  {item.get('name')}：{price:.2f} 索姆/升（{_fmt_volume(vol)}，{_fmt_amount(amt, '索姆')}）")
                price_rows.append([item.get("name", "--"), f"{price:.2f}", _fmt_volume(vol), _fmt_amount(amt, "索姆")])
            if not lines[1:]:
                lines.append("  该区间暂无销售数据，无法计算均价。")
            total_vol = sum(float(r.get("volume") or 0) for r in resources)
            total_amt = sum(float(r.get("amount") or 0) for r in resources)
            avg_price = total_amt / total_vol if total_vol else 0
            lines.append(f"  综合均价：{avg_price:.2f} 索姆/升")
            price_rows.append(["综合均价", f"{avg_price:.2f}", _fmt_volume(total_vol), _fmt_amount(total_amt, "索姆")])
            return jsonify({
                "ok": True,
                "question": question,
                "periodLabel": label,
                "answer": "\n".join(lines),
                "tables": [_assistant_table(f"{label}零售价格", ["油品", "均价(索姆/升)", "销量", "金额"], price_rows)],
                "data": data,
            })
        if _assistant_has_any(question, ("市场", "行情", "观察", "原油", "成品油", "俄罗斯", "乌兹别克", "国际")):
            conn = get_connection()
            try:
                cur = conn.cursor()
                answer, tables = _assistant_market_watch_answer(cur)
            finally:
                conn.close()
            return jsonify({"ok": True, "question": question, "periodLabel": "市场观察", "answer": answer, "tables": tables})
        if "合同" in question:
            conn = get_connection()
            try:
                cur = conn.cursor()
                answer = _assistant_contract_answer(cur, question)
                tables = _assistant_contract_tables(cur, question)
            finally:
                conn.close()
            return jsonify({"ok": True, "question": question, "periodLabel": "合同", "answer": answer, "tables": tables})
        if _assistant_has_any(question, ("合并", "总销售", "整体", "公司", "总量", "总金额")):
            year, month = _assistant_year_month_from_period(start, end)
            conn = get_connection()
            try:
                cur = conn.cursor()
                data = _combined_data_from_snapshots(cur, year, month, start, end)
            finally:
                conn.close()
            return jsonify({
                "ok": True,
                "question": question,
                "periodLabel": label,
                "queryStart": start.isoformat(),
                "queryEndExclusive": end.isoformat(),
                "answer": _assistant_combined_answer(label, data),
                "tables": _assistant_combined_tables(label, data),
                "data": data,
            })
        if _assistant_has_any(question, ("审核", "复核", "异常", "提示", "未匹配")):
            year, month = _assistant_year_month_from_period(start, end)
            conn = get_connection()
            try:
                cur = conn.cursor()
                data = summarize_wholesale_page(cur, year, month)
                answer = _assistant_review_answer(label, data)
            finally:
                conn.close()
            return jsonify({"ok": True, "question": question, "periodLabel": label, "answer": answer, "tables": _assistant_review_tables(label, data), "data": data})
        if any(word in question for word in ("批发", "外运", "出口", "本地", "客户")):
            year, month = _assistant_year_month_from_period(start, end)
            conn = get_connection()
            try:
                cur = conn.cursor()
                data = summarize_wholesale_page(cur, year, month)
            finally:
                conn.close()
            return jsonify({
                "ok": True,
                "question": question,
                "periodLabel": label,
                "queryStart": start.isoformat(),
                "queryEndExclusive": end.isoformat(),
                "answer": _format_assistant_wholesale_answer(label, data, question),
                "tables": _assistant_wholesale_tables(label, data, question),
                "data": data,
            })
        if "汇率" in question or "美元" in question or "人民币" in question:
            conn = get_connection()
            try:
                cur = conn.cursor()
                answer = _assistant_exchange_answer(cur, label, start, end)
                tables = _assistant_exchange_tables(cur, label, start, end)
            finally:
                conn.close()
            return jsonify({"ok": True, "question": question, "periodLabel": label, "answer": answer, "tables": tables})
        if "密度" in question:
            conn = get_connection()
            try:
                cur = conn.cursor()
                answer = _assistant_density_answer(cur)
                tables = _assistant_density_tables(cur)
            finally:
                conn.close()
            return jsonify({"ok": True, "question": question, "periodLabel": "当前", "answer": answer, "tables": tables})
        if _assistant_has_any(question, ("库存", "期末")):
            inventory_data = _retail_inventory_for_period(start, end)
            if inventory_data:
                return jsonify({
                    "ok": True,
                    "question": question,
                    "periodLabel": label,
                    "queryStart": start.isoformat(),
                    "queryEndExclusive": end.isoformat(),
                    "answer": _assistant_retail_inventory_answer(label, inventory_data),
                    "tables": _assistant_retail_inventory_tables(label, inventory_data),
                    "data": inventory_data,
                })
        data = _retail_snapshot_for_period(start, end)
        if not data:
            response = open_oilstation(
                "/api/assistant/retail-summary",
                query_string={"start": start.isoformat(), "end": end.isoformat()},
            )
            if response.status_code >= 400:
                return jsonify({"error": "retail_query_failed", "detail": response.get_data(as_text=True)}), 502
            data = response.get_json() or {}
        data["question"] = question
        return jsonify({
            "ok": True,
            "question": question,
            "periodLabel": label,
            "queryStart": start.isoformat(),
            "queryEndExclusive": end.isoformat(),
            "answer": _format_assistant_retail_answer(label, data),
            "tables": _assistant_retail_tables(label, data, question),
            "data": data,
        })



