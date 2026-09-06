# -*- coding: utf-8 -*-
"""站点油罐-油品固化映射 校验护栏。

用途：防止「罐换装 / 新罐未登记 / 价格漂移越界」再次引发静默错分。
      2026-08 液化气被错算进 АИ-80 的事故，本质是价格分桶兜底悄悄出错而无人察觉。

检查项：
  [1] 未登记罐告警：近 N 天(默认 90)有销量/入库、但不在固化映射中的 (站,罐)；
  [2] 价格漂移告警：已登记罐「近 N 天均价」与「前 N 天均价」落在不同价格桶
      ——提示调价越界或罐换装，需人工核实；均价与桶的绝对对比不告警
      （桶阈值会随调价过时，固化映射本身已不依赖桶）。

运行：python scripts/validate_tank_map.py [天数=90]
退出码：0 = 全部通过；1 = 存在告警（可用于定时任务监控）。
"""
import sys
import os
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import get_connection                              # noqa: E402
from export_excel import (                                 # noqa: E402
    STATION_TANK_RESOURCE_MAP,
    STATION_TANK_RESOURCE_MAP_PRIMARY,
)

BUCKETS = [(45, 108), (65, 102), (78, 103), (83, 104), (10**9, 106)]
CODE_NAMES = {102: 'АИ-80', 103: 'АИ-92', 104: 'АИ-95', 106: 'Д/Т',
              108: 'СПБТ(液化气)', 109: 'ДТ-15', 110: 'ДТ-35'}


def price_bucket(price):
    for limit, code in BUCKETS:
        if price <= limit:
            return code
    return 106


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 90
    d_today = date.today()
    d_start = d_today - timedelta(days=days)
    d_prev_start = d_start - timedelta(days=days)
    alerts = []

    conn = get_connection()
    cur = conn.cursor()

    all_mapped = {}
    all_mapped.update(STATION_TANK_RESOURCE_MAP_PRIMARY)
    all_mapped.update({k: v[0] for k, v in STATION_TANK_RESOURCE_MAP.items()})

    # 近期与上期各罐的均价/销量（selling）
    cur.execute(
        """
        SELECT s.ShopKey, s.ResourceShopKey,
               SUM(CASE WHEN s.TransactionDatetime >= %s THEN s.Volume ELSE 0 END),
               AVG(CASE WHEN s.TransactionDatetime >= %s THEN NULLIF(s.BasePrice, 0) END),
               SUM(CASE WHEN s.TransactionDatetime >= %s AND s.TransactionDatetime < %s THEN s.Volume ELSE 0 END),
               AVG(CASE WHEN s.TransactionDatetime >= %s AND s.TransactionDatetime < %s THEN NULLIF(s.BasePrice, 0) END)
        FROM selling s
        WHERE s.TransactionDatetime >= %s AND s.ResourceShopKey > 0
        GROUP BY s.ShopKey, s.ResourceShopKey
        """,
        (d_start, d_start, d_prev_start, d_start, d_prev_start, d_start, d_prev_start),
    )
    active = {}
    for sk, rsk, vol_now, avg_now, vol_prev, avg_prev in cur.fetchall():
        active[(int(sk), int(rsk))] = {
            'vol_now': float(vol_now or 0), 'avg_now': float(avg_now or 0),
            'vol_prev': float(vol_prev or 0), 'avg_prev': float(avg_prev or 0),
        }

    # [1] 未登记罐
    for (sk, rsk), v in sorted(active.items()):
        if (sk, rsk) not in all_mapped and (v['vol_now'] > 100 or v['vol_prev'] > 100):
            alerts.append(
                f'[未登记罐] SK{sk} 罐{rsk}: 近{days}天销量 {v["vol_now"]:,.0f} L'
                f'（上期 {v["vol_prev"]:,.0f} L）不在固化映射中，当前按价格分桶兜底推断，'
                f'请核实罐位油品并登记到 STATION_TANK_RESOURCE_MAP(_PRIMARY)'
            )

    # [2] 价格漂移（近期桶 vs 上期桶）
    for (sk, rsk), v in sorted(active.items()):
        if v['avg_now'] <= 0 or v['avg_prev'] <= 0:
            continue
        b_now, b_prev = price_bucket(v['avg_now']), price_bucket(v['avg_prev'])
        if b_now != b_prev:
            code = all_mapped.get((sk, rsk))
            code_name = f'（固化为 {CODE_NAMES.get(code, code)}）' if code else '（未固化）'
            alerts.append(
                f'[价格漂移] SK{sk} 罐{rsk}{code_name}: 均价由上期 {v["avg_prev"]:.1f}'
                f'({CODE_NAMES.get(b_prev, b_prev)}桶) 变为近期 {v["avg_now"]:.1f}'
                f'({CODE_NAMES.get(b_now, b_now)}桶)——若为调价请忽略，若为罐换装请更新映射'
            )

    # [3] supply 侧未登记罐
    cur.execute(
        """
        SELECT ShopKey, ResourceShopKey, SUM(Volume)
        FROM supply
        WHERE AcceptDateTime >= %s AND ResourceShopKey > 0
        GROUP BY ShopKey, ResourceShopKey
        """,
        (d_start,),
    )
    for sk, rsk, vol in cur.fetchall():
        if (int(sk), int(rsk)) not in all_mapped:
            alerts.append(
                f'[未登记罐-入库] SK{sk} 罐{rsk}: 近{days}天入库 {float(vol or 0):,.0f} L '
                f'不在固化映射中，入库推断将走动态表/价格兜底'
            )

    conn.close()

    print(f'=== 站点油罐映射校验（近 {days} 天）{date.today()} ===')
    print(f'映射登记: 前置权威 {len(STATION_TANK_RESOURCE_MAP_PRIMARY)} 条 + 固化兜底 '
          f'{len(STATION_TANK_RESOURCE_MAP)} 条；近期活跃罐 {len(active)} 个')
    if alerts:
        print(f'\n⚠ 告警 {len(alerts)} 条:')
        for a in alerts:
            print('  ' + a)
        sys.exit(1)
    print('\n✓ 全部通过：无未登记罐、无价格漂移')


if __name__ == '__main__':
    main()
