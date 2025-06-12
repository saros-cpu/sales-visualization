# -*- coding: utf-8 -*-
"""
СНК-АЗС 数据 API 后端
从本地 ocw 数据库读取销售数据，提供给前端大屏调用

启动方式: python api.py
访问地址: http://localhost:8900
"""

from flask import Flask
from flask_cors import CORS
import threading
from datetime import datetime
from business_time import (
    business_date_expr,
    business_period_condition_with_pruning,
    business_period_params,
    selling_business_day_subquery,
    shift_join,
)
from cache_store import get_cached, set_cached
from config import SERVER_HOST, SERVER_PORT
from constants import SHOP_KEY_MAP
from db import get_connection
from export_excel import _build_sheet_data
from routes.analytics import (
    register_analytics_routes,
)
from routes.analysis_report import register_analysis_report_routes
from routes.basic import register_basic_routes
from routes.export import register_export_routes
from routes.kpi import register_kpi_routes

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)
register_basic_routes(app)

# —— 主页路由：直接返回 dashboard.html ——
@app.route('/')
def index():
    # Flask 会在 static_folder 中查找文件，这里返回项目根目录下的 dashboard.html
    return app.send_static_file('dashboard.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

# 兼容二级页面（如 monthly.html、region.html、station.html 等）
@app.route('/<path:filename>')
def static_page(filename):
    # 只处理 html、js、css、json、js、png、jpg 等静态文件
    return app.send_static_file(filename)


# ===== 数据库配置 =====
# ===== ShopKey → 前端站点名称映射 =====
# ===== 缓存层 =====

# 静态数据快照配置（可选，进一步优化）
SNAPSHOT_DIR = 'data_snapshots'
SNAPSHOT_ENABLED = True  # 启用静态快照模式


def calc_yoy_mom(y, m):
    """计算同比月份和环比月份"""
    # 环比 = 上个月
    if m == 1:
        prev_m, prev_y = 12, y - 1
    else:
        prev_m, prev_y = m - 1, y
    # 同比 = 去年同月
    yoy_m, yoy_y = m, y - 1
    return {
        'prev': f'{prev_y}-{prev_m:02d}',
        'yoy': f'{yoy_y}-{yoy_m:02d}',
    }


def get_query_date_range(year_month, exclude_today=True):
    """计算查询日期范围。exclude_today=True 时排除当天数据（班组可能未结束）。
    例如 year_month='2026-04', exclude_today=True, 今天=2026-04-26
    → 返回 '2026-04-01' ~ '2026-04-26' (不包含4/26)
    如果当月只有1号且今天是1号，则不排除今天。
    """
    y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
    start = f'{y}-{m:02d}-01'
    if m == 12:
        end = f'{y+1}-01-01'
    else:
        end = f'{y}-{m+1:02d}-01'
    if exclude_today:
        today_str = datetime.now().strftime('%Y-%m-%d')
        # 如果今天是当月内的某一天，截止到今天（不含今天）
        if start <= today_str < end:
            end = today_str
    return start, end


def query_month_summary(cur, ym, exclude_today=True):
    pass
    """查询某月汇总数据（含活跃站点数，合并为一次查询）"""
    start, end = get_query_date_range(ym, exclude_today)
    period_condition = business_period_condition_with_pruning("s", "sh")
    cur.execute(f"""
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
    """, business_period_params(start, end))
    row = cur.fetchone()
    return {
        'totalTxn': int(row[0] or 0),
        'totalShops': int(row[1] or 0),
        'totalLiters': round(float(row[2] or 0), 2),
        'totalSales': round(float(row[3] or 0), 2),
        'cashSales': round(float(row[4] or 0), 2),
        'cardSales': round(float(row[5] or 0), 2),
        'cashLiters': round(float(row[6] or 0), 2),
        'cardLiters': round(float(row[7] or 0), 2),
        'activeShops': int(row[8] or 0),
        'queryStart': start,
        'queryEnd': end,
    }


def get_latest_month_in_year(cur, year):
    """返回指定年份最新一个有销售数据的月份（YYYY-MM）。"""
    business_date = business_date_expr("s", "sh")
    cur.execute(
        f"""
        SELECT DATE_FORMAT(MAX({business_date}), '%%Y-%%m')
        FROM selling s
        {shift_join("s", "sh")}
        WHERE YEAR({business_date}) = %s
        """,
        (year,)
    )
    row = cur.fetchone()
    return row[0] if row and row[0] else None


def get_report_month_inventory(cur, year_month, station_keys=None):
    """按 Excel 月报同口径计算期末库存总升数。"""
    if not year_month:
        return 0.0
    if station_keys is None:
        station_keys = sorted(SHOP_KEY_MAP.keys())
    _, _, _, _, _, end_bal, _ = _build_sheet_data(cur, *get_query_date_range(year_month), station_keys)
    return round(sum(end_bal.values()), 3)


register_kpi_routes(
    app,
    query_month_summary=query_month_summary,
    get_query_date_range=get_query_date_range,
    get_report_month_inventory=get_report_month_inventory,
    get_latest_month_in_year=get_latest_month_in_year,
)
register_analytics_routes(
    app,
    calc_yoy_mom=calc_yoy_mom,
    get_query_date_range=get_query_date_range,
    query_month_summary=query_month_summary,
)
register_export_routes(app, get_query_date_range=get_query_date_range)
register_analysis_report_routes(
    app,
    get_query_date_range=get_query_date_range,
    query_month_summary=query_month_summary,
)






# ===== 缓存预热 =====
def _warm_cache_background():
    """后台线程：启动后预热最近2个月的月度数据缓存"""
    import time as _time
    _time.sleep(3)  # 等待 Flask 完全启动
    now = datetime.now()
    months_to_warm = []
    # 当月和上月
    for delta in [0, 1]:
        y = now.year
        m = now.month - delta
        if m <= 0:
            m += 12
            y -= 1
        months_to_warm.append(f'{y}-{m:02d}')

    for ym in months_to_warm:
        cache_key = f'monthly:{ym}'
        if get_cached(cache_key):
            print(f'[warmup] {ym} already cached, skip')
            continue
        try:
            print(f'[warmup] pre-loading monthly data for {ym} ...')
            t0 = _time.time()
            conn = get_connection()
            try:
                cur = conn.cursor()
                y_int, m_int = int(ym.split('-')[0]), int(ym.split('-')[1])
                ym_start, ym_end = get_query_date_range(ym)
                selling_by_business_day = selling_business_day_subquery("selling")

                summary = query_month_summary(cur, ym)
                dates = calc_yoy_mom(y_int, m_int)
                prev_summary = query_month_summary(cur, dates['prev'])
                yoy_summary = query_month_summary(cur, dates['yoy'])

                def calc_change(current, previous):
                    if not previous or previous <= 0:
                        return None
                    return round((current - previous) / previous * 100, 1)

                comparison = {
                    'mom': {
                        'sales': calc_change(summary['totalSales'], prev_summary['totalSales']),
                        'volume': calc_change(summary['totalLiters'], prev_summary['totalLiters']),
                        'cashSales': calc_change(summary['cashSales'], prev_summary['cashSales']),
                        'cardSales': calc_change(summary['cardSales'], prev_summary['cardSales']),
                        'activeShops': (summary['activeShops'] - prev_summary.get('activeShops', summary['activeShops'])) if prev_summary.get('activeShops') else None,
                        'prevMonth': dates['prev'],
                    },
                    'yoy': {
                        'sales': calc_change(summary['totalSales'], yoy_summary['totalSales']),
                        'volume': calc_change(summary['totalLiters'], yoy_summary['totalLiters']),
                        'cashSales': calc_change(summary['cashSales'], yoy_summary['cashSales']),
                        'cardSales': calc_change(summary['cardSales'], yoy_summary['cardSales']),
                        'activeShops': (summary['activeShops'] - yoy_summary.get('activeShops', summary['activeShops'])) if yoy_summary.get('activeShops') else None,
                        'yoyMonth': dates['yoy'],
                    },
                    'prev': {'summary': prev_summary},
                    'yoyRef': {'summary': yoy_summary},
                }

                # 按站点汇总
                cur.execute(f"""
                    SELECT ShopKey, COUNT(*), SUM(Volume), SUM(ShopCost), SUM(ShopBaseCost),
                           SUM(CASE WHEN BasePaymentTypeKey=1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN ShopCost ELSE 0 END),
                           SUM(CASE WHEN BasePaymentTypeKey=2 OR DerivedPaymentTypeKey=5 THEN ShopCost ELSE 0 END),
                           SUM(CASE WHEN BasePaymentTypeKey=1 AND COALESCE(DerivedPaymentTypeKey, 0) <> 5 THEN Volume ELSE 0 END),
                           SUM(CASE WHEN BasePaymentTypeKey=2 OR DerivedPaymentTypeKey=5 THEN Volume ELSE 0 END)
                    FROM {selling_by_business_day}
                    WHERE business_day >= %s AND business_day < %s
                      AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 4))
                    GROUP BY ShopKey ORDER BY SUM(ShopCost) DESC
                """, (ym_start, ym_end))
                station_rows = cur.fetchall()
                stations_data = []
                for r in station_rows:
                    sk = r[0]
                    info = SHOP_KEY_MAP.get(sk, {'name': f'Station-{sk}', 'short': '', 'region': 'unknown'})
                    stations_data.append({
                        'shopKey': sk, 'name': info['name'], 'short': info['short'],
                        'region': info['region'],
                        'txnCount': int(r[1] or 0),
                        'volume': round(float(r[2] or 0), 2),
                        'amount': round(float(r[3] or 0), 2),
                        'baseCost': round(float(r[4] or 0), 2),
                        'cashSales': round(float(r[5] or 0), 2),
                        'cardSales': round(float(r[6] or 0), 2),
                        'cashLiters': round(float(r[7] or 0), 2),
                        'cardLiters': round(float(r[8] or 0), 2),
                    })

                prev_start, prev_end = get_query_date_range(dates['prev'])
                cur.execute(f"""
                    SELECT ShopKey, SUM(Volume), SUM(ShopCost)
                    FROM {selling_by_business_day}
                    WHERE business_day >= %s AND business_day < %s
                      AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 4))
                    GROUP BY ShopKey
                """, (prev_start, prev_end))
                prev_shop_data = {r[0]: {'vol': float(r[1] or 0), 'amt': float(r[2] or 0)} for r in cur.fetchall()}

                yoy_start, yoy_end = get_query_date_range(dates['yoy'])
                cur.execute(f"""
                    SELECT ShopKey, SUM(Volume), SUM(ShopCost)
                    FROM {selling_by_business_day}
                    WHERE business_day >= %s AND business_day < %s
                      AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 4))
                    GROUP BY ShopKey
                """, (yoy_start, yoy_end))
                yoy_shop_data = {r[0]: {'vol': float(r[1] or 0), 'amt': float(r[2] or 0)} for r in cur.fetchall()}

                for st in stations_data:
                    sk = st['shopKey']
                    st['momVolume'] = calc_change(st['volume'], prev_shop_data.get(sk, {}).get('vol', 0))
                    st['momSales'] = calc_change(st['amount'], prev_shop_data.get(sk, {}).get('amt', 0))
                    st['yoyVolume'] = calc_change(st['volume'], yoy_shop_data.get(sk, {}).get('vol', 0))
                    st['yoySales'] = calc_change(st['amount'], yoy_shop_data.get(sk, {}).get('amt', 0))

                regions = {}
                for s in stations_data:
                    rgn = s['region']
                    if rgn not in regions:
                        regions[rgn] = {'amount': 0, 'volume': 0, 'cashSales': 0, 'cardSales': 0, 'stationCount': 0, 'activeCount': 0}
                    regions[rgn]['amount'] += s['amount']
                    regions[rgn]['volume'] += s['volume']
                    regions[rgn]['cashSales'] += s['cashSales']
                    regions[rgn]['cardSales'] += s['cardSales']
                    regions[rgn]['stationCount'] += 1
                    if s['amount'] > 0:
                        regions[rgn]['activeCount'] += 1
                for rgn_name, rgn_data in regions.items():
                    rgn_sks = [sk for sk, info in SHOP_KEY_MAP.items() if info['region'] == rgn_name]
                    regions[rgn_name]['momVolume'] = calc_change(rgn_data['volume'], sum(prev_shop_data.get(sk, {}).get('vol', 0) for sk in rgn_sks))
                    regions[rgn_name]['momSales'] = calc_change(rgn_data['amount'], sum(prev_shop_data.get(sk, {}).get('amt', 0) for sk in rgn_sks))
                    regions[rgn_name]['yoyVolume'] = calc_change(rgn_data['volume'], sum(yoy_shop_data.get(sk, {}).get('vol', 0) for sk in rgn_sks))
                    regions[rgn_name]['yoySales'] = calc_change(rgn_data['amount'], sum(yoy_shop_data.get(sk, {}).get('amt', 0) for sk in rgn_sks))

                RESOURCE_NAMES_W = {102: 'АИ 80', 103: 'АИ 92', 104: 'АИ 95', 106: 'Д/Т', 107: 'СПБТ'}
                RESOURCE_COLORS_W = {102: '#00e5a0', 103: '#00d4ff', 104: '#a78bfa', 106: '#ffa726', 107: '#ff6b6b'}
                cur.execute(f"""
                    SELECT ResourceKey, SUM(Volume), SUM(ShopCost)
                    FROM {selling_by_business_day}
                    WHERE business_day >= %s AND business_day < %s
                      AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 4))
                    GROUP BY ResourceKey
                """, (ym_start, ym_end))
                by_resource = []
                for r in cur.fetchall():
                    rk = int(r[0])
                    by_resource.append({
                        'resourceKey': rk,
                        'name': RESOURCE_NAMES_W.get(rk, f'Other-{rk}'),
                        'volume': round(float(r[1] or 0), 2),
                        'amount': round(float(r[2] or 0), 2),
                        'color': RESOURCE_COLORS_W.get(rk, '#999'),
                    })
                by_resource.sort(key=lambda x: x['volume'], reverse=True)

                cur.execute(f"""
                    SELECT business_day, SUM(Volume), SUM(ShopCost) FROM {selling_by_business_day}
                    WHERE business_day >= %s AND business_day < %s
                      AND (DerivedPaymentTypeKey IS NULL OR DerivedPaymentTypeKey NOT IN (2, 4))
                    GROUP BY business_day ORDER BY 1
                """, (ym_start, ym_end))
                daily = [{'date': str(r[0]), 'volume': round(float(r[1] or 0), 2), 'amount': round(float(r[2] or 0), 2)} for r in cur.fetchall()]

                result = {
                    'month': ym, 'summary': summary, 'comparison': comparison,
                    'stations': stations_data, 'regions': regions,
                    'byResource': by_resource, 'daily': daily,
                }
                set_cached(cache_key, result)
                print(f'[warmup] {ym} done in {_time.time()-t0:.1f}s')
            finally:
                conn.close()
        except Exception as e:
            print(f'[warmup] {ym} failed: {e}')


# ===== 启动 =====
# 新增获取实际年份列表的接口

def start_background_warmup():
    print("  [cache warmup] Skipped; shift-aware statistics are computed on demand.")
    return None


if __name__ == '__main__':
    print("=" * 50)
    print("  SNK-AZS Data API Server (with cache)")
    print("  http://localhost:8900")
    print("  Endpoints:")
    print("    GET /api/health                  - Health check")
    print("    GET /api/kpi                     - Current month KPI")
    print("    GET /api/months                  - Available months")
    print("    GET /api/monthly/YYYY-MM         - Monthly full data")
    print("    GET /api/stations/YYYY-MM        - All stations for map/rank")
    print("    GET /api/regions/YYYY-MM         - Regional summary")
    print("    GET /api/station/YYYY-MM/ShopKey - Station detail")
    print("=" * 50)
    start_background_warmup()
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
