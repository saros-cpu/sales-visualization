# -*- coding: utf-8 -*-
"""
СНК-АЗС 数据 API 后端
从本地 ocw 数据库读取销售数据，提供给前端大屏调用

启动方式: python api.py
访问地址: http://localhost:8900
"""

from flask import Flask
from flask_cors import CORS
from loguru import logger
import threading
from datetime import datetime
from business_time import (
    business_period_condition_with_pruning,
    business_period_params,
    selling_business_day_subquery,
    shift_join,
)
from cache_store import get_cached, set_cached
from config import SERVER_HOST, SERVER_PORT
from constants import SHOP_KEY_MAP
from db import get_connection
from endpoints.v1.retail.analytics.controller import register_analytics_routes
from endpoints.v1.retail.analysis_report.controller import register_analysis_report_routes
from routes.basic import register_basic_routes
from endpoints.v1.retail.export.controller import register_export_routes

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


from endpoints.v1.retail.common.query import calc_yoy_mom, get_query_date_range, query_month_summary, get_latest_month_in_year, get_report_month_inventory


from endpoints.v1.retail.kpi.controller import register_kpi_routes as register_kpi_v2
register_kpi_v2(app)
register_analytics_routes(app)
register_export_routes(app)
register_analysis_report_routes(app)






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
            logger.info('[warmup] {} already cached, skip', ym)
            continue
        try:
            logger.info('[warmup] pre-loading monthly data for {} ...', ym)
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
                logger.info('[warmup] {} done in {:.1f}s', ym, _time.time() - t0)
            finally:
                conn.close()
        except Exception as e:
            logger.error('[warmup] {} failed: {}', ym, e)


# ===== 启动 =====

def start_background_warmup():
    logger.info("Cache warmup skipped (shift-aware stats computed on demand)")
    return None


if __name__ == '__main__':
    from log_setup import setup_logging
    setup_logging()

    logger.info("=" * 50)
    logger.info("  SNK-AZS Data API Server (with cache)")
    logger.info("  http://{}:{}", SERVER_HOST, SERVER_PORT)
    logger.info("  Endpoints:")
    logger.info("    GET /api/health                  - Health check")
    logger.info("    GET /api/kpi                     - Current month KPI")
    logger.info("    GET /api/months                  - Available months")
    logger.info("    GET /api/monthly/YYYY-MM         - Monthly full data")
    logger.info("    GET /api/stations/YYYY-MM        - All stations for map/rank")
    logger.info("    GET /api/regions/YYYY-MM         - Regional summary")
    logger.info("    GET /api/station/YYYY-MM/ShopKey - Station detail")
    logger.info("    GET /api/retail/self-use/YYYY-MM - Self-use oil details with plate numbers")
    logger.info("    GET /api/export/self-use/YYYY-MM - Export self-use oil to Excel")
    logger.info("=" * 50)
    start_background_warmup()
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=False)
