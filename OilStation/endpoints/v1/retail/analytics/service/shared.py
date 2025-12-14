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
from export_excel import RESOURCE_DENSITY, SK4_RSK_MAP, SK6_RSK_MAP, SK28_RSK_MAP, SK29_RSK_MAP, STATION_RK_CORRECTIONS

from endpoints.v1.retail.common.query import calc_yoy_mom, get_query_date_range, query_month_summary

RESOURCE_NAMES = {
    102: 'АИ 80',
    103: 'АИ 92',
    104: 'АИ 95',
    106: 'Д/Т',
    108: 'СПБТ',
    109: 'Д/Т',
    110: 'ДТ -35',
}
RESOURCE_COLORS = {
    102: '#00e5a0',
    103: '#00d4ff',
    104: '#a78bfa',
    106: '#ffa726',
    108: '#ff6b6b',
    109: '#ffb74d',
    110: '#ff8a65',
}
RESOURCE_ORDER = [102, 103, 104, 106, 110, 108]
RESOURCE_ORDER_INDEX = {rk: index for index, rk in enumerate(RESOURCE_ORDER)}
RESOURCE_ALIASES = {
    109: 106,
}
KNOWN_RESOURCE_KEYS = set(RESOURCE_NAMES)

def station_status_for(shop_key, amount):
    if shop_key in CLOSED_STATIONS:
        return 'closed'
    if shop_key in FORCE_NORMAL_STATIONS:
        return 'normal'
    return 'normal' if amount > 0 else 'closed'


def resource_key_expr(alias="s"):
    return report_resource_key_expr(alias)


def canonical_resource_key(resource_key):
    try:
        rk = int(resource_key or 0)
    except (TypeError, ValueError):
        return 0
    return RESOURCE_ALIASES.get(rk, rk)


def add_resource_bucket(target, resource_key, volume, amount):
    rk = canonical_resource_key(resource_key)
    if rk < 100 or rk not in KNOWN_RESOURCE_KEYS:
        return
    bucket = target.setdefault(rk, {'volume': 0.0, 'amount': 0.0})
    bucket['volume'] += float(volume or 0)
    bucket['amount'] += float(amount or 0)


def report_volume_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND {alias}.BasePaymentTypeKey IN (1, 2) THEN {alias}.Volume ELSE 0 END) "
        f"+ SUM(CASE WHEN {alias}.DerivedPaymentTypeKey = 3 THEN {alias}.Volume ELSE 0 END)"
    )


def report_amount_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND {alias}.BasePaymentTypeKey IN (1, 2) THEN {alias}.ShopCost ELSE 0 END) "
        f"+ SUM(CASE WHEN {alias}.DerivedPaymentTypeKey = 3 THEN {alias}.ShopCost ELSE 0 END)"
    )


def report_cash_amount_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND {alias}.BasePaymentTypeKey = 1 "
        f" AND COALESCE({alias}.DerivedPaymentTypeKey, 0) <> 5 THEN {alias}.ShopCost ELSE 0 END)"
    )


def report_card_amount_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND ({alias}.BasePaymentTypeKey = 2 OR {alias}.DerivedPaymentTypeKey = 5) "
        f"THEN {alias}.ShopCost ELSE 0 END)"
    )


def report_cash_volume_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND {alias}.BasePaymentTypeKey = 1 "
        f" AND COALESCE({alias}.DerivedPaymentTypeKey, 0) <> 5 THEN {alias}.Volume ELSE 0 END)"
    )


def report_card_volume_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f" AND ({alias}.BasePaymentTypeKey = 2 OR {alias}.DerivedPaymentTypeKey = 5) "
        f"THEN {alias}.Volume ELSE 0 END)"
    )


def report_bonus_amount_expr(alias="s"):
    return (
        "SUM(CASE "
        f"WHEN ({alias}.DerivedPaymentTypeKey IS NULL OR {alias}.DerivedPaymentTypeKey NOT IN (2, 3, 4)) "
        f"THEN COALESCE({alias}.BonusOutCost, 0) ELSE 0 END)"
    )


def report_resource_key_expr(alias="s"):
    return (
        "CASE "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 7 THEN 102 "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 8 THEN 103 "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 9 THEN 104 "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 10 THEN 109 "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 11 THEN 110 "
        f"WHEN {alias}.ShopKey = 28 AND {alias}.ResourceShopKey = 12 THEN 108 "
        f"WHEN {alias}.ShopKey = 6 AND {alias}.ResourceShopKey = 1 THEN 103 "
        f"WHEN {alias}.ShopKey = 6 AND {alias}.ResourceShopKey = 2 THEN 104 "
        f"WHEN {alias}.ShopKey = 6 AND {alias}.ResourceShopKey = 3 THEN 102 "
        f"WHEN {alias}.ShopKey = 6 AND {alias}.ResourceShopKey = 5 THEN 106 "
        f"WHEN {alias}.ShopKey = 4 AND {alias}.ResourceShopKey = 1 THEN 103 "
        f"WHEN {alias}.ShopKey = 4 AND {alias}.ResourceShopKey = 2 THEN 104 "
        f"WHEN {alias}.ShopKey = 4 AND {alias}.ResourceShopKey = 5 THEN 106 "
        f"WHEN {alias}.ShopKey = 4 AND {alias}.ResourceShopKey = 7 THEN 108 "
        f"WHEN {alias}.ShopKey = 29 AND {alias}.ResourceShopKey = 7 THEN 103 "
        f"WHEN {alias}.ShopKey = 29 AND {alias}.ResourceShopKey = 8 THEN 102 "
        f"WHEN {alias}.ShopKey = 29 AND {alias}.ResourceShopKey = 9 THEN 106 "
        f"WHEN {alias}.ShopKey = 29 AND {alias}.ResourceShopKey = 10 THEN 108 "
        f"WHEN {alias}.ShopKey = 30 AND {alias}.ResourceShopKey = 7 THEN 103 "
        f"WHEN {alias}.ShopKey = 30 AND {alias}.ResourceShopKey = 8 THEN 102 "
        f"WHEN {alias}.ShopKey = 30 AND {alias}.ResourceShopKey = 9 THEN 106 "
        f"WHEN {alias}.ShopKey IN (7, 15) AND {alias}.ResourceKey = 104 THEN 102 "
        f"WHEN {alias}.ResourceKey IN (102, 103, 104, 106, 108, 109, 110) THEN {alias}.ResourceKey "
        f"WHEN {alias}.BasePrice <= 0 THEN {alias}.ResourceKey "
        f"WHEN {alias}.BasePrice <= 45 THEN 108 "
        f"WHEN {alias}.BasePrice <= 65 THEN 102 "
        f"WHEN {alias}.BasePrice <= 78 THEN 103 "
        f"WHEN {alias}.BasePrice <= 83 THEN 104 "
        "ELSE 106 "
        "END"
    )


def calc_change(current, previous):
    if not previous or previous <= 0:
        return None
    return round((float(current or 0) - float(previous or 0)) / float(previous) * 100, 1)


def format_resource_rows(rows):
    merged = {}
    for row in rows:
        add_resource_bucket(merged, row[0], row[1], row[2])
    result = []
    for rk, values in merged.items():
        volume = round(values['volume'], 2)
        amount = round(values['amount'], 2)
        result.append({
            'resourceKey': rk,
            'key': rk,
            'name': RESOURCE_NAMES.get(rk, f'Other-{rk}'),
            'volume': volume,
            'amount': amount,
            'color': RESOURCE_COLORS.get(rk, '#999999'),
        })
    result.sort(key=lambda item: RESOURCE_ORDER_INDEX.get(item['key'], 999))
    return result


def infer_balance_resource_key(shop_key, resource_key, price=None, resource_shop_key=None):
    try:
        sk = int(shop_key or 0)
        rk = int(resource_key or 0)
    except (TypeError, ValueError):
        return 0
    try:
        rsk = int(resource_shop_key or 0)
    except (TypeError, ValueError):
        rsk = 0

    if sk == 28 and rsk in SK28_RSK_MAP:
        return canonical_resource_key(SK28_RSK_MAP[rsk])
    if sk == 6 and rsk in SK6_RSK_MAP:
        return canonical_resource_key(SK6_RSK_MAP[rsk])
    if sk == 4 and rsk in SK4_RSK_MAP:
        return canonical_resource_key(SK4_RSK_MAP[rsk])
    if sk == 29 and rsk in SK29_RSK_MAP:
        return canonical_resource_key(SK29_RSK_MAP[rsk])
    corrected = STATION_RK_CORRECTIONS.get((sk, rk))
    if corrected:
        return canonical_resource_key(corrected)
    if rk in KNOWN_RESOURCE_KEYS:
        return canonical_resource_key(rk)

    try:
        p = float(price or 0)
    except (TypeError, ValueError):
        p = 0
    if p <= 0:
        return 0
    if p <= 45:
        return 108
    if p <= 65:
        return 102
    if p <= 78:
        return 103
    if p <= 83:
        return 104
    return 106


def _to_float(value):
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _station_key_from_report_cell(value):
    try:
        station_key = int(float(value))
    except (TypeError, ValueError):
        return None
    return station_key if station_key in SHOP_KEY_MAP else None


def _resource_key_from_report_name(value):
    name = str(value or "").strip().lower()
    if not name:
        return 0
    if "-35" in name:
        return 110
    if "спбт" in name or "сжиж" in name:
        return 108
    if "95" in name:
        return 104
    if "92" in name:
        return 103
    if "80" in name:
        return 102
    if "д/т" in name or "диз" in name:
        return 106
    return 0
def add_resource_tons(resources):
    total = 0.0
    for item in resources:
        density = RESOURCE_DENSITY.get(int(item.get("resourceKey") or item.get("key") or 0), 0)
        tons = round(float(item.get("volume") or 0) * density / 1000, 3)
        item["tons"] = tons
        total += tons
    return round(total, 3)
