# -*- coding: utf-8 -*-
"""利润核算 Excel 生成器。

月度利润表的站点、油品行使用零售日报同一套站点与油品获取口径：
- 站点顺序/中俄文名称来自 constants.SHOP_KEY_MAP
- 油品行来自 export_excel._get_station_fuel_keys 与 _resource_name_for_report
- 销量、销售金额、吨位来自零售日报同源 _build_sheet_data 数据

profit_station_config.json 只作为费用、运费系数、购买单价和少量销售单价默认值来源；
profit_cost_items 中的维护数据覆盖 M/N/O/P/Q 默认值。
"""
from __future__ import annotations

import json
import os
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

import pymysql

from business_time import shift_business_date_expr
from constants import REPORT_HIDDEN_STATION_KEYS, REPORT_HIDDEN_STATION_NOTE, SHOP_KEY_MAP
from export_excel import (
    EXPORT_DIR,
    Font,
    MONTH_NAMES_CN,
    _apply_style,
    _build_sheet_data,
    _get_station_fuel_keys,
    _resource_name_for_report,
    get_column_letter,
    openpyxl,
)
from endpoints.v1.retail.common.query import get_query_date_range
from endpoints.v1.retail.common.currency import (
    average_cny_kgs_for_period,
    cny_from_kgs_average,
    sales_db_config,
)

PROFIT_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "..", "..", "Sales", "profit_station_config.json"
)
PROFIT_PURCHASE_PRICE_OVERRIDES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "Sales",
    "profit_purchase_price_overrides.json",
)

HEADERS = [
    "加油站名称", "油品种类", "销量（L）", "单价(COM)", "销售收入(COM)",
    "本月累计 销售总额（COM）", "本月累 费用总额（COM）", "油品种类",
    "购买单价（COM）", "数量（L）", "合计", "购油成本总额（COM）",
    "职工薪酬", "运输费", "水电费", "警民联合服务费", "网费",
    "收入", "增值税", "营业税", "毛利", "净利润",
]

YEAR_HEADERS = [
    "序号", "月份", "销量", "销售金额", "购油金额", "薪酬", "运费", "水电网警",
    "收入", "采购成本", "增值税", "营业税", "毛利", "净利润", "销量(吨)", "当月汇率", "净利润(元)", "柴油销售金额",
]

YEAR_NOTES = [
    "销售金额=数据库当月销售金额",
    "购油金额=当月销售量*购买单价",
    "收入=非柴油收入+柴油收入",
    "非柴油收入=（80+92+95+液化气）/1.12",
    "柴油收入=柴油/1.13",
    "采购成本=购油金额/1.12+运费/1.04",
    "增值税=（收入-采购成本）*0.12+运费/1.04*0.04",
    "营业税=柴油销售金额*0.01",
    "毛利=收入-采购成本",
    "净利润=毛利-薪酬-水电网警",
]

COL_WIDTHS = {
    "A": 18.0, "B": 10.8, "C": 12.6, "D": 11.3, "E": 14.1, "F": 14.9,
    "G": 14.0, "H": 11.4, "I": 15.4, "J": 11.4, "K": 14.9, "M": 12.6,
    "O": 11.4, "Q": 10.4, "R": 16.3, "S": 13.7, "T": 12.6, "U": 13.7,
    "V": 12.4,
}

YEAR_COL_WIDTHS = {
    "A": 8.0, "B": 12.0, "C": 14.0, "D": 15.0, "E": 15.0, "F": 12.0,
    "G": 12.0, "H": 13.0, "I": 15.0, "J": 15.0, "K": 13.0, "L": 12.0,
    "M": 14.0, "N": 14.0, "O": 13.0, "P": 12.0, "Q": 14.0, "R": 15.0,
}

MERGE_COLS = ["A", "F", "G", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V"]
NUM_FMT = "0.00_ "
TON_FMT = "0.000_ "
YEAR_DIESEL_AMOUNT_COL = 18

DIESEL_RESOURCE_KEYS = {106, 109, 110}
DEFAULT_PURCHASE_PRICES = {
    102: 50.0,
    103: 54.0,
    104: 65.0,
    106: 68.0,
    108: 23.1,
    109: 68.0,
    110: 79.0,
}
PURCHASE_RESOURCE_NAMES = {
    102: "АЙ80",
    103: "АЙ92",
    104: "АЙ95",
    106: "Дт",
    108: "СПБТ",
    109: "Д/Т",
    110: "Д/Т-35",
}


def _round(value, digits):
    try:
        quant = Decimal("1").scaleb(-int(digits))
        return float(Decimal(str(value or 0)).quantize(quant, rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError, ValueError):
        return 0.0


def _num(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_profit_year_month(value):
    text = str(value or "").strip()
    try:
        parts = text.split("-")
        if len(parts) != 2:
            return None
        year = int(parts[0])
        month = int(parts[1])
        if 2000 <= year <= 2100 and 1 <= month <= 12:
            return f"{year:04d}-{month:02d}"
    except (TypeError, ValueError):
        return None
    return None


def normalize_profit_year(value):
    try:
        year = int(str(value or "").strip())
        if 2000 <= year <= 2100:
            return f"{year:04d}"
    except (TypeError, ValueError):
        return None
    return None


def _shift_year_month(year_month, months_delta):
    year_month = normalize_profit_year_month(year_month)
    if not year_month:
        return None
    year, month = [int(part) for part in year_month.split("-")]
    month_index = year * 12 + (month - 1) + int(months_delta)
    return f"{month_index // 12:04d}-{month_index % 12 + 1:02d}"


def _formula_number(value):
    try:
        return f"{float(value):g}"
    except (TypeError, ValueError):
        return "0"


def _text_width(value):
    if value is None:
        return 0
    if isinstance(value, str) and value.startswith("="):
        return 14
    text = str(value)
    if not text:
        return 0
    widths = []
    for part in text.splitlines():
        widths.append(sum(2 if unicodedata.east_asian_width(char) in {"F", "W"} else 1 for char in part))
    return max(widths or [0])


def _center_used_cells(ws, max_row, max_col, min_row=1):
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, max_col=max_col):
        for cell in row:
            if cell.value is None:
                continue
            current = cell.alignment
            cell.alignment = openpyxl.styles.Alignment(
                horizontal="center",
                vertical="center",
                wrap_text=current.wrap_text,
            )


def _auto_fit_columns(ws, min_widths=None, min_row=1, max_row=None, max_width=32.0):
    min_widths = min_widths or {}
    max_row = max_row or ws.max_row
    for col_idx in range(1, ws.max_column + 1):
        letter = get_column_letter(col_idx)
        if ws.column_dimensions[letter].hidden:
            continue
        width = 0
        for row in range(min_row, max_row + 1):
            width = max(width, _text_width(ws.cell(row=row, column=col_idx).value))
        target = min(max(float(min_widths.get(letter, 8.0)), width + 2), max_width)
        ws.column_dimensions[letter].width = target


def _load_profit_config():
    with open(PROFIT_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def _load_purchase_price_overrides():
    try:
        with open(PROFIT_PURCHASE_PRICE_OVERRIDES_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return {}
    return data.get("months") or {}


def _ensure_profit_runtime_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_cost_items (
            id          BIGINT PRIMARY KEY AUTO_INCREMENT,
            month_year  VARCHAR(7) NOT NULL,
            shop_key    INT NOT NULL,
            cost_type   ENUM('M', 'N', 'O', 'P', 'Q') NOT NULL,
            value       DECIMAL(14,2) NOT NULL DEFAULT 0,
            updated_by  BIGINT NULL,
            updated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_month_shop_cost (month_year, shop_key, cost_type),
            KEY idx_month (month_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_purchase_prices (
            id             BIGINT PRIMARY KEY AUTO_INCREMENT,
            month_year     VARCHAR(7) NOT NULL,
            shop_key       INT NOT NULL,
            resource_key   INT NOT NULL,
            purchase_name  VARCHAR(64) NULL,
            purchase_price DECIMAL(14,4) NOT NULL DEFAULT 0,
            updated_by     BIGINT NULL,
            updated_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_month_shop_resource (month_year, shop_key, resource_key),
            KEY idx_month (month_year)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS profit_report_snapshots (
            id            BIGINT PRIMARY KEY AUTO_INCREMENT,
            snapshot_type ENUM('month', 'year') NOT NULL,
            period_key    VARCHAR(7) NOT NULL,
            payload_json  LONGTEXT NOT NULL,
            generated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_profit_report_snapshot (snapshot_type, period_key),
            KEY idx_period (period_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)


def _load_file_month_purchase_overrides(year_month):
    raw_month = _load_purchase_price_overrides().get(year_month) or {}
    overrides: dict[tuple[int, int], dict[str, Any]] = {}
    for shop_key, rows in raw_month.items():
        try:
            shop_key_int = int(shop_key)
        except (TypeError, ValueError):
            continue
        for rk, value in (rows or {}).items():
            try:
                overrides[(shop_key_int, int(rk))] = dict(value or {})
            except (TypeError, ValueError):
                continue
    return overrides


def _load_db_month_purchase_overrides(year_month):
    overrides: dict[tuple[int, int], dict[str, Any]] = {}
    try:
        conn = pymysql.connect(**sales_db_config())
    except Exception:
        return overrides
    try:
        cur = conn.cursor(pymysql.cursors.DictCursor)
        _ensure_profit_runtime_schema(cur)
        cur.execute(
            """
            SELECT shop_key, resource_key, purchase_name, purchase_price
            FROM profit_purchase_prices
            WHERE month_year=%s
            """,
            (year_month,),
        )
        for row in cur.fetchall():
            shop_key = int(row["shop_key"])
            resource_key = int(row["resource_key"])
            overrides[(shop_key, resource_key)] = {
                "I": float(row["purchase_price"]),
                "H": row.get("purchase_name") or PURCHASE_RESOURCE_NAMES.get(
                    resource_key,
                    _resource_name_for_report(shop_key, resource_key),
                ),
            }
        cur.close()
    except Exception:
        pass
    finally:
        conn.close()
    return overrides


def _load_month_purchase_overrides(year_month, include_db=True):
    overrides = _load_file_month_purchase_overrides(year_month)
    if include_db:
        overrides.update(_load_db_month_purchase_overrides(year_month))
    return overrides


def _load_cost_overrides(year_month):
    """读取 sales_visualization.profit_cost_items，返回 {(shop_key, cost_type): value}。"""
    overrides = {}
    try:
        conn = pymysql.connect(**sales_db_config())
    except Exception:
        return overrides
    try:
        cur = conn.cursor(pymysql.cursors.DictCursor)
        _ensure_profit_runtime_schema(cur)
        cur.execute(
            "SELECT shop_key, cost_type, value FROM profit_cost_items WHERE month_year=%s",
            (year_month,),
        )
        for row in cur.fetchall():
            overrides[(int(row["shop_key"]), row["cost_type"])] = float(row["value"])
        cur.close()
    except Exception:
        pass
    finally:
        conn.close()
    return overrides


def _snapshot_period_key(snapshot_type, period_key):
    if snapshot_type == "year":
        return f"{int(period_key):04d}"
    return str(period_key)


def _load_profit_snapshot(snapshot_type, period_key):
    period_key = _snapshot_period_key(snapshot_type, period_key)
    try:
        conn = pymysql.connect(**sales_db_config())
    except Exception:
        return None
    try:
        cur = conn.cursor(pymysql.cursors.DictCursor)
        _ensure_profit_runtime_schema(cur)
        cur.execute(
            """
            SELECT payload_json, generated_at
            FROM profit_report_snapshots
            WHERE snapshot_type=%s AND period_key=%s
            """,
            (snapshot_type, period_key),
        )
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        payload = json.loads(row["payload_json"])
        generated_at = row.get("generated_at")
        if hasattr(generated_at, "isoformat"):
            generated_at = generated_at.isoformat(sep=" ", timespec="seconds")
        return payload, generated_at
    except Exception:
        return None
    finally:
        conn.close()


def _save_profit_snapshot(snapshot_type, period_key, payload):
    period_key = _snapshot_period_key(snapshot_type, period_key)
    generated_at = datetime.now().isoformat(sep=" ", timespec="seconds")
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    try:
        conn = pymysql.connect(**sales_db_config())
    except Exception:
        return None
    try:
        cur = conn.cursor()
        _ensure_profit_runtime_schema(cur)
        cur.execute(
            """
            INSERT INTO profit_report_snapshots (snapshot_type, period_key, payload_json, generated_at)
            VALUES (%s, %s, %s, NOW())
            ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), generated_at=NOW()
            """,
            (snapshot_type, period_key, payload_json),
        )
        cur.close()
        return generated_at
    except Exception:
        return None
    finally:
        conn.close()


def _with_snapshot_meta(payload, generated_at=None, cached=False):
    data = dict(payload)
    if generated_at:
        data["snapshotGeneratedAt"] = generated_at
    data["snapshotCached"] = bool(cached)
    return data


PROFIT_COMPARISON_KEYS = [
    "volume",
    "salesAmount",
    "dieselVolume",
    "dieselTons",
    "dieselSalesAmount",
    "purchaseAmount",
    "salary",
    "freight",
    "otherFees",
    "income",
    "purchaseCost",
    "vat",
    "businessTax",
    "grossProfit",
    "netProfit",
    "tons",
    "netProfitCny",
]


def _snapshot_summary_if_current(snapshot_type, period_key):
    cached = _load_profit_snapshot(snapshot_type, period_key)
    if not cached:
        return None
    payload, _generated_at = cached
    if not _profit_snapshot_has_current_fields(snapshot_type, payload):
        return None
    summary = (payload or {}).get("summary")
    return dict(summary) if isinstance(summary, dict) else None


def _profit_comparison_item(period_key, label_key, snapshot_type="month", summary=None):
    if summary is None and snapshot_type == "month":
        summary = _snapshot_summary_if_current(snapshot_type, period_key)
    return {
        "period": str(period_key),
        label_key: str(period_key),
        "summary": summary,
        "source": "profit_snapshot" if summary else None,
    }


def _profit_month_comparison(year_month):
    previous_month = _shift_year_month(year_month, -1)
    last_year_month = _shift_year_month(year_month, -12)
    return {
        "mom": _profit_comparison_item(previous_month, "prevMonth") if previous_month else None,
        "yoy": _profit_comparison_item(last_year_month, "yoyMonth") if last_year_month else None,
    }


def _cumulative_year_summary(months, through_month):
    summary = {}
    try:
        through_month = int(through_month or 0)
    except (TypeError, ValueError):
        through_month = 0
    for row in months or []:
        if not row.get("active") or int(row.get("month") or 0) > through_month:
            continue
        for key in PROFIT_COMPARISON_KEYS:
            value = _num(row.get(key))
            summary[key] = summary.get(key, 0.0) + value
    for key in list(summary):
        summary[key] = _round(summary[key], 3 if key in {"volume", "tons", "dieselVolume", "dieselTons"} else 2)
    return summary or None


def _profit_year_snapshot_months_if_current(year):
    cached = _load_profit_snapshot("year", year)
    if not cached:
        return None
    payload, _generated_at = cached
    if not _profit_snapshot_has_current_fields("year", payload):
        return None
    months = (payload or {}).get("months")
    return months if isinstance(months, list) else None


def _profit_year_comparison(year, payload):
    year = int(year)
    included = int((payload or {}).get("includedMonths") or 0)
    previous_summary = _cumulative_year_summary((payload or {}).get("months") or [], included - 1) if included > 1 else None
    last_year_months = _profit_year_snapshot_months_if_current(year - 1)
    last_year_summary = _cumulative_year_summary(last_year_months or [], included) if included > 0 and last_year_months else None
    return {
        "mom": _profit_comparison_item(f"{year:04d}-01..{included - 1:02d}", "prevPeriod", "year", previous_summary) if included > 1 else None,
        "yoy": _profit_comparison_item(f"{year - 1:04d}-01..{included:02d}", "yoyPeriod", "year", last_year_summary) if included > 0 else None,
    }


def _with_profit_comparison(snapshot_type, period_key, payload):
    data = dict(payload)
    if snapshot_type == "month":
        data["comparison"] = _profit_month_comparison(period_key)
    elif snapshot_type == "year":
        data["comparison"] = _profit_year_comparison(int(period_key), payload)
    return data


def _profit_snapshot_has_current_fields(snapshot_type, payload):
    summary = (payload or {}).get("summary") or {}
    for key in ("dieselVolume", "dieselTons"):
        if key not in summary:
            return False
    if snapshot_type == "year":
        for month in (payload or {}).get("months") or []:
            if month.get("active"):
                for key in ("dieselVolume", "dieselTons"):
                    if key not in month:
                        return False
    return True


def _period_day_count(start, end):
    try:
        return max((date.fromisoformat(end) - date.fromisoformat(start)).days, 1)
    except (TypeError, ValueError):
        return 1


def _load_station_operating_days(cur, start, end, station_keys):
    if not station_keys:
        return {}
    business_day = shift_business_date_expr("sh")
    placeholders = ",".join(["%s"] * len(station_keys))
    params = tuple(int(key) for key in station_keys) + (start, end, start, end, end)
    cur.execute(
        f"""
        SELECT sh.ShopKey, COUNT(DISTINCT {business_day}) AS operating_days
        FROM shift sh
        WHERE sh.ShopKey IN ({placeholders})
          AND sh.DatetimeShiftBegin IS NOT NULL
          AND sh.DatetimeShiftEnd IS NOT NULL
          AND sh.DatetimeShiftEnd > sh.DatetimeShiftBegin
          AND sh.DatetimeShiftBegin >= DATE_SUB(%s, INTERVAL 1 DAY)
          AND sh.DatetimeShiftBegin < DATE_ADD(%s, INTERVAL 1 DAY)
          AND {business_day} >= %s
          AND {business_day} < %s
          AND sh.DatetimeShiftEnd < DATE_ADD(%s, INTERVAL 1 DAY)
        GROUP BY sh.ShopKey
        """,
        params,
    )
    return {int(row[0]): int(row[1] or 0) for row in cur.fetchall()}


def _load_station_first_operating_days(cur, station_keys):
    if not station_keys:
        return {}
    business_day = shift_business_date_expr("sh")
    placeholders = ",".join(["%s"] * len(station_keys))
    cur.execute(
        f"""
        SELECT sh.ShopKey, MIN({business_day}) AS first_operating_day
        FROM shift sh
        WHERE sh.ShopKey IN ({placeholders})
          AND sh.DatetimeShiftBegin IS NOT NULL
          AND sh.DatetimeShiftEnd IS NOT NULL
          AND sh.DatetimeShiftEnd > sh.DatetimeShiftBegin
        GROUP BY sh.ShopKey
        """,
        tuple(int(key) for key in station_keys),
    )
    result = {}
    for shop_key, first_day in cur.fetchall():
        if hasattr(first_day, "isoformat"):
            first_day = first_day.isoformat()
        result[int(shop_key)] = str(first_day) if first_day else None
    return result


def _apply_operating_cost_ratios(stations, operating_days, period_days, period_start=None, first_operating_days=None):
    period_days = max(int(period_days or 0), 1)
    first_operating_days = first_operating_days or {}
    for station in stations:
        shop_key = int(station["shopKey"])
        days = max(0, min(int(operating_days.get(shop_key, 0) or 0), period_days))
        first_day = first_operating_days.get(shop_key)
        is_new_station = bool(first_day and period_start and first_day >= period_start)
        if days <= 0:
            ratio = 0.0
            reason = "no_operation"
        elif is_new_station:
            ratio = days / period_days
            reason = "new_station"
        else:
            ratio = 1.0
            reason = "full_month"
        station["operatingDays"] = days
        station["periodDays"] = period_days
        station["operatingRatio"] = _round(ratio, 4)
        station["firstOperatingDay"] = first_day
        station["costProrationReason"] = reason
        for cost_type in ("M", "O", "P", "Q"):
            base_key = f"{cost_type}Base"
            base_value = _num(station.get(cost_type))
            station[base_key] = base_value
            station[cost_type] = _round(base_value * ratio, 2)
    return stations


def profit_month_workbook_path(year_month):
    year_month = normalize_profit_year_month(year_month)
    if not year_month:
        raise ValueError("invalid year_month, expected YYYY-MM")
    year, month = [int(part) for part in year_month.split("-")]
    month_cn = MONTH_NAMES_CN.get(month, f"{month}月")
    gen_date = (datetime.now() - timedelta(days=1)).strftime("%d.%m")
    filename = f"加油站{year}年{month_cn}利润核算{gen_date}.xlsx"
    return filename, os.path.join(EXPORT_DIR, filename)


def profit_year_workbook_path(year):
    year_text = normalize_profit_year(year)
    if not year_text:
        raise ValueError("invalid year, expected YYYY")
    year = int(year_text)
    gen_date = (datetime.now() - timedelta(days=1)).strftime("%d.%m")
    filename = f"加油站{year}年利润核算{gen_date}.xlsx"
    return filename, os.path.join(EXPORT_DIR, filename)


def _profit_defaults_by_shop(config):
    defaults: dict[int, dict[str, Any]] = {}
    for station in config:
        shop_key = int(station["shopKey"])
        rows_by_rk = {}
        rows_by_source_row = {}
        for row in station.get("rows") or []:
            rk = int(row.get("rk") or 0)
            if rk <= 0:
                continue
            row_copy = dict(row)
            rows_by_rk[rk] = row_copy
            try:
                rows_by_source_row[int(row_copy.get("row"))] = row_copy
            except (TypeError, ValueError):
                pass

        n_rks = []
        for source_row in station.get("n_rows") or []:
            row = rows_by_source_row.get(int(source_row))
            if row:
                n_rks.append(int(row["rk"]))

        diesel_rks = []
        for source_row in station.get("diesel_rows") or []:
            row = rows_by_source_row.get(int(source_row))
            if row:
                diesel_rks.append(int(row["rk"]))

        defaults[shop_key] = {
            "M": _num(station.get("M")),
            "O": _num(station.get("O")),
            "P": _num(station.get("P")),
            "Q": _num(station.get("Q")),
            "n_rate": station.get("n_rate"),
            "rows_by_rk": rows_by_rk,
            "n_rks": n_rks,
            "diesel_rks": diesel_rks or sorted(DIESEL_RESOURCE_KEYS),
        }
    return defaults


def _load_month_defaults(year_month):
    defaults = _profit_defaults_by_shop(_load_profit_config())
    for (shop_key, cost_type), value in _load_cost_overrides(year_month).items():
        station = defaults.setdefault(shop_key, {
            "M": 0.0,
            "O": 0.0,
            "P": 0.0,
            "Q": 0.0,
            "n_rate": None,
            "rows_by_rk": {},
            "n_rks": [],
            "diesel_rks": sorted(DIESEL_RESOURCE_KEYS),
        })
        if cost_type == "N":
            station["n_rate"] = value
        elif cost_type in {"M", "O", "P", "Q"}:
            station[cost_type] = value
    return defaults


def _station_display_name(shop_key):
    info = SHOP_KEY_MAP.get(shop_key, {"name": f"SK-{shop_key}", "short": ""})
    short = str(info.get("short") or "").strip()
    name = str(info.get("name") or f"SK-{shop_key}").strip()
    return f"{short}\n{name}" if short else name


def _profit_row_from_defaults(shop_key, rk, station_defaults, purchase_overrides=None):
    source = station_defaults.get("rows_by_rk", {}).get(int(rk), {})
    override = (purchase_overrides or {}).get((int(shop_key), int(rk)), {})
    return {
        "rk": int(rk),
        "product": _resource_name_for_report(shop_key, int(rk)),
        "D": source.get("D"),
        "I": _num(override.get("I", source.get("I")), DEFAULT_PURCHASE_PRICES.get(int(rk), 0.0)),
        "H": override.get("H") or source.get("H") or PURCHASE_RESOURCE_NAMES.get(
            int(rk),
            _resource_name_for_report(shop_key, int(rk)),
        ),
    }


def _build_profit_station_layout(defaults, start_bal, end_bal, sales_data, ved_data, supply_data, purchase_overrides=None):
    stations = []
    for shop_key in sorted(SHOP_KEY_MAP.keys()):
        station_defaults = defaults.get(shop_key, {
            "M": 0.0,
            "O": 0.0,
            "P": 0.0,
            "Q": 0.0,
            "n_rate": None,
            "rows_by_rk": {},
            "n_rks": [],
            "diesel_rks": sorted(DIESEL_RESOURCE_KEYS),
        })
        fuel_keys = _get_station_fuel_keys(shop_key, start_bal, end_bal, sales_data, ved_data, supply_data)
        rows = [
            _profit_row_from_defaults(shop_key, rk, station_defaults, purchase_overrides)
            for rk in fuel_keys
        ]
        row_rks = {row["rk"] for row in rows}
        n_rks = [rk for rk in station_defaults.get("n_rks", []) if rk in row_rks]
        if not n_rks:
            n_rks = [rk for rk in row_rks if rk != 108]
        diesel_rks = [rk for rk in station_defaults.get("diesel_rks", []) if rk in row_rks]
        if not diesel_rks:
            diesel_rks = [rk for rk in row_rks if rk in DIESEL_RESOURCE_KEYS]

        stations.append({
            "shopKey": shop_key,
            "name": _station_display_name(shop_key),
            "rows": rows,
            "M": _num(station_defaults.get("M")),
            "O": _num(station_defaults.get("O")),
            "P": _num(station_defaults.get("P")),
            "Q": _num(station_defaults.get("Q")),
            "n_rate": station_defaults.get("n_rate"),
            "n_rks": n_rks,
            "diesel_rks": diesel_rks,
        })
    return stations


def _build_month_metric_maps(sales_data, contract_data, stations):
    c_map = {}
    e_map = {}
    mass_map = {}
    for station in stations:
        shop_key = int(station["shopKey"])
        for row in station["rows"]:
            rk = int(row["rk"])
            sd = sales_data.get(shop_key, {}).get(rk, {})
            ct = (contract_data or {}).get(shop_key, {}).get(rk, {})
            volume = _num(sd.get("cash_vol")) + _num(sd.get("card_vol")) + _num(ct.get("vol"))
            amount = _num(sd.get("cash_amt")) + _num(sd.get("card_amt")) + _num(ct.get("amt"))
            mass = _num(sd.get("cash_mass")) + _num(sd.get("card_mass")) + _num(ct.get("mass"))
            c_map[(shop_key, rk)] = _round(volume, 3)
            e_map[(shop_key, rk)] = _round(amount, 2)
            mass_map[(shop_key, rk)] = _round(mass, 3)
    return c_map, e_map, mass_map


def _build_profit_month_context(conn, year_month):
    year_month = normalize_profit_year_month(year_month)
    if not year_month:
        raise ValueError("invalid year_month, expected YYYY-MM")
    year, month = [int(part) for part in year_month.split("-")]
    ym_start, ym_end = get_query_date_range(year_month)
    station_keys = sorted(SHOP_KEY_MAP.keys())
    cur = conn.cursor()
    try:
        sales_data, ved_data, supply_data, contract_data, start_bal, end_bal, _loss_data = (
            _build_sheet_data(cur, ym_start, ym_end, station_keys)
        )
        operating_days = _load_station_operating_days(cur, ym_start, ym_end, station_keys)
        first_operating_days = _load_station_first_operating_days(cur, station_keys)
    finally:
        try:
            cur.close()
        except Exception:
            pass

    defaults = _load_month_defaults(year_month)
    purchase_overrides = _load_month_purchase_overrides(year_month)
    stations = _build_profit_station_layout(
        defaults,
        start_bal,
        end_bal,
        sales_data,
        ved_data,
        supply_data,
        purchase_overrides,
    )
    period_days = _period_day_count(ym_start, ym_end)
    stations = _apply_operating_cost_ratios(stations, operating_days, period_days, ym_start, first_operating_days)
    c_map, e_map, mass_map = _build_month_metric_maps(sales_data, contract_data, stations)
    summary = _calculate_profit_month_summary(stations, c_map, e_map, mass_map, ym_start, ym_end)
    return {
        "year": year,
        "month": month,
        "yearMonth": year_month,
        "queryStart": ym_start,
        "queryEnd": ym_end,
        "stations": stations,
        "cMap": c_map,
        "eMap": e_map,
        "massMap": mass_map,
        "operatingDays": operating_days,
        "firstOperatingDays": first_operating_days,
        "periodDays": period_days,
        "summary": summary,
    }


def _sum(values):
    return sum(_num(value) for value in values)


def _calculate_profit_month_summary(stations, c_map, e_map, mass_map, ym_start=None, ym_end=None):
    summary = {
        "volume": 0.0,
        "salesAmount": 0.0,
        "purchaseAmount": 0.0,
        "salary": 0.0,
        "freight": 0.0,
        "water": 0.0,
        "police": 0.0,
        "netFee": 0.0,
        "otherFees": 0.0,
        "dieselVolume": 0.0,
        "dieselTons": 0.0,
        "dieselSalesAmount": 0.0,
        "income": 0.0,
        "purchaseCost": 0.0,
        "vat": 0.0,
        "businessTax": 0.0,
        "grossProfit": 0.0,
        "netProfit": 0.0,
        "tons": 0.0,
        "avgCnyKgs": None,
        "netProfitCny": None,
        "hasActivity": False,
    }

    for station in stations:
        station_summary = _calculate_profit_station_summary(station, c_map, e_map, mass_map)
        for key in (
            "volume", "salesAmount", "purchaseAmount", "salary", "freight", "water",
            "police", "netFee", "otherFees", "dieselVolume", "dieselTons", "dieselSalesAmount", "income", "purchaseCost",
            "vat", "businessTax", "grossProfit", "netProfit", "tons",
        ):
            summary[key] += _num(station_summary.get(key))

    summary["hasActivity"] = summary["volume"] > 0 or summary["salesAmount"] > 0
    for key in (
        "volume", "tons", "salesAmount", "purchaseAmount", "salary", "freight", "water",
        "police", "netFee", "otherFees", "dieselVolume", "dieselTons", "dieselSalesAmount", "income", "purchaseCost",
        "vat", "businessTax", "grossProfit", "netProfit",
    ):
        summary[key] = _round(summary[key], 3 if key in {"volume", "tons", "dieselVolume", "dieselTons"} else 2)

    if ym_start and ym_end:
        avg_cny = average_cny_kgs_for_period(ym_start, ym_end)
        summary["avgCnyKgs"] = avg_cny
        summary["netProfitCny"] = cny_from_kgs_average(summary["netProfit"], avg_cny)
    return summary


def _calculate_profit_station_summary(station, c_map, e_map, mass_map):
    shop_key = int(station["shopKey"])
    row_rks = [int(row["rk"]) for row in station["rows"]]
    volume = _sum(c_map.get((shop_key, rk), 0.0) for rk in row_rks)
    sales_amount = _sum(e_map.get((shop_key, rk), 0.0) for rk in row_rks)
    purchase_amount = _sum(c_map.get((shop_key, int(row["rk"])), 0.0) * _num(row.get("I")) for row in station["rows"])
    diesel_volume = _sum(c_map.get((shop_key, rk), 0.0) for rk in station.get("diesel_rks", []))
    diesel_tons = _sum(mass_map.get((shop_key, rk), 0.0) for rk in station.get("diesel_rks", [])) / 1000
    diesel_amount = _sum(e_map.get((shop_key, rk), 0.0) for rk in station.get("diesel_rks", []))
    n_volume = _sum(c_map.get((shop_key, rk), 0.0) for rk in station.get("n_rks", []))
    n_rate = station.get("n_rate")
    freight = n_volume if n_rate is None else n_volume * _num(n_rate)
    salary = _num(station.get("M"))
    water = _num(station.get("O"))
    police = _num(station.get("P"))
    net_fee = _num(station.get("Q"))
    other_fees = water + police + net_fee
    income = (sales_amount - diesel_amount) / 1.12 + diesel_amount / 1.13
    purchase_cost = purchase_amount / 1.12 + freight / 1.04
    vat = (income - purchase_cost) * 0.12 + freight / 1.04 * 0.04
    business_tax = diesel_amount * 0.01
    gross_profit = income - purchase_cost
    net_profit = gross_profit - salary - other_fees
    tons = _sum(mass_map.get((shop_key, rk), 0.0) for rk in row_rks) / 1000
    return {
        "shopKey": shop_key,
        "name": station.get("name"),
        "volume": _round(volume, 3),
        "salesAmount": _round(sales_amount, 2),
        "purchaseAmount": _round(purchase_amount, 2),
        "salary": _round(salary, 2),
        "salaryBase": _round(station.get("MBase"), 2),
        "freight": _round(freight, 2),
        "water": _round(water, 2),
        "waterBase": _round(station.get("OBase"), 2),
        "police": _round(police, 2),
        "policeBase": _round(station.get("PBase"), 2),
        "netFee": _round(net_fee, 2),
        "netFeeBase": _round(station.get("QBase"), 2),
        "otherFees": _round(other_fees, 2),
        "dieselVolume": _round(diesel_volume, 3),
        "dieselTons": _round(diesel_tons, 3),
        "dieselSalesAmount": _round(diesel_amount, 2),
        "income": _round(income, 2),
        "purchaseCost": _round(purchase_cost, 2),
        "vat": _round(vat, 2),
        "businessTax": _round(business_tax, 2),
        "grossProfit": _round(gross_profit, 2),
        "netProfit": _round(net_profit, 2),
        "tons": _round(tons, 3),
        "operatingDays": int(station.get("operatingDays") or 0),
        "periodDays": int(station.get("periodDays") or 0),
        "operatingRatio": _round(station.get("operatingRatio"), 4),
        "firstOperatingDay": station.get("firstOperatingDay"),
        "costProrationReason": station.get("costProrationReason"),
    }


def _profit_product_payload(station, row, c_map, e_map, mass_map):
    shop_key = int(station["shopKey"])
    rk = int(row["rk"])
    volume = _num(c_map.get((shop_key, rk), 0.0))
    sales_amount = _num(e_map.get((shop_key, rk), 0.0))
    sales_price = row.get("D")
    if sales_price is None and volume:
        sales_price = sales_amount / volume
    purchase_price = _num(row.get("I"))
    return {
        "shopKey": shop_key,
        "resourceKey": rk,
        "product": row.get("product"),
        "volume": _round(volume, 3),
        "tons": _round(_num(mass_map.get((shop_key, rk), 0.0)) / 1000, 3),
        "salesPrice": None if sales_price is None else _round(sales_price, 2),
        "salesAmount": _round(sales_amount, 2),
        "purchaseProduct": row.get("H"),
        "purchasePrice": _round(purchase_price, 2),
        "purchaseAmount": _round(volume * purchase_price, 2),
    }


def _profit_month_payload(context):
    c_map = context["cMap"]
    e_map = context["eMap"]
    mass_map = context["massMap"]
    stations = []
    for station in context["stations"]:
        station_summary = _calculate_profit_station_summary(station, c_map, e_map, mass_map)
        station_summary["rows"] = [
            _profit_product_payload(station, row, c_map, e_map, mass_map)
            for row in station.get("rows") or []
        ]
        stations.append(station_summary)
    return {
        "year": context["year"],
        "month": context["month"],
        "yearMonth": context["yearMonth"],
        "queryStart": context["queryStart"],
        "queryEnd": context["queryEnd"],
        "periodDays": context.get("periodDays"),
        "summary": context["summary"],
        "stations": stations,
    }


def _fresh_profit_month_data(conn, year_month):
    return _profit_month_payload(_build_profit_month_context(conn, year_month))


def get_profit_month_data(conn, year_month, force_refresh=False):
    year_month = normalize_profit_year_month(year_month)
    if not year_month:
        raise ValueError("invalid year_month, expected YYYY-MM")
    if not force_refresh:
        cached = _load_profit_snapshot("month", year_month)
        if cached:
            payload, generated_at = cached
            if _profit_snapshot_has_current_fields("month", payload):
                return _with_snapshot_meta(_with_profit_comparison("month", year_month, payload), generated_at, cached=True)

    payload = _fresh_profit_month_data(conn, year_month)
    generated_at = _save_profit_snapshot("month", year_month, payload)
    return _with_snapshot_meta(_with_profit_comparison("month", year_month, payload), generated_at, cached=False)


def _fresh_profit_year_data(conn, year, force_refresh=False):
    year_text = normalize_profit_year(year)
    if not year_text:
        raise ValueError("invalid year, expected YYYY")
    year = int(year_text)
    include_through_month = _last_completed_month_for_year(year)
    months = []
    totals = {
        "volume": 0.0,
        "salesAmount": 0.0,
        "purchaseAmount": 0.0,
        "salary": 0.0,
        "freight": 0.0,
        "otherFees": 0.0,
        "dieselVolume": 0.0,
        "dieselTons": 0.0,
        "income": 0.0,
        "purchaseCost": 0.0,
        "vat": 0.0,
        "businessTax": 0.0,
        "grossProfit": 0.0,
        "netProfit": 0.0,
        "tons": 0.0,
        "dieselSalesAmount": 0.0,
        "netProfitCny": 0.0,
    }
    for month in range(1, 13):
        active = month <= include_through_month
        if active:
            month_payload = get_profit_month_data(conn, f"{year:04d}-{month:02d}", force_refresh=force_refresh)
            summary = dict(month_payload["summary"])
            summary["hasActivity"] = bool(summary.get("hasActivity"))
        else:
            summary = {"hasActivity": False}
        item = {
            "month": month,
            "monthName": MONTH_NAMES_CN.get(month, f"{month}月份"),
            "active": active and bool(summary.get("hasActivity")),
            **summary,
        }
        months.append(item)
        if item["active"]:
            for key in totals:
                totals[key] += _num(summary.get(key))

    for key in totals:
        totals[key] = _round(totals[key], 3 if key in {"volume", "tons", "dieselVolume", "dieselTons"} else 2)
    return {
        "year": year,
        "includedMonths": include_through_month,
        "months": months,
        "summary": totals,
    }


def get_profit_year_data(conn, year, force_refresh=False):
    year_text = normalize_profit_year(year)
    if not year_text:
        raise ValueError("invalid year, expected YYYY")
    year = int(year_text)
    if not force_refresh:
        cached = _load_profit_snapshot("year", year)
        if cached:
            payload, generated_at = cached
            if _profit_snapshot_has_current_fields("year", payload):
                return _with_snapshot_meta(_with_profit_comparison("year", year, payload), generated_at, cached=True)

    payload = _fresh_profit_year_data(conn, year, force_refresh=force_refresh)
    generated_at = _save_profit_snapshot("year", year, payload)
    return _with_snapshot_meta(_with_profit_comparison("year", year, payload), generated_at, cached=False)


def _excel_sum(cells):
    cells = list(cells)
    if not cells:
        return "0"
    return "+".join(cells)


def _hide_profit_station_rows(ws, shop_key, start_row, end_row):
    if int(shop_key) not in REPORT_HIDDEN_STATION_KEYS:
        return
    for row_idx in range(int(start_row), int(end_row) + 1):
        ws.row_dimensions[row_idx].hidden = True


def _append_profit_hidden_station_note(ws, after_row):
    note_row = int(after_row) + 1
    ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=len(HEADERS))
    _apply_style(ws, note_row, 1, REPORT_HIDDEN_STATION_NOTE, size=10, h_align="left", wrap=True)
    ws.row_dimensions[note_row].height = 24
    return note_row


def _write_profit_sheet(ws, context):
    month = int(context["month"])
    stations = context["stations"]
    c_map = context["cMap"]
    e_map = context["eMap"]

    ws.title = f"{month}月"
    ws.freeze_panes = "C2"

    for letter, width in COL_WIDTHS.items():
        ws.column_dimensions[letter].width = width

    for col_idx, text in enumerate(HEADERS, start=1):
        _apply_style(ws, 1, col_idx, text, bold=True, size=11, h_align="center", v_align="center", wrap=True)
    ws.row_dimensions[1].height = 45

    current_row = 2
    for station in stations:
        shop_key = int(station["shopKey"])
        row_defs = station["rows"]
        start = current_row
        end = current_row + len(row_defs) - 1
        rows = list(range(start, end + 1))
        rk_to_row = {int(row_def["rk"]): start + index for index, row_def in enumerate(row_defs)}

        for index, row_def in enumerate(row_defs):
            row_idx = start + index
            rk = int(row_def["rk"])
            _apply_style(ws, row_idx, 1, station["name"], num_fmt=NUM_FMT, wrap=True)
            _apply_style(ws, row_idx, 2, row_def["product"])
            _apply_style(ws, row_idx, 3, c_map.get((shop_key, rk), 0.0), num_fmt=NUM_FMT)
            _apply_style(
                ws,
                row_idx,
                4,
                row_def["D"] if row_def["D"] is not None else f'=IFERROR(E{row_idx}/C{row_idx},"")',
                num_fmt=NUM_FMT,
            )
            _apply_style(ws, row_idx, 5, e_map.get((shop_key, rk), 0.0), num_fmt=NUM_FMT)
            _apply_style(ws, row_idx, 8, row_def["H"])
            _apply_style(ws, row_idx, 9, row_def["I"], num_fmt=NUM_FMT)
            _apply_style(ws, row_idx, 10, f"=C{row_idx}", num_fmt=NUM_FMT)
            _apply_style(ws, row_idx, 11, f"=J{row_idx}*I{row_idx}", num_fmt=NUM_FMT)

        f_sum = _excel_sum(f"E{row_idx}" for row_idx in rows)
        l_sum = _excel_sum(f"K{row_idx}" for row_idx in rows)
        n_rows = [rk_to_row[rk] for rk in station.get("n_rks", []) if rk in rk_to_row]
        n_sum = _excel_sum(f"J{row_idx}" for row_idx in n_rows)
        diesel_rows = [rk_to_row[rk] for rk in station.get("diesel_rks", []) if rk in rk_to_row]
        diesel_sum = _excel_sum(f"E{row_idx}" for row_idx in diesel_rows)
        sales_rows_sum = _excel_sum(f"E{row_idx}" for row_idx in rows)
        if len(diesel_rows) > 1:
            diesel_expr = f"({diesel_sum})"
        else:
            diesel_expr = diesel_sum
        n_rate = station.get("n_rate")
        n_formula = f"={n_sum}" if n_rate is None else f"=({n_sum})*{_formula_number(n_rate)}"

        g_formula = f"=L{start}+M{start}+N{start}+O{start}+P{start}+Q{start}"
        r_formula = f"=({sales_rows_sum}-{diesel_expr})/1.12+{diesel_expr}/1.13"
        s_formula = f"=(R{start}-(L{start}/1.12+N{start}/1.04))*0.12+N{start}/1.04*0.04"
        t_formula = f"={diesel_expr}*0.01"
        u_formula = f"=R{start}-(L{start}/1.12+N{start}/1.04)"
        v_formula = f"=U{start}-M{start}-O{start}-P{start}-Q{start}"

        _apply_style(ws, start, 6, f"={f_sum}", num_fmt=NUM_FMT)
        _apply_style(ws, start, 7, g_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 12, f"={l_sum}", num_fmt=NUM_FMT)
        _apply_style(ws, start, 13, station["M"], num_fmt=NUM_FMT)
        _apply_style(ws, start, 14, n_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 15, station["O"], num_fmt=NUM_FMT)
        _apply_style(ws, start, 16, station["P"], num_fmt=NUM_FMT)
        _apply_style(ws, start, 17, station["Q"], num_fmt=NUM_FMT)
        _apply_style(ws, start, 18, r_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 19, s_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 20, t_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 21, u_formula, num_fmt=NUM_FMT)
        _apply_style(ws, start, 22, v_formula, num_fmt=NUM_FMT)

        for col_letter in MERGE_COLS:
            if end > start:
                ws.merge_cells(f"{col_letter}{start}:{col_letter}{end}")
        _hide_profit_station_rows(ws, shop_key, start, end)
        current_row = end + 1

    total_row = current_row
    _apply_style(ws, total_row, 1, "合计", num_fmt=NUM_FMT)
    for col_idx in range(3, 23):
        letter = get_column_letter(col_idx)
        _apply_style(ws, total_row, col_idx, f"=SUM({letter}2:{letter}{total_row - 1})", num_fmt=NUM_FMT)
    ws.row_dimensions[total_row].height = 45

    net_row = total_row + 1
    _apply_style(ws, net_row, 21, "净利润", num_fmt=NUM_FMT)
    _apply_style(ws, net_row, 22, f"=V{total_row}", num_fmt=NUM_FMT)
    ws.row_dimensions[net_row].height = 36
    _center_used_cells(ws, net_row, len(HEADERS))
    _auto_fit_columns(ws, COL_WIDTHS, min_row=1, max_row=net_row, max_width=34.0)
    _append_profit_hidden_station_note(ws, net_row)

    return total_row


def _last_completed_month_for_year(year):
    today = datetime.now().date()
    year = int(year)
    if year < today.year:
        return 12
    if year > today.year:
        return 0
    return max(today.month - 1, 0)


def _write_profit_year_sheet(ws, year, month_summaries, include_through_month=None):
    year = int(year)
    include_through_month = _last_completed_month_for_year(year) if include_through_month is None else int(include_through_month)
    ws.title = "年度汇总"
    ws.freeze_panes = "C3"

    for letter, width in YEAR_COL_WIDTHS.items():
        ws.column_dimensions[letter].width = width

    _apply_style(ws, 1, 1, "加油站年销量利润核算", bold=True, size=14, h_align="center")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(YEAR_HEADERS))
    ws.row_dimensions[1].height = 28
    for col_idx, text in enumerate(YEAR_HEADERS, start=1):
        _apply_style(ws, 2, col_idx, text, bold=True, size=10, wrap=True)
    ws.row_dimensions[2].height = 35

    for month in range(1, 13):
        row_idx = month + 2
        summary = month_summaries.get(month) or {}
        active = month <= include_through_month and bool(summary.get("hasActivity"))

        _apply_style(ws, row_idx, 1, "=ROW()-2", num_fmt="0")
        _apply_style(ws, row_idx, 2, MONTH_NAMES_CN.get(month, f"{month}月份"))
        base_values = {
            3: _round(summary.get("volume"), 3),
            4: _round(summary.get("salesAmount"), 2),
            5: _round(summary.get("purchaseAmount"), 2),
            6: _round(summary.get("salary"), 2),
            7: _round(summary.get("freight"), 2),
            8: _round(summary.get("otherFees"), 2),
            15: _round(summary.get("tons"), 3),
            16: summary.get("avgCnyKgs"),
            YEAR_DIESEL_AMOUNT_COL: _round(summary.get("dieselSalesAmount"), 2),
        }
        for col_idx, value in base_values.items():
            if active:
                fmt = TON_FMT if col_idx in {3, 15} else NUM_FMT
                if col_idx == 16:
                    fmt = "0.0000"
                _apply_style(ws, row_idx, col_idx, value, num_fmt=fmt)
            else:
                _apply_style(ws, row_idx, col_idx, None, num_fmt=NUM_FMT)

        if active:
            formulas = {
                9: f"=($D{row_idx}-$R{row_idx})/1.12+$R{row_idx}/1.13",
                10: f"=$E{row_idx}/1.12+$G{row_idx}/1.04",
                11: f"=($I{row_idx}-$J{row_idx})*0.12+$G{row_idx}/1.04*0.04",
                12: f"=$R{row_idx}*0.01",
                13: f"=I{row_idx}-J{row_idx}",
                14: f"=M{row_idx}-F{row_idx}-H{row_idx}",
                17: f'=IFERROR(N{row_idx}/P{row_idx},"")',
            }
        else:
            formulas = {
                9: f'=IF($D{row_idx}="","",($D{row_idx}-$R{row_idx})/1.12+$R{row_idx}/1.13)',
                10: f'=IF($D{row_idx}="","",$E{row_idx}/1.12+$G{row_idx}/1.04)',
                11: f'=IF($D{row_idx}="","",($I{row_idx}-$J{row_idx})*0.12+$G{row_idx}/1.04*0.04)',
                12: f'=IF($D{row_idx}="","",$R{row_idx}*0.01)',
                13: f'=IF($D{row_idx}="","",I{row_idx}-J{row_idx})',
                14: f'=IF($D{row_idx}="","",M{row_idx}-F{row_idx}-H{row_idx})',
                17: f'=IF($D{row_idx}="","",IFERROR(N{row_idx}/P{row_idx},""))',
            }
        for col_idx, formula in formulas.items():
            _apply_style(ws, row_idx, col_idx, formula, num_fmt=NUM_FMT)

    total_row = 15
    _apply_style(ws, total_row, 1, "合计", bold=True, num_fmt=NUM_FMT)
    ws.merge_cells("A15:B15")
    for col_idx in range(3, len(YEAR_HEADERS) + 1):
        letter = get_column_letter(col_idx)
        if col_idx == 16:
            _apply_style(ws, total_row, col_idx, None, bold=True)
        else:
            _apply_style(ws, total_row, col_idx, f"=SUM({letter}3:{letter}14)", bold=True, num_fmt=TON_FMT if col_idx == 15 else NUM_FMT)

    note_start = 19
    for offset, text in enumerate(YEAR_NOTES):
        row_idx = note_start + offset
        _apply_style(ws, row_idx, 1, "备注：" if offset == 0 else "", h_align="left")
        _apply_style(ws, row_idx, 2, text, h_align="left")
        ws.merge_cells(start_row=row_idx, start_column=2, end_row=row_idx, end_column=len(YEAR_HEADERS))

    _center_used_cells(ws, total_row, len(YEAR_HEADERS))
    _auto_fit_columns(ws, YEAR_COL_WIDTHS, min_row=2, max_row=total_row, max_width=24.0)

    return ws


def _build_profit_month_workbook(conn, year_month):
    context = _build_profit_month_context(conn, year_month)
    wb = openpyxl.Workbook()
    wb._fonts[0] = Font(name='Times New Roman', size=11)
    total_row = _write_profit_sheet(wb.active, context)
    context["totalRow"] = total_row
    return wb, context


def generate_profit_excel(conn, year_month, force_refresh=False):
    year_month = normalize_profit_year_month(year_month)
    if not year_month:
        raise ValueError("invalid year_month, expected YYYY-MM")
    wb, context = _build_profit_month_workbook(conn, year_month)
    filename, filepath = profit_month_workbook_path(year_month)
    wb.save(filepath)
    return {
        "status": "ok",
        "file": filename,
        "path": filepath,
        "cached": False,
        "totalRow": context.get("totalRow"),
    }


def generate_profit_year_excel(conn, year, force_refresh=False):
    year_text = normalize_profit_year(year)
    if not year_text:
        raise ValueError("invalid year, expected YYYY")
    year = int(year_text)
    include_through_month = _last_completed_month_for_year(year)
    month_summaries = {}
    generated_months = []
    for month in range(1, include_through_month + 1):
        year_month = f"{year:04d}-{month:02d}"
        wb_month, context = _build_profit_month_workbook(conn, year_month)
        month_filename, month_filepath = profit_month_workbook_path(year_month)
        wb_month.save(month_filepath)
        month_summaries[month] = context["summary"]
        generated_months.append(month_filename)

    wb = openpyxl.Workbook()
    wb._fonts[0] = Font(name='Times New Roman', size=11)
    _write_profit_year_sheet(wb.active, year, month_summaries, include_through_month=include_through_month)

    filename, filepath = profit_year_workbook_path(year)
    wb.save(filepath)
    return {
        "status": "ok",
        "file": filename,
        "path": filepath,
        "cached": False,
        "includedMonths": include_through_month,
        "generatedMonths": generated_months,
    }
