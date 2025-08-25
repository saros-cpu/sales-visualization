import os
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request
from openpyxl import load_workbook
import pymysql

from business_time import (
    business_date_expr,
    business_period_condition_with_pruning,
    business_period_params,
    shift_business_date_expr,
    shift_join,
)
from cache_store import get_cached, set_cached
from constants import (
    CLOSED_STATIONS,
    DEPOT_COORDS,
    FORCE_NORMAL_STATIONS,
    SHOP_COORDS,
    SHOP_KEY_MAP,
)
from db import get_connection
from export_excel import RESOURCE_DENSITY, SK4_RSK_MAP, SK6_RSK_MAP, SK28_RSK_MAP, SK29_RSK_MAP, SK30_RSK_MAP, STATION_RK_CORRECTIONS

from endpoints.v1.retail.common.query import calc_yoy_mom, get_query_date_range, get_report_month_inventory, query_month_summary
from flask import Blueprint, jsonify, request
from loguru import logger


# Self-use plate mapping exported from the retail server software
# (desktop 车牌对照.xlsx). 9001 = ExampleCo ХОЗ-НУЖДЫ, and person.COD_OWN
# stores this 1-69 number. selling.PersonKey is only the database row id and
# must not be treated as the plate number because it diverges after row 21.
SELF_USE_HOZ_NEEDS_GROUP = 9001
SELF_USE_GENERATOR_GROUP = 9002
SELF_USE_PERSON_OVERRIDES = {
    1: '01KG000AA',
    2: '01KG000AA',
    3: '01KG000AA',
    4: '01KG000AA',
    5: '01KG000AA',
    6: '01KG000AA',
    7: '01KG000AA',
    8: '01KG000AA',
    9: '01KG000AA',
    10: '01KG000AA',
    11: '01KG000AA',
    12: '01KG000AA',
    13: '01KG000AA',
    14: '01KG000AA',
    15: '01KG000AA',
    16: '01KG000AA',
    17: '01KG000AA',
    18: '01KG000AA',
    19: '01KG000AA',
    20: '01KG000AA',
    21: 'Генератор',
    22: '01KG000AA-Водитель',
    23: '01KG000AA-Водитель',
    24: '01KG000AA-Водитель',
    25: '01KG000AA-Водитель',
    26: '01KG000AA-Водитель',
    27: '01KG000AA-Водитель',
    28: '01KG000AA-Водитель S-10',
    29: '01KG000AA - Водитель',
    30: '01KG000AA-Водитель',
    31: '01KG000AA-Водитель',
    32: '01KG000AA-Водитель',
    33: '01KG000AA-Водитель',
    34: '01KG000AA-Водитель',
    35: '01KG000AA',
    36: '01KG000AA-Водитель',
    37: '01KG000AA-Водитель',
    38: '01KG000AA-Водитель',
    39: '01KG000AA-Водитель',
    40: '01KG000AA',
    41: '01KG000AA',
    42: '01KG000AA - Водитель',
    43: '01KG000AA',
    44: '01KG000AA',
    45: '01KG000AA',
    46: '01KG000AA',
    47: '01KG000AA-Бухгалтерия',
    48: '01KG000AA-Водитель',
    49: '01KG000AA-Водитель',
    50: '01KG000AA-Водитель',
    51: '01KG000AA',
    52: '01KG000AA-Водитель',
    53: '01KG000AA-Водитель',
    54: '01KG000AA-Водитель',
    55: '01KG000AA',
    56: '01KG000AA',
    57: '01KG000AA-Водитель',
    58: '01KG000AA - Водитель',
    59: '01KG000AA-Водитель',
    60: '01KG000AA-Водитель',
    61: '01KG000AA-Водитель',
    62: '08G617ASK-Водитель',
    63: '01KG000AA-Водитель',
    64: '01KG000AA-Б.Водитель.А',
    65: '01KG000AA-Б.Водитель.Б',
    66: '01KG000AA-И.Водитель.Д',
    67: '01KG000AA-Водитель',
    68: '01KG000AA-Водитель',
    69: '01KG000AA-Водитель',
}

# Self-use transactions whose PersonKey is wrong in the read-only ocw DB
# (the retail software records a different self-use number). Keyed by
# TransactionKey; value is the correct plate+driver per the retail software.
SELF_USE_TXN_OVERRIDES = {
    9422896: 'Генератор',
    9482235: 'Генератор',
    9507306: 'Генератор',
}

SELF_USE_GENERATOR_OVERRIDES = {
    1: 'Генератор',
}


def _map_resource_key_to_name(rk, shop_key, price=0.0, rsk=None):
    # Mirror export_excel._infer_resource_code. Shop-6/28 etc. renumbered
    # ResourceKey after mid-April, so the raw low ResourceKey is unreliable;
    # map via ResourceShopKey and fall back to unit-price inference.
    rk = _safe_int(rk)
    shop_key = _safe_int(shop_key, None)
    rsk = _safe_int(rsk, None)
    if rsk == 0:
        rsk = None
    if rk >= 100:
        if shop_key is not None:
            corrected = STATION_RK_CORRECTIONS.get((shop_key, rk))
            if corrected:
                return RESOURCE_NAMES.get(corrected, f'Other-{corrected}')
        return RESOURCE_NAMES.get(rk, f'Other-{rk}')
    if shop_key == 6 and rsk is not None:
        mapped = SK6_RSK_MAP.get(int(rsk))
        if mapped:
            return RESOURCE_NAMES.get(mapped, f'Other-{mapped}')
    if shop_key == 4 and rsk is not None:
        mapped = SK4_RSK_MAP.get(int(rsk))
        if mapped:
            return RESOURCE_NAMES.get(mapped, f'Other-{mapped}')
    if shop_key == 30 and rsk is not None:
        mapped = SK30_RSK_MAP.get(int(rsk))
        if mapped:
            return RESOURCE_NAMES.get(mapped, f'Other-{mapped}')
    if shop_key == 29 and rsk is not None:
        mapped = SK29_RSK_MAP.get(int(rsk))
        if mapped:
            return RESOURCE_NAMES.get(mapped, f'Other-{mapped}')
    if shop_key is not None:
        corrected = STATION_RK_CORRECTIONS.get((shop_key, rk))
        if corrected:
            return RESOURCE_NAMES.get(corrected, f'Other-{corrected}')
    if shop_key == 28 and rsk is not None:
        mapped = SK28_RSK_MAP.get(int(rsk), rk)
        return RESOURCE_NAMES.get(mapped, f'Other-{mapped}')
    p = float(price or 0)
    if shop_key == 28 and p > 0:
        if abs(p - 95.0) < 1.0:
            return RESOURCE_NAMES.get(110, 'ДТ -35')
        if p > 83:
            return RESOURCE_NAMES.get(106, 'Д/Т')
        if p <= 45:
            return RESOURCE_NAMES.get(108, 'СПБТ')
    if p <= 0:
        return RESOURCE_NAMES.get(rk, f'Other-{rk}')
    if p <= 45:
        return RESOURCE_NAMES.get(108, 'СПБТ')
    if p <= 65:
        return RESOURCE_NAMES.get(102, 'АИ 80')
    if p <= 78:
        return RESOURCE_NAMES.get(103, 'АИ 92')
    if p <= 83:
        return RESOURCE_NAMES.get(104, 'АИ 95')
    return RESOURCE_NAMES.get(106, 'Д/Т')
from cache_store import get_cached, set_cached
from constants import *
from db import get_connection
from export_excel import *
from endpoints.v1.retail.analytics.service.core import (
    _station_map_details_payload,
    _dashboard_yearly_from_monthly_snapshots,
    _resources_yearly_from_monthly_snapshots,
    _attach_monthly_finance_metrics,
    _attach_region_snapshot_comparisons,
)
from endpoints.v1.retail.analytics.service.core import *
from endpoints.v1.retail.common.query import calc_yoy_mom, get_query_date_range, get_report_month_inventory, query_month_summary

analytics_api = Blueprint("analytics_api_v2", __name__)

PROJECT_ROOT = Path(__file__).resolve().parents[4]
OILSTATION_ROOT = Path(__file__).resolve().parents[3]
RESOURCE_NAMES = {
    102: "\u0410\u0418 80",
    103: "\u0410\u0418 92",
    104: "\u0410\u0418 95",
    106: "\u0414/\u0422",
    108: "\u0421\u041f\u0411\u0422",
    109: "\u0414/\u0422",
    110: "\u0414\u0422 -35",
}

def register_analytics_routes(app):
    app.register_blueprint(analytics_api)


def _build_self_use_month_response(year_month):
    parts = year_month.split('-')
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        return None

    cache_key = f'self_use:{year_month}'
    cached = get_cached(cache_key)
    if cached and isinstance(cached.get('records'), list) and _self_use_snapshot_has_group_fields(cached):
        return _normalize_self_use_snapshot(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start = f'{year_month}-01'
        ym_end = f'{y + 1}-01-01' if m == 12 else f'{y}-{m+1:02d}-01'

        cur.execute("""
            SELECT s.TransactionKey, s.ShopKey, s.ResourceKey, s.Volume, s.ShopCost,
                   DATE(s.TransactionDatetime) as trx_date,
                   TIME(s.TransactionDatetime) as trx_time,
                   s.PersonKey, CAST(p.Name AS BINARY) as plate_number,
                   s.ResourceShopKey, p.COD_A, p.COD_OWN
            FROM selling s
            LEFT JOIN person p ON s.PersonKey = p.PersonKey
            WHERE s.DerivedPaymentTypeKey = 2
              AND s.TransactionDatetime >= %s AND s.TransactionDatetime < %s
            ORDER BY s.TransactionDatetime DESC
        """, (ym_start, ym_end))

        records = []
        total_volume = 0.0
        total_amount = 0.0
        for r in cur.fetchall():
            sk = int(r[1]) if r[1] else 0
            rk = int(r[2]) if r[2] else 0
            vol = float(r[3] or 0)
            amt = float(r[4] or 0)
            rsk = int(r[9]) if r[9] else 0
            group_key = _safe_int(r[10])
            pk = int(r[7]) if r[7] else 0
            self_use_number = _self_use_number_for_record(pk, group_key, _safe_int(r[11]))
            total_volume += vol
            total_amount += amt
            info = SHOP_KEY_MAP.get(sk, {'name': f'Station-{sk}', 'short': '', 'region': ''})
            product_name = _map_resource_key_to_name(rk, sk, amt / vol if vol else 0, rsk)
            raw_name = r[8]
            if raw_name:
                if isinstance(raw_name, bytes):
                    plate_number = raw_name.decode('cp1251', errors='replace').strip()
                else:
                    plate_number = raw_name.strip()
            else:
                plate_number = ''
            tk = int(r[0])
            plate_number = _normalize_self_use_plate(
                plate_number,
                person_key=pk,
                transaction_key=tk,
                group_key=group_key,
                self_use_number=self_use_number,
            )

            records.append({
                'transactionKey': int(r[0]),
                'date': str(r[5]) if r[5] else '',
                'time': str(r[6]) if r[6] else '',
                'shopKey': sk,
                'stationName': info['name'],
                'stationShort': info.get('short', ''),
                'resourceKey': rk,
                'resourceShopKey': rsk,
                'productName': product_name,
                'volume': round(vol, 3),
                'amount': round(amt, 2),
                'plateNumber': plate_number,
                'personKey': pk,
                'personGroup': group_key,
                'selfUseNumber': self_use_number,
            })

        result = {
            'month': year_month,
            'records': records,
            'summary': {
                'totalVolume': round(total_volume, 2),
                'totalAmount': round(total_amount, 2),
                'totalRecords': len(records),
            },
            'comparison': {},
            'byStation': [],
            'byResource': [],
            'byRegion': {},
            'daily': [],
        }

        if cache_allowed():
            set_cached(cache_key, result)

        return result
    finally:
        conn.close()


def _normalize_self_use_snapshot(snapshot):
    changed = False
    records = snapshot.get('records', [])
    product_fallbacks = _self_use_snapshot_product_fallbacks(records)
    for rec in records:
        old_values = dict(rec)
        tk = _safe_int(rec.get('transactionKey'))
        sk = _safe_int(rec.get('shopKey'))
        rk = _safe_int(rec.get('resourceKey'))
        rsk = _safe_int(rec.get('resourceShopKey'))
        volume = round(float(rec.get('volume') or 0), 3)
        amount = round(float(rec.get('amount') or 0), 2)
        person_key = _safe_int(rec.get('personKey'))
        group_key = _safe_int(rec.get('personGroup'))
        self_use_number = _self_use_number_for_record(
            person_key,
            group_key,
            _safe_int(rec.get('selfUseNumber')),
        )
        info = SHOP_KEY_MAP.get(sk, {'name': rec.get('stationName') or f'Station-{sk}', 'short': rec.get('stationShort') or '', 'region': ''})

        rec['time'] = str(rec.get('time') or '')
        rec['stationName'] = info.get('name') or rec.get('stationName') or f'Station-{sk}'
        rec['stationShort'] = info.get('short') or rec.get('stationShort') or ''
        rec['plateNumber'] = _normalize_self_use_plate(
            rec.get('plateNumber'),
            person_key=person_key,
            transaction_key=tk,
            group_key=group_key,
            self_use_number=self_use_number,
        )
        product_name = _map_resource_key_to_name(rk, sk, amount / volume if volume else 0, rsk)
        if product_name.startswith('Other-') and volume == 0 and amount == 0:
            product_name = product_fallbacks.get((sk, rk), product_name)
        rec['productName'] = product_name
        rec['personKey'] = person_key
        rec['personGroup'] = group_key
        rec['selfUseNumber'] = self_use_number
        rec['volume'] = volume
        rec['amount'] = amount
        if old_values != rec:
            changed = True
    if changed and snapshot.get('month'):
        set_cached(f"self_use:{snapshot['month']}", snapshot)
    return snapshot


def _self_use_snapshot_has_group_fields(snapshot):
    records = snapshot.get('records', [])
    return all('personGroup' in rec and 'selfUseNumber' in rec for rec in records)


def _self_use_number_for_record(person_key, group_key=0, cod_own=0):
    person_key = _safe_int(person_key)
    group_key = _safe_int(group_key)
    cod_own = _safe_int(cod_own)
    if group_key == SELF_USE_GENERATOR_GROUP:
        return cod_own
    if 1 <= person_key <= 69:
        return person_key
    return cod_own


def _self_use_snapshot_product_fallbacks(records):
    counts = {}
    for rec in records:
        sk = _safe_int(rec.get('shopKey'))
        rk = _safe_int(rec.get('resourceKey'))
        rsk = _safe_int(rec.get('resourceShopKey'))
        volume = round(float(rec.get('volume') or 0), 3)
        amount = round(float(rec.get('amount') or 0), 2)
        if volume == 0 and amount == 0:
            continue
        product_name = _map_resource_key_to_name(rk, sk, amount / volume if volume else 0, rsk)
        if product_name.startswith('Other-'):
            continue
        bucket = counts.setdefault((sk, rk), {})
        bucket[product_name] = bucket.get(product_name, 0) + 1
    return {key: next(iter(bucket)) for key, bucket in counts.items() if len(bucket) == 1}


def _safe_int(value, default=0):
    try:
        if value is None or value == '':
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_self_use_plate(value, person_key=0, transaction_key=0, group_key=0, self_use_number=0):
    if transaction_key in SELF_USE_TXN_OVERRIDES:
        return SELF_USE_TXN_OVERRIDES[transaction_key]

    group_key = _safe_int(group_key)
    self_use_number = _safe_int(self_use_number)
    person_key = _safe_int(person_key)
    if group_key == SELF_USE_GENERATOR_GROUP:
        mapped = SELF_USE_GENERATOR_OVERRIDES.get(self_use_number)
        return mapped or 'Генератор'
    if group_key in (0, SELF_USE_HOZ_NEEDS_GROUP) and self_use_number in SELF_USE_PERSON_OVERRIDES:
        return SELF_USE_PERSON_OVERRIDES[self_use_number]

    plate = str(value or '').strip()
    numeric_plate = _safe_int(plate, None)
    if group_key in (0, SELF_USE_HOZ_NEEDS_GROUP) and numeric_plate in SELF_USE_PERSON_OVERRIDES:
        return SELF_USE_PERSON_OVERRIDES[numeric_plate]

    plate = _repair_cp1251_mojibake(plate)
    canonical = _canonical_self_use_plate(plate)
    if canonical:
        return canonical
    if group_key == 0 and self_use_number == 0 and person_key in SELF_USE_PERSON_OVERRIDES:
        return SELF_USE_PERSON_OVERRIDES[person_key]
    return canonical


def _repair_cp1251_mojibake(value):
    if not value:
        return ''
    try:
        return value.encode('latin1').decode('cp1251').strip()
    except UnicodeError:
        return value.strip()


def _compact_plate(value):
    return ''.join(str(value or '').upper().split())


def _canonical_self_use_plate(value):
    compact = _compact_plate(value)
    if not compact:
        return ''
    for mapped in SELF_USE_PERSON_OVERRIDES.values():
        if _compact_plate(mapped) == compact:
            return mapped
    for mapped in SELF_USE_TXN_OVERRIDES.values():
        if _compact_plate(mapped) == compact:
            return mapped
    return value


@analytics_api.route('/api/retail/self-use/<year_month>')
def api_retail_self_use(year_month):
    result = _build_self_use_month_response(year_month)
    if result is None:
        return jsonify({'error': 'invalid year_month format, expected YYYY-MM'}), 400
    return jsonify(result)


@analytics_api.route('/api/retail/self-use')
def api_retail_self_use_range():
    date_from = request.args.get('date_from')
    date_to = request.args.get('date_to')
    if not date_from or not date_to:
        return jsonify({'error': 'date_from and date_to are required'}), 400

    try:
        d = datetime.strptime(date_from, '%Y-%m-%d')
        end_dt = datetime.strptime(date_to, '%Y-%m-%d') + timedelta(days=1)
    except ValueError:
        return jsonify({'error': 'invalid date format, expected YYYY-MM-DD'}), 400

    months = []
    while d < end_dt:
        months.append(d.strftime('%Y-%m'))
        if d.month == 12:
            d = d.replace(year=d.year + 1, month=1, day=1)
        else:
            d = d.replace(month=d.month + 1, day=1)

    records = []
    total_volume = 0.0
    total_amount = 0.0
    for ym in months:
        snap = _build_self_use_month_response(ym)
        if not snap:
            continue
        for rec in snap.get('records', []):
            if date_from <= rec['date'] <= date_to:
                records.append(rec)
                total_volume += rec['volume']
                total_amount += rec['amount']

    records.sort(key=lambda r: (r['date'], r['time']), reverse=True)

    return jsonify({
        'date_from': date_from,
        'date_to': date_to,
        'records': records,
        'summary': {
            'totalVolume': round(total_volume, 2),
            'totalAmount': round(total_amount, 2),
            'totalRecords': len(records),
        },
    })


@analytics_api.route('/api/dashboard/yearly')
def api_dashboard_yearly():
    """Dashboard yearly cumulative data for map, rankings, regions, oil mix, and payment charts."""
    year = request.args.get("year", type=int) or datetime.now().year
    cache_key = f'dashboard_yearly:{year}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)
    if cache_allowed():
        snapshot_result = _dashboard_yearly_from_monthly_snapshots(year)
        if snapshot_result:
            set_cached(cache_key, snapshot_result)
            return jsonify(snapshot_result)

    year_start = f'{year}-01-01'
    current_year = datetime.now().year
    if year == current_year:
        year_end = datetime.now().strftime('%Y-%m-%d')
    elif year < current_year:
        year_end = f'{year + 1}-01-01'
    else:
        year_end = year_start

    conn = get_connection()
    try:
        cur = conn.cursor()

        year_condition = business_period_condition_with_pruning("s", "sh")
        total_volume = report_volume_expr("s")
        total_amount = report_amount_expr("s")
        resource_totals = {}
        resource_key = resource_key_expr("s")
        cur.execute(f"""
            SELECT
                s.ShopKey,
                {resource_key} as resource_key,
                COUNT(*) as txn_count,
                {total_volume} as total_liters,
                {total_amount} as total_sales,
                {report_cash_amount_expr("s")} as cash_sales,
                {report_card_amount_expr("s")} as card_sales,
                {report_cash_volume_expr("s")} as cash_liters,
                {report_card_volume_expr("s")} as card_liters,
                SUM(s.BonusOutCost) as bonus_cost
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {year_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey, resource_key
        """, business_period_params(year_start, year_end))

        sales_data = {}
        for row in cur.fetchall():
            shop_key = row[0]
            resource_key_value = row[1]
            shop_bucket = sales_data.setdefault(shop_key, {
                'txnCount': 0,
                'volume': 0.0,
                'amount': 0.0,
                'cash': 0.0,
                'card': 0.0,
                'cashLiters': 0.0,
                'cardLiters': 0.0,
                'bonus': 0.0,
            })
            shop_bucket['txnCount'] += int(row[2] or 0)
            shop_bucket['volume'] += float(row[3] or 0)
            shop_bucket['amount'] += float(row[4] or 0)
            shop_bucket['cash'] += float(row[5] or 0)
            shop_bucket['card'] += float(row[6] or 0)
            shop_bucket['cashLiters'] += float(row[7] or 0)
            shop_bucket['cardLiters'] += float(row[8] or 0)
            shop_bucket['bonus'] += float(row[9] or 0)
            add_resource_bucket(resource_totals, resource_key_value, row[3], row[4])

        for data in sales_data.values():
            for key in ('volume', 'amount', 'cash', 'card', 'cashLiters', 'cardLiters', 'bonus'):
                data[key] = round(data[key], 2)

        by_resource = []
        for rk, values in resource_totals.items():
            by_resource.append((
                rk,
                round(values['volume'], 2),
                round(values['amount'], 2),
            ))
        by_resource = format_resource_rows(by_resource)

        stations_list = []
        for shop_key, info in SHOP_KEY_MAP.items():
            coords = SHOP_COORDS.get(shop_key, {'lng': 0, 'lat': 0})
            data = sales_data.get(shop_key, {})
            amount = data.get('amount', 0)
            stations_list.append({
                'shopKey': shop_key,
                'name': info['name'],
                'short': info['short'],
                'region': info['region'],
                'lng': coords.get('lng', 0),
                'lat': coords.get('lat', 0),
                'txnCount': data.get('txnCount', 0),
                'volume': data.get('volume', 0),
                'amount': amount,
                'cash': data.get('cash', 0),
                'card': data.get('card', 0),
                'cashLiters': data.get('cashLiters', 0),
                'cardLiters': data.get('cardLiters', 0),
                'bonus': data.get('bonus', 0),
                'status': station_status_for(shop_key, amount),
                'closedReason': CLOSED_STATIONS.get(shop_key, ''),
            })

        regions = {}
        for shop_key, info in SHOP_KEY_MAP.items():
            region_name = info['region']
            regions.setdefault(region_name, {
                'amount': 0,
                'volume': 0,
                'cash': 0,
                'card': 0,
                'bonus': 0,
                'stationCount': 0,
                'activeCount': 0,
            })
            regions[region_name]['stationCount'] += 1

            data = sales_data.get(shop_key, {})
            amount = float(data.get('amount', 0) or 0)
            regions[region_name]['amount'] += amount
            regions[region_name]['volume'] += float(data.get('volume', 0) or 0)
            regions[region_name]['cash'] += float(data.get('cash', 0) or 0)
            regions[region_name]['card'] += float(data.get('card', 0) or 0)
            regions[region_name]['bonus'] += float(data.get('bonus', 0) or 0)
            if amount > 0:
                regions[region_name]['activeCount'] += 1

        for data in regions.values():
            for key in ('amount', 'volume', 'cash', 'card', 'bonus'):
                data[key] = round(data[key], 2)

        result = {
            'year': year,
            'queryStart': year_start,
            'queryEndExclusive': year_end,
            'stations': stations_list,
            'depots': [
                {
                    'name': name,
                    'short': data['short'],
                    'region': data['region'],
                    'lng': data['lng'],
                    'lat': data['lat'],
                    'type': 'depot',
                    'status': data.get('status', 'normal'),
                    'closedReason': data.get('closedReason', ''),
                }
                for name, data in DEPOT_COORDS.items()
            ],
            'regions': regions,
            'byResource': by_resource,
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


@analytics_api.route('/api/resources/yearly')
def api_resources_yearly():
    year = request.args.get("year", type=int) or datetime.now().year
    month = request.args.get("month", type=int)
    if month is not None and (month < 1 or month > 12):
        return jsonify({"error": "month must be between 1 and 12"}), 400
    cache_key = f'resources_yearly:{year}:{month or "year"}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)
    if cache_allowed():
        snapshot_result = _resources_yearly_from_monthly_snapshots(year, month)
        if snapshot_result:
            set_cached(cache_key, snapshot_result)
            return jsonify(snapshot_result)

    now = datetime.now()
    current_year = now.year
    if month:
        period_label = f"{year}-{month:02d}"
        period_start, period_end = get_query_date_range(period_label)
        prev_label = f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"
        prev_start, prev_end = get_query_date_range(prev_label, exclude_today=False)
        yoy_label = f"{year - 1}-{month:02d}"
        yoy_start, yoy_end = get_query_date_range(yoy_label, exclude_today=False)
        latest_month = period_label
        prev_month = prev_label
    else:
        period_start = f'{year}-01-01'
        if year == current_year:
            period_end = now.strftime('%Y-%m-%d')
        elif year < current_year:
            period_end = f'{year + 1}-01-01'
        else:
            period_end = period_start

        yoy_start = f'{year - 1}-01-01'
        if year == current_year:
            elapsed_days = (now.date() - datetime(year, 1, 1).date()).days
            yoy_end = (datetime(year - 1, 1, 1).date() + timedelta(days=elapsed_days)).strftime('%Y-%m-%d')
        else:
            yoy_end = f'{year}-01-01'
        latest_month = None
        prev_month = None
        prev_start = prev_end = None

    conn = get_connection()
    try:
        cur = conn.cursor()
        resource_key = resource_key_expr("s")
        business_day = shift_business_date_expr("sh")
        volume_expr = report_volume_expr("s")
        amount_expr = report_amount_expr("s")

        def query_period(start, end):
            cur.execute(f"""
                SELECT {resource_key} as resource_key,
                       {volume_expr} as vol,
                       {amount_expr} as amt
                FROM shift sh
                JOIN selling s FORCE INDEX (Index_SS)
                  ON s.ShopKey = sh.ShopKey
                 AND s.ShiftKey = sh.ShiftKey
                WHERE sh.ShopKey IN ({",".join(str(k) for k in sorted(SHOP_KEY_MAP.keys()))})
                  AND sh.DatetimeShiftBegin IS NOT NULL
                  AND sh.DatetimeShiftEnd IS NOT NULL
                  AND sh.DatetimeShiftEnd > sh.DatetimeShiftBegin
                  AND sh.DatetimeShiftEnd < %s
                  AND {business_day} >= %s
                  AND {business_day} < %s
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
                GROUP BY resource_key
            """, (end, start, end))
            data = {}
            for r in cur.fetchall():
                add_resource_bucket(data, r[0], r[1], r[2])
            return data

        current = query_period(period_start, period_end)
        previous = query_period(yoy_start, yoy_end)

        month_data = current if month else {}
        prev_month_data = query_period(prev_start, prev_end) if month and prev_start and prev_end else {}
        if not month:
            cur.execute(f"""
                SELECT DATE_FORMAT(MAX({business_day}), '%%Y-%%m')
                FROM shift sh
                JOIN selling s FORCE INDEX (Index_SS)
                  ON s.ShopKey = sh.ShopKey
                 AND s.ShiftKey = sh.ShiftKey
                WHERE sh.ShopKey IN ({",".join(str(k) for k in sorted(SHOP_KEY_MAP.keys()))})
                  AND sh.DatetimeShiftBegin IS NOT NULL
                  AND sh.DatetimeShiftEnd IS NOT NULL
                  AND sh.DatetimeShiftEnd > sh.DatetimeShiftBegin
                  AND sh.DatetimeShiftEnd < %s
                  AND {business_day} >= %s
                  AND {business_day} < %s
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            """, (period_end, period_start, period_end))
            latest_month_row = cur.fetchone()
            latest_month = latest_month_row[0] if latest_month_row and latest_month_row[0] else None
            if latest_month:
                y, m = int(latest_month[:4]), int(latest_month[5:7])
                prev_month = f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"
                latest_start, latest_end = get_query_date_range(latest_month, exclude_today=False)
                prev_latest_start, prev_latest_end = get_query_date_range(prev_month, exclude_today=False)
                month_data = query_period(latest_start, latest_end)
                prev_month_data = query_period(prev_latest_start, prev_latest_end)

        resource_keys = sorted(set(current) | set(previous) | set(month_data) | set(prev_month_data))
        resources = []
        for rk in resource_keys:
            cur_d = current.get(rk, {'volume': 0, 'amount': 0})
            prev_d = previous.get(rk, {'volume': 0, 'amount': 0})
            mon_d = month_data.get(rk, {'volume': 0, 'amount': 0})
            prev_mon_d = prev_month_data.get(rk, {'volume': 0, 'amount': 0})
            resources.append({
                'resourceKey': rk,
                'key': rk,
                'name': RESOURCE_NAMES.get(rk, f'Other-{rk}'),
                'volume': round(cur_d['volume'], 2),
                'amount': round(cur_d['amount'], 2),
                'color': RESOURCE_COLORS.get(rk, '#999999'),
                'yoyVolume': calc_change(cur_d['volume'], prev_d['volume']),
                'yoySales': calc_change(cur_d['amount'], prev_d['amount']),
                'momVolume': calc_change(mon_d['volume'], prev_mon_d['volume']),
                'momSales': calc_change(mon_d['amount'], prev_mon_d['amount']),
                'latestMonthVolume': round(mon_d['volume'], 2),
                'latestMonthAmount': round(mon_d['amount'], 2),
            })
        resources.sort(key=lambda item: RESOURCE_ORDER_INDEX.get(item['key'], 999))

        result = {
            'year': year,
            'month': month,
            'periodLabel': f"{year}-{month:02d}" if month else f"{year} 全年",
            'queryStart': period_start,
            'queryEndExclusive': period_end,
            'latestMonth': latest_month,
            'prevMonth': prev_month,
            'resources': resources,
            'summary': {
                'totalVolume': round(sum(item['volume'] for item in resources), 2),
                'totalAmount': round(sum(item['amount'] for item in resources), 2),
                'resourceCount': len([item for item in resources if item['amount'] > 0 or item['volume'] > 0]),
            },
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


@analytics_api.route('/api/station-map-details')
def api_station_map_details():
    """Latest per-station inventory and retail prices for map hover cards."""
    return jsonify(_station_map_details_payload())


@analytics_api.route('/api/integration/retail-summary')
def api_integration_retail_summary():
    year = request.args.get("year", type=int) or datetime.now().year
    month = request.args.get("month", type=int)
    if month is not None and (month < 1 or month > 12):
        return jsonify({"error": "month must be between 1 and 12"}), 400

    cache_key = f"integration:retail-summary:{year}:{month or 'year'}"
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)

    if month:
        period_label = f"{year}-{month:02d}"
        start, end = get_query_date_range(period_label)
    else:
        start = f"{year}-01-01"
        current_year = datetime.now().year
        if year == current_year:
            end = datetime.now().strftime("%Y-%m-%d")
        elif year < current_year:
            end = f"{year + 1}-01-01"
        else:
            end = start

    conn = get_connection()
    try:
        cur = conn.cursor()
        business_day = shift_business_date_expr("sh")
        resource_key = report_resource_key_expr("s")
        daily_rows = {}
        by_resource_rows = {}
        daily_resource = []
        active_shops = set()
        total_txn = 0

        for shop_key in sorted(SHOP_KEY_MAP.keys()):
            cur.execute(f"""
                SELECT {business_day} as business_day,
                       {resource_key} as resource_key,
                       COUNT(*) as txn_count,
                       SUM(CASE
                           WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4))
                            AND s.BasePaymentTypeKey IN (1, 2)
                           THEN s.Volume ELSE 0 END)
                       + SUM(CASE WHEN s.DerivedPaymentTypeKey = 3 THEN s.Volume ELSE 0 END) as total_liters,
                       SUM(CASE
                           WHEN (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 3, 4))
                            AND s.BasePaymentTypeKey IN (1, 2)
                           THEN s.ShopCost ELSE 0 END)
                       + SUM(CASE WHEN s.DerivedPaymentTypeKey = 3 THEN s.ShopCost ELSE 0 END) as total_sales
                FROM shift sh
                JOIN selling s FORCE INDEX (Index_SS)
                  ON s.ShopKey = sh.ShopKey
                 AND s.ShiftKey = sh.ShiftKey
                WHERE sh.ShopKey = %s
                  AND sh.DatetimeShiftBegin IS NOT NULL
                  AND sh.DatetimeShiftEnd IS NOT NULL
                  AND sh.DatetimeShiftEnd > sh.DatetimeShiftBegin
                  AND sh.DatetimeShiftEnd < %s
                  AND {business_day} >= %s
                  AND {business_day} < %s
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
                GROUP BY business_day, resource_key
                ORDER BY business_day, resource_key
            """, (shop_key, end, start, end))

            shop_has_sales = False
            for row in cur.fetchall():
                business_day_value = str(row[0])
                rk = int(row[1] or 0)
                if rk < 100:
                    continue
                txn_count = int(row[2] or 0)
                volume = float(row[3] or 0)
                amount = float(row[4] or 0)
                if not volume and not amount:
                    continue
                total_txn += txn_count
                if amount > 0 or volume > 0:
                    shop_has_sales = True

                daily_resource.append({
                    "date": business_day_value,
                    "resourceKey": rk,
                    "volume": round(volume, 3),
                    "amount": round(amount, 2),
                })
                daily_bucket = daily_rows.setdefault(business_day_value, [0.0, 0.0])
                daily_bucket[0] += volume
                daily_bucket[1] += amount
                resource_bucket = by_resource_rows.setdefault(rk, [0.0, 0.0])
                resource_bucket[0] += volume
                resource_bucket[1] += amount
            if shop_has_sales:
                active_shops.add(shop_key)

        daily = [
            {
                "date": day,
                "volume": round(values[0], 3),
                "amount": round(values[1], 2),
            }
            for day, values in sorted(daily_rows.items())
        ]
        total_liters = sum(values[0] for values in daily_rows.values())
        total_sales = sum(values[1] for values in daily_rows.values())

        result = {
            "source": "OilStationReport",
            "year": year,
            "month": month,
            "queryStart": start,
            "queryEndExclusive": end,
            "summary": {
                "totalTxn": total_txn,
                "activeShops": len(active_shops),
                "totalLiters": round(total_liters, 3),
                "totalSales": round(total_sales, 2),
            },
            "daily": daily,
            "dailyResource": daily_resource,
            "byResource": format_resource_rows([
                (rk, values[0], values[1])
                for rk, values in by_resource_rows.items()
            ]),
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


@analytics_api.route('/api/assistant/retail-summary')
def api_assistant_retail_summary():
    start = request.args.get("start")
    end = request.args.get("end")
    try:
        datetime.strptime(start or "", "%Y-%m-%d")
        datetime.strptime(end or "", "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "start and end must use YYYY-MM-DD"}), 400
    if end <= start:
        return jsonify({"error": "end must be greater than start"}), 400

    cache_key = f"assistant:retail-summary:{start}:{end}"
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        period_condition = business_period_condition_with_pruning("s", "sh")
        total_volume = report_volume_expr("s")
        total_amount = report_amount_expr("s")
        resource_key = report_resource_key_expr("s")
        cur.execute(f"""
            SELECT {resource_key} AS resource_key,
                   COUNT(*) AS txn_count,
                   {total_volume} AS total_liters,
                   {total_amount} AS total_sales
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY resource_key
            ORDER BY total_liters DESC
        """, business_period_params(start, end))
        rows = cur.fetchall()
        resources = format_resource_rows([(row[0], row[2], row[3]) for row in rows])
        total_tons = add_resource_tons(resources)
        cur.execute(f"""
            SELECT s.ShopKey,
                   {resource_key} AS resource_key,
                   COUNT(*) AS txn_count,
                   {total_volume} AS total_liters,
                   {total_amount} AS total_sales
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
              AND s.ShopKey IN ({",".join(str(k) for k in sorted(SHOP_KEY_MAP.keys()))})
            GROUP BY s.ShopKey, resource_key
            ORDER BY total_liters DESC
        """, business_period_params(start, end))
        station_resource_rows = cur.fetchall()
        station_buckets = {}
        for shop_key, rk, txn_count, liters, amount in station_resource_rows:
            shop_key = int(shop_key)
            bucket = station_buckets.setdefault(shop_key, {"txn": 0, "resources": []})
            bucket["txn"] += int(txn_count or 0)
            bucket["resources"].append((rk, liters, amount))
        station_rows = []
        region_buckets = {}
        for shop_key, bucket in station_buckets.items():
            info = SHOP_KEY_MAP.get(shop_key, {"name": f"Station-{shop_key}", "short": "", "region": "未知区域"})
            station_resources = format_resource_rows(bucket["resources"])
            station_tons = add_resource_tons(station_resources)
            station_liters = round(sum(float(item.get("volume") or 0) for item in station_resources), 2)
            station_amount = round(sum(float(item.get("amount") or 0) for item in station_resources), 2)
            station_rows.append({
                "shopKey": shop_key,
                "name": info.get("name") or f"Station-{shop_key}",
                "short": info.get("short") or "",
                "region": info.get("region") or "未知区域",
                "txn": bucket["txn"],
                "volume": station_liters,
                "tons": station_tons,
                "amount": station_amount,
            })
            region = info.get("region") or "未知区域"
            region_bucket = region_buckets.setdefault(region, {"region": region, "txn": 0, "volume": 0, "tons": 0, "amount": 0, "stationCount": 0})
            region_bucket["txn"] += bucket["txn"]
            region_bucket["volume"] += station_liters
            region_bucket["tons"] += station_tons
            region_bucket["amount"] += station_amount
            region_bucket["stationCount"] += 1
        station_rows.sort(key=lambda item: item["amount"], reverse=True)
        region_rows = sorted(
            (
                {
                    **item,
                    "volume": round(item["volume"], 2),
                    "tons": round(item["tons"], 3),
                    "amount": round(item["amount"], 2),
                }
                for item in region_buckets.values()
            ),
            key=lambda item: item["amount"],
            reverse=True,
        )
        result = {
            "source": "OilStationReport",
            "queryStart": start,
            "queryEndExclusive": end,
            "summary": {
                "totalTxn": int(sum(row[1] or 0 for row in rows)),
                "totalLiters": round(sum(float(row[2] or 0) for row in rows), 2),
                "totalTons": total_tons,
                "totalSales": round(sum(float(row[3] or 0) for row in rows), 2),
            },
            "byResource": resources,
            "stations": station_rows,
            "regions": region_rows,
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


def _monthly_inventory_needs_refresh(payload):
    summary = (payload or {}).get("summary") or {}
    return "inventory" not in summary or "inventoryMonth" not in summary


def _attach_monthly_inventory(year_month, payload, cur=None):
    summary = payload.setdefault("summary", {})
    if not _monthly_inventory_needs_refresh(payload):
        return False

    if cur is not None:
        summary["inventory"] = get_report_month_inventory(cur, year_month)
        summary["inventoryMonth"] = year_month
        return True

    conn = get_connection()
    try:
        local_cur = conn.cursor()
        summary["inventory"] = get_report_month_inventory(local_cur, year_month)
        summary["inventoryMonth"] = year_month
        return True
    finally:
        conn.close()


@analytics_api.route('/api/monthly/<year_month>')
def api_monthly(year_month):
    cache_key = f'monthly:{year_month}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        cache_changed = False
        if "totalTons" not in (cached.get("summary") or {}) or "totalSalesCny" not in (cached.get("summary") or {}):
            cached = _attach_monthly_finance_metrics(cached)
            cache_changed = True
        if _attach_monthly_inventory(year_month, cached):
            cache_changed = True
        if cache_changed:
            set_cached(cache_key, cached)
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start, ym_end = get_query_date_range(year_month)

        # ---- 当月全网汇总 ----
        summary = query_month_summary(cur, year_month)
        summary['inventory'] = get_report_month_inventory(cur, year_month)
        summary['inventoryMonth'] = year_month
        # activeShops 已在 query_month_summary 中合并计算，无需额外查询

        # ---- 同比环比数据 ----
        dates = calc_yoy_mom(y, m)
        prev_summary = query_month_summary(cur, dates['prev'])
        yoy_summary = query_month_summary(cur, dates['yoy'])

        def calc_change(current, previous):
            if not previous or previous <= 0:
                return None
            return round((current - previous) / previous * 100, 1)

        comparison = {
            'mom': {  # 环比
                'sales': calc_change(summary['totalSales'], prev_summary['totalSales']),
                'volume': calc_change(summary['totalLiters'], prev_summary['totalLiters']),
                'cashSales': calc_change(summary['cashSales'], prev_summary['cashSales']),
                'cardSales': calc_change(summary['cardSales'], prev_summary['cardSales']),
                'activeShops': (summary['activeShops'] - prev_summary.get('activeShops', summary['activeShops'])) if prev_summary.get('activeShops') else None,
                'prevMonth': dates['prev'],
            },
            'yoy': {  # 同比
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

        # ---- 按站点汇总 ----
        period_condition = business_period_condition_with_pruning("s", "sh")
        cur.execute(f"""
            SELECT
                s.ShopKey,
                COUNT(*) as txn_count,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales,
                SUM(s.ShopBaseCost) as total_base,
                {report_cash_amount_expr("s")} as cash_sales,
                {report_card_amount_expr("s")} as card_sales,
                {report_cash_volume_expr("s")} as cash_liters,
                {report_card_volume_expr("s")} as card_liters,
                {report_bonus_amount_expr("s")} as bonus_cost
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
            ORDER BY total_sales DESC
        """, business_period_params(ym_start, ym_end))
        station_rows = cur.fetchall()
        stations_data = []
        for r in station_rows:
            shop_key = r[0]
            info = SHOP_KEY_MAP.get(shop_key, {'name': f'Station-{shop_key}', 'short': '', 'region': 'unknown'})
            stations_data.append({
                'shopKey': shop_key,
                'name': info['name'],
                'short': info['short'],
                'region': info['region'],
                'txnCount': int(r[1] or 0),
                'volume': round(float(r[2] or 0), 2),
                'amount': round(float(r[3] or 0), 2),
                'baseCost': round(float(r[4] or 0), 2),
                'cashSales': round(float(r[5] or 0), 2),
                'cardSales': round(float(r[6] or 0), 2),
                'cashLiters': round(float(r[7] or 0), 2),
                'cardLiters': round(float(r[8] or 0), 2),
                'bonus': round(float(r[9] or 0), 2),
                'bonusCost': round(float(r[9] or 0), 2),
            })

        # 站点同比环比 - 批量查询（2次代替 N*2 次）
        # 上月所有站点
        prev_start, prev_end = get_query_date_range(dates['prev'], exclude_today=False)
        yoy_start, yoy_end = get_query_date_range(dates['yoy'], exclude_today=False)
        cur.execute(f"""
            SELECT s.ShopKey, {report_volume_expr("s")} as vol, {report_amount_expr("s")} as amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {business_period_condition_with_pruning("s", "sh")}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
        """, business_period_params(prev_start, prev_end))
        prev_shop_data = {r[0]: {'vol': float(r[1] or 0), 'amt': float(r[2] or 0)} for r in cur.fetchall()}
        # 去年同月所有站点
        cur.execute(f"""
            SELECT s.ShopKey, {report_volume_expr("s")} as vol, {report_amount_expr("s")} as amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {business_period_condition_with_pruning("s", "sh")}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
        """, business_period_params(yoy_start, yoy_end))
        yoy_shop_data = {r[0]: {'vol': float(r[1] or 0), 'amt': float(r[2] or 0)} for r in cur.fetchall()}

        for st in stations_data:
            sk = st['shopKey']
            prev_d = prev_shop_data.get(sk, {'vol': 0, 'amt': 0})
            yoy_d = yoy_shop_data.get(sk, {'vol': 0, 'amt': 0})
            st['momVolume'] = calc_change(st['volume'], prev_d['vol'])
            st['momSales'] = calc_change(st['amount'], prev_d['amt'])
            st['yoyVolume'] = calc_change(st['volume'], yoy_d['vol'])
            st['yoySales'] = calc_change(st['amount'], yoy_d['amt'])

        # ---- 按区域汇总 ----
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

        # 区域同比环比 - 直接复用已查询的站点同比环比数据，无需重复查询
        for rgn_name, rgn_data in regions.items():
            rgn_shopkeys = [sk for sk, info in SHOP_KEY_MAP.items() if info['region'] == rgn_name]
            prev_vol = sum(prev_shop_data.get(sk, {}).get('vol', 0) for sk in rgn_shopkeys)
            prev_amt = sum(prev_shop_data.get(sk, {}).get('amt', 0) for sk in rgn_shopkeys)
            yoy_vol = sum(yoy_shop_data.get(sk, {}).get('vol', 0) for sk in rgn_shopkeys)
            yoy_amt = sum(yoy_shop_data.get(sk, {}).get('amt', 0) for sk in rgn_shopkeys)
            regions[rgn_name]['momVolume'] = calc_change(rgn_data['volume'], prev_vol)
            regions[rgn_name]['momSales'] = calc_change(rgn_data['amount'], prev_amt)
            regions[rgn_name]['yoyVolume'] = calc_change(rgn_data['volume'], yoy_vol)
            regions[rgn_name]['yoySales'] = calc_change(rgn_data['amount'], yoy_amt)

        # ---- 油品维度汇总 ----
        resource_key = resource_key_expr("s")
        total_volume = report_volume_expr("s")
        total_amount = report_amount_expr("s")
        cur.execute(f"""
            SELECT {resource_key} as resource_key, {total_volume} as total_vol, {total_amount} as total_amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY resource_key
        """, business_period_params(ym_start, ym_end))
        by_resource = format_resource_rows(cur.fetchall())
        business_day = business_date_expr("s", "sh")
        cur.execute(f"""
            SELECT
                {business_day} as day,
                {resource_key} as resource_key,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY day, resource_key
            ORDER BY day, resource_key
        """, business_period_params(ym_start, ym_end))
        daily_resource = []
        for r in cur.fetchall():
            rk = int(r[1] or 0)
            if rk < 100:
                continue
            daily_resource.append({
                'date': str(r[0]),
                'resourceKey': canonical_resource_key(rk),
                'volume': round(float(r[2] or 0), 3),
                'amount': round(float(r[3] or 0), 2),
            })

        # ---- 每日趋势 ----
        business_day = business_date_expr("s", "sh")
        cur.execute(f"""
            SELECT
                {business_day} as day,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY day
            ORDER BY day
        """, business_period_params(ym_start, ym_end))
        daily = []
        for r in cur.fetchall():
            daily.append({
                'date': str(r[0]),
                'volume': round(float(r[1] or 0), 2),
                'amount': round(float(r[2] or 0), 2),
            })

        result = {
            'month': year_month,
            'summary': summary,
            'comparison': comparison,
            'stations': stations_data,
            'regions': regions,
            'byResource': by_resource,
            'daily': daily,
        }
        _attach_monthly_finance_metrics(result, daily_resource)
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


# ===== API: 获取单个站点月度详细（含同比环比） =====
@analytics_api.route('/api/station/<year_month>/<shop_key>')
def api_station_monthly(year_month, shop_key):
    cache_key = f'station:{year_month}:{shop_key}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        shop_key = int(shop_key)
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start, ym_end = get_query_date_range(year_month)

        # 站点汇总
        period_condition = business_period_condition_with_pruning("s", "sh")
        cur.execute(f"""
            SELECT
                COUNT(*) as txn_count,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales,
                SUM(s.ShopBaseCost) as total_base,
                {report_cash_amount_expr("s")} as cash_sales,
                {report_card_amount_expr("s")} as card_sales,
                {report_cash_volume_expr("s")} as cash_liters,
                {report_card_volume_expr("s")} as card_liters,
                {report_bonus_amount_expr("s")} as bonus_cost
            FROM selling s
            {shift_join("s", "sh")}
            WHERE s.ShopKey = %s
              AND {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
        """, (shop_key, *business_period_params(ym_start, ym_end)))
        r = cur.fetchone()
        info = SHOP_KEY_MAP.get(shop_key, {'name': f'Station-{shop_key}', 'short': '', 'region': 'unknown'})

        summary = {
            'txnCount': int(r[0] or 0),
            'volume': round(float(r[1] or 0), 2),
            'amount': round(float(r[2] or 0), 2),
            'baseCost': round(float(r[3] or 0), 2),
            'cashSales': round(float(r[4] or 0), 2),
            'cardSales': round(float(r[5] or 0), 2),
            'cashLiters': round(float(r[6] or 0), 2),
            'cardLiters': round(float(r[7] or 0), 2),
            'bonus': round(float(r[8] or 0), 2),
            'bonusCost': round(float(r[8] or 0), 2),
        }

        # 同比环比
        dates = calc_yoy_mom(y, m)
        prev_data = {}
        yoy_data = {}
        for label, dt in [('prev', dates['prev']), ('yoy', dates['yoy'])]:
            dt_start, dt_end = get_query_date_range(dt, exclude_today=False)
            cur.execute(f"""
                SELECT {report_volume_expr("s")}, {report_amount_expr("s")},
                       {report_cash_amount_expr("s")},
                       {report_card_amount_expr("s")}
                FROM selling s
                {shift_join("s", "sh")}
                WHERE s.ShopKey = %s
                  AND {business_period_condition_with_pruning("s", "sh")}
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            """, (shop_key, *business_period_params(dt_start, dt_end)))
            row = cur.fetchone()
            d = {
                'volume': round(float(row[0] or 0), 2),
                'amount': round(float(row[1] or 0), 2),
                'cashSales': round(float(row[2] or 0), 2),
                'cardSales': round(float(row[3] or 0), 2),
            }
            if label == 'prev':
                prev_data = d
            else:
                yoy_data = d

        def pct(cur, prev):
            if not prev or prev <= 0:
                return None
            return round((cur - prev) / prev * 100, 1)

        comparison = {
            'mom': {
                'volume': pct(summary['volume'], prev_data.get('volume')),
                'amount': pct(summary['amount'], prev_data.get('amount')),
                'cashSales': pct(summary['cashSales'], prev_data.get('cashSales')),
                'cardSales': pct(summary['cardSales'], prev_data.get('cardSales')),
                'prev': prev_data,
                'prevMonth': dates['prev'],
            },
            'yoy': {
                'volume': pct(summary['volume'], yoy_data.get('volume')),
                'amount': pct(summary['amount'], yoy_data.get('amount')),
                'cashSales': pct(summary['cashSales'], yoy_data.get('cashSales')),
                'cardSales': pct(summary['cardSales'], yoy_data.get('cardSales')),
                'yoy': yoy_data,
                'yoyMonth': dates['yoy'],
            },
        }

        # 每日趋势
        business_day = business_date_expr("s", "sh")
        cur.execute(f"""
            SELECT
                {business_day} as day,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales,
                {report_cash_amount_expr("s")} as cash_sales,
                {report_card_amount_expr("s")} as card_sales
            FROM selling s
            {shift_join("s", "sh")}
            WHERE s.ShopKey = %s
              AND {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY day
            ORDER BY day
        """, (shop_key, *business_period_params(ym_start, ym_end)))
        daily = [{
            'date': str(r2[0]),
            'volume': round(float(r2[1] or 0), 2),
            'amount': round(float(r2[2] or 0), 2),
            'cashSales': round(float(r2[3] or 0), 2),
            'cardSales': round(float(r2[4] or 0), 2),
        } for r2 in cur.fetchall()]

        resource_key = resource_key_expr("s")
        total_volume = report_volume_expr("s")
        total_amount = report_amount_expr("s")
        cur.execute(f"""
            SELECT {resource_key} as resource_key, {total_volume} as total_vol, {total_amount} as total_amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE s.ShopKey = %s
              AND {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY resource_key
        """, (shop_key, *business_period_params(ym_start, ym_end)))
        by_resource = format_resource_rows(cur.fetchall())

        result = {
            'month': year_month,
            'shopKey': shop_key,
            'name': info['name'],
            'short': info['short'],
            'region': info['region'],
            'status': station_status_for(shop_key, summary['amount']),
            'closedReason': CLOSED_STATIONS.get(shop_key, ''),
            'summary': summary,
            'comparison': comparison,
            'byResource': by_resource,
            'daily': daily,
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()



@analytics_api.route('/api/stations/<year_month>')
def api_stations(year_month):
    """返回当月所有站点数据，用于首页地图和排行榜"""
    cache_key = f'stations:{year_month}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        ym_start, ym_end = get_query_date_range(year_month)

        period_condition = business_period_condition_with_pruning("s", "sh")
        cur.execute(f"""
            SELECT
                s.ShopKey,
                COUNT(*) as txn_count,
                {report_volume_expr("s")} as total_liters,
                {report_amount_expr("s")} as total_sales,
                {report_cash_amount_expr("s")} as cash_sales,
                {report_card_amount_expr("s")} as card_sales,
                {report_cash_volume_expr("s")} as cash_liters,
                {report_card_volume_expr("s")} as card_liters,
                {report_bonus_amount_expr("s")} as bonus_cost
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
        """, business_period_params(ym_start, ym_end))

        # 先收集有销售记录的站点
        sales_data = {}
        for r in cur.fetchall():
            sales_data[r[0]] = {
                'txnCount': int(r[1] or 0),
                'volume': round(float(r[2] or 0), 2),
                'amount': round(float(r[3] or 0), 2),
                'cash': round(float(r[4] or 0), 2),
                'card': round(float(r[5] or 0), 2),
                'cashLiters': round(float(r[6] or 0), 2),
                'cardLiters': round(float(r[7] or 0), 2),
                'bonus': round(float(r[8] or 0), 2),
            }

        # 遍历所有站点（包括停业的）
        stations_list = []
        for sk, info in SHOP_KEY_MAP.items():
            coords = SHOP_COORDS.get(sk, {'lng': 0, 'lat': 0})
            sd = sales_data.get(sk, {})
            stations_list.append({
                'shopKey': sk,
                'name': info['name'],
                'short': info['short'],
                'region': info['region'],
                'lng': coords.get('lng', 0),
                'lat': coords.get('lat', 0),
                'txnCount': sd.get('txnCount', 0),
                'volume': sd.get('volume', 0),
                'amount': sd.get('amount', 0),
                'cash': sd.get('cash', 0),
                'card': sd.get('card', 0),
                'cashLiters': sd.get('cashLiters', 0),
                'cardLiters': sd.get('cardLiters', 0),
                'bonus': sd.get('bonus', 0),
                'status': station_status_for(sk, sd.get('amount', 0)),
                'closedReason': CLOSED_STATIONS.get(sk, ''),
            })

        result = {
            'month': year_month,
            'stations': stations_list,
            'depots': [
                {'name': k, 'short': v['short'], 'region': v['region'], 'lng': v['lng'], 'lat': v['lat'],
                 'type': 'depot', 'status': v.get('status', 'normal'),
                 'closedReason': v.get('closedReason', '')}
                for k, v in DEPOT_COORDS.items()
            ],
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


# ===== API: 每日汇总（按站点+按日期） =====
@analytics_api.route('/api/daily/<year_month>')
def api_daily(year_month):
    """返回当月所有站点的每日销售汇总，用于趋势图"""
    cache_key = f'daily:{year_month}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        ym_start, ym_end = get_query_date_range(year_month)

        # 全网每日汇总
        period_condition = business_period_condition_with_pruning("s", "sh")
        business_day = business_date_expr("s", "sh")
        cur.execute(f"""
            SELECT {business_day} as dt,
                   {report_volume_expr("s")} as vol, {report_amount_expr("s")} as amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY dt ORDER BY dt
        """, business_period_params(ym_start, ym_end))
        daily = [{'date': str(r[0]), 'volume': round(float(r[1] or 0), 2), 'amount': round(float(r[2] or 0), 2)} for r in cur.fetchall()]

        # 每个站点的每日汇总
        cur.execute(f"""
            SELECT s.ShopKey, {business_day} as dt,
                   {report_volume_expr("s")} as vol, {report_amount_expr("s")} as amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey, dt ORDER BY s.ShopKey, dt
        """, business_period_params(ym_start, ym_end))

        stations_daily = {}
        for r in cur.fetchall():
            sk = r[0]
            if sk not in stations_daily:
                stations_daily[sk] = []
            stations_daily[sk].append({'date': str(r[1]), 'volume': round(float(r[2] or 0), 2), 'amount': round(float(r[3] or 0), 2)})

        result = {'month': year_month, 'daily': daily, 'stations': stations_daily}
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()


# ===== API: 区域汇总 =====
@analytics_api.route('/api/regions/<year_month>')
def api_regions(year_month):
    """返回当月各区域汇总数据（含同比环比）"""
    cache_key = f'regions:{year_month}'
    cached = get_cached(cache_key)
    if cached and cache_allowed():
        if _attach_region_snapshot_comparisons(year_month, cached):
            set_cached(cache_key, cached)
        return jsonify(cached)

    conn = get_connection()
    try:
        cur = conn.cursor()
        y, m = int(year_month.split('-')[0]), int(year_month.split('-')[1])
        ym_start, ym_end = get_query_date_range(year_month)
        dates = calc_yoy_mom(y, m)

        # 当月区域汇总（含现金/刷卡分拆）
        period_condition = business_period_condition_with_pruning("s", "sh")
        cur.execute(f"""
            SELECT s.ShopKey,
                   {report_volume_expr("s")} as vol,
                   {report_amount_expr("s")} as amt,
                   {report_cash_amount_expr("s")} as cash_sales,
                   {report_card_amount_expr("s")} as card_sales,
                   {report_bonus_amount_expr("s")} as bonus_cost
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
        """, business_period_params(ym_start, ym_end))
        shop_data = cur.fetchall()

        regions = {}
        for r in shop_data:
            sk = r[0]
            info = SHOP_KEY_MAP.get(sk, {'name': f'Station-{sk}', 'region': 'unknown'})
            rgn = info['region']
            if rgn not in regions:
                regions[rgn] = {'amount': 0, 'volume': 0, 'cash': 0, 'card': 0, 'bonus': 0, 'stationCount': 0, 'activeCount': 0}
            regions[rgn]['amount'] += float(r[2] or 0)
            regions[rgn]['volume'] += float(r[1] or 0)
            regions[rgn]['cash'] += float(r[3] or 0)
            regions[rgn]['card'] += float(r[4] or 0)
            regions[rgn]['bonus'] += float(r[5] or 0)
            regions[rgn]['activeCount'] += 1

        # 计算每个区域的总站数（所有站点，不管有没有销售）
        for sk, info in SHOP_KEY_MAP.items():
            rgn = info['region']
            if rgn in regions:
                regions[rgn]['stationCount'] += 1
            else:
                regions[rgn] = {'amount': 0, 'volume': 0, 'cash': 0, 'card': 0, 'bonus': 0, 'stationCount': 1, 'activeCount': 0}

        # 环比同比
        def calc_change(cur_val, prev_val):
            if not prev_val or prev_val == 0:
                return 0
            return round((cur_val - prev_val) / prev_val * 100, 1)

        for label, dt in [('mom', dates['prev']), ('yoy', dates['yoy'])]:
            dt_start, dt_end = get_query_date_range(dt, exclude_today=False)
            cur.execute(f"""
                SELECT s.ShopKey, {report_volume_expr("s")} as vol, {report_amount_expr("s")} as amt
                FROM selling s
                {shift_join("s", "sh")}
                WHERE {business_period_condition_with_pruning("s", "sh")}
                  AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
                GROUP BY s.ShopKey
            """, business_period_params(dt_start, dt_end))
            prev_shop = cur.fetchall()

            prev_regions = {}
            for r in prev_shop:
                sk = r[0]
                info = SHOP_KEY_MAP.get(sk, {'region': 'unknown'})
                rgn = info['region']
                if rgn not in prev_regions:
                    prev_regions[rgn] = {'amount': 0, 'volume': 0}
                prev_regions[rgn]['amount'] += float(r[2] or 0)
                prev_regions[rgn]['volume'] += float(r[1] or 0)

            for rgn_name, rgn_data in regions.items():
                prev_rgn = prev_regions.get(rgn_name, {'amount': 0, 'volume': 0})
                amt_chg = calc_change(rgn_data['amount'], prev_rgn['amount'])
                vol_chg = calc_change(rgn_data['volume'], prev_rgn['volume'])
                if label == 'mom':
                    regions[rgn_name]['momSales'] = amt_chg
                    regions[rgn_name]['momVolume'] = vol_chg
                else:
                    regions[rgn_name]['yoySales'] = amt_chg
                    regions[rgn_name]['yoyVolume'] = vol_chg

        resource_key = resource_key_expr("s")
        total_volume = report_volume_expr("s")
        total_amount = report_amount_expr("s")
        cur.execute(f"""
            SELECT s.ShopKey, {resource_key} as resource_key, {total_volume} as vol, {total_amount} as amt
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {period_condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey, resource_key
        """, business_period_params(ym_start, ym_end))
        region_resource_rows = {}
        for shop_key, rk, vol, amt in cur.fetchall():
            rk = canonical_resource_key(rk)
            if rk < 100 or rk not in KNOWN_RESOURCE_KEYS:
                continue
            info = SHOP_KEY_MAP.get(shop_key, {'region': 'unknown'})
            bucket = region_resource_rows.setdefault(info['region'], {})
            item = bucket.setdefault(rk, [0.0, 0.0])
            item[0] += float(vol or 0)
            item[1] += float(amt or 0)
        by_resource_by_region = {
            region: format_resource_rows([(rk, vals[0], vals[1]) for rk, vals in rows.items()])
            for region, rows in region_resource_rows.items()
        }
        by_resource = format_resource_rows([
            (rk, sum(rows.get(rk, [0, 0])[0] for rows in region_resource_rows.values()),
             sum(rows.get(rk, [0, 0])[1] for rows in region_resource_rows.values()))
            for rk in {rk for rows in region_resource_rows.values() for rk in rows}
        ])

        result = {
            'month': year_month,
            'regions': regions,
            'byResource': by_resource,
            'byResourceByRegion': by_resource_by_region,
        }
        set_cached(cache_key, result)
        return jsonify(result)
    finally:
        conn.close()
