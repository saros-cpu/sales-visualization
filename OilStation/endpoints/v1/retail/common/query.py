from datetime import datetime

from business_time import (
    business_date_expr,
    business_period_condition_with_pruning,
    business_period_params,
    shift_join,
)
from constants import SHOP_KEY_MAP
from export_excel import _build_sheet_data


def calc_yoy_mom(y, m):
    if m == 1:
        prev_m, prev_y = 12, y - 1
    else:
        prev_m, prev_y = m - 1, y
    yoy_m, yoy_y = m, y - 1
    return {
        "prev": f"{prev_y}-{prev_m:02d}",
        "yoy": f"{yoy_y}-{yoy_m:02d}",
    }


def get_query_date_range(year_month, exclude_today=True):
    y, m = int(year_month.split("-")[0]), int(year_month.split("-")[1])
    start = f"{y}-{m:02d}-01"
    if m == 12:
        end = f"{y+1}-01-01"
    else:
        end = f"{y}-{m+1:02d}-01"
    if exclude_today:
        today_str = datetime.now().strftime("%Y-%m-%d")
        if start <= today_str < end:
            end = today_str
    return start, end


def query_month_summary(cur, ym, exclude_today=True):
    start, end = get_query_date_range(ym, exclude_today)
    period_condition = business_period_condition_with_pruning("s", "sh")
    cur.execute(
        f"""
        SELECT
            COUNT(*) as total_txn,
            COUNT(DISTINCT s.ShopKey) as total_shops,
            SUM(CASE
                WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4))
                 AND s.BasePaymentTypeKey IN (1, 2)
                THEN s.Volume ELSE 0 END)
            + SUM(CASE WHEN s.DerivedPaymentTypeKey = 3 THEN s.Volume ELSE 0 END) as total_liters,
            SUM(CASE
                WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4))
                 AND s.BasePaymentTypeKey IN (1, 2)
                THEN s.ShopCost ELSE 0 END)
            + SUM(CASE WHEN s.DerivedPaymentTypeKey = 3 THEN s.ShopCost ELSE 0 END) as total_sales,
            SUM(CASE WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4)) AND s.BasePaymentTypeKey = 1 AND COALESCE(s.DerivedPaymentTypeKey, 0) <> 5 THEN s.ShopCost ELSE 0 END) as cash_sales,
            SUM(CASE WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4)) AND (s.BasePaymentTypeKey = 2 OR s.DerivedPaymentTypeKey = 5) THEN s.ShopCost ELSE 0 END) as card_sales,
            SUM(CASE WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4)) AND s.BasePaymentTypeKey = 1 AND COALESCE(s.DerivedPaymentTypeKey, 0) <> 5 THEN s.Volume ELSE 0 END) as cash_liters,
            SUM(CASE WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4)) AND (s.BasePaymentTypeKey = 2 OR s.DerivedPaymentTypeKey = 5) THEN s.Volume ELSE 0 END) as card_liters,
            COUNT(DISTINCT CASE WHEN s.ShopCost > 0 THEN s.ShopKey END) as active_shops
        FROM selling s
        {shift_join("s", "sh")}
        WHERE {period_condition}
          AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
    """,
        business_period_params(start, end),
    )
    row = cur.fetchone()
    return {
        "totalTxn": int(row[0] or 0),
        "totalShops": int(row[1] or 0),
        "totalLiters": round(float(row[2] or 0), 2),
        "totalSales": round(float(row[3] or 0), 2),
        "cashSales": round(float(row[4] or 0), 2),
        "cardSales": round(float(row[5] or 0), 2),
        "cashLiters": round(float(row[6] or 0), 2),
        "cardLiters": round(float(row[7] or 0), 2),
        "activeShops": int(row[8] or 0),
        "queryStart": start,
        "queryEnd": end,
    }


def get_latest_month_in_year(cur, year):
    business_date = business_date_expr("s", "sh")
    cur.execute(
        f"""
        SELECT DATE_FORMAT(MAX({business_date}), '%%Y-%%m')
        FROM selling s
        {shift_join("s", "sh")}
        WHERE YEAR({business_date}) = %s
        """,
        (year,),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] else None


def get_report_month_inventory(cur, year_month, station_keys=None):
    if not year_month:
        return 0.0
    if station_keys is None:
        station_keys = sorted(SHOP_KEY_MAP.keys())
    _, _, _, _, _, end_bal, _ = _build_sheet_data(cur, *get_query_date_range(year_month), station_keys)
    return round(sum(end_bal.values()), 3)
