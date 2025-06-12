# -*- coding: utf-8 -*-

SHOP_KEY_MAP = {
    1: {'name': 'S01', 'short': 'S01', 'region': 'REG-02'},
    2: {'name': 'S02', 'short': 'S02', 'region': 'REG-03'},
    3: {'name': 'S03', 'short': 'S03', 'region': 'REG-04'},
    4: {'name': 'S04', 'short': 'S04', 'region': 'REG-05'},
    5: {'name': 'S05', 'short': 'S05', 'region': 'REG-06'},
    6: {'name': 'S06', 'short': 'S06', 'region': 'REG-07'},
    7: {'name': 'S07', 'short': 'S07', 'region': 'REG-01'},
    8: {'name': 'S08', 'short': 'S08', 'region': 'REG-02'},
    9: {'name': 'S09', 'short': 'S09', 'region': 'REG-03'},
    10: {'name': 'S10', 'short': 'S10', 'region': 'REG-04'},
    11: {'name': 'S11', 'short': 'S11', 'region': 'REG-05'},
    12: {'name': 'S12', 'short': 'S12', 'region': 'REG-06'},
    13: {'name': 'S13', 'short': 'S13', 'region': 'REG-07'},
    14: {'name': 'S14', 'short': 'S14', 'region': 'REG-01'},
    15: {'name': 'S15', 'short': 'S15', 'region': 'REG-02'},
    16: {'name': 'S16', 'short': 'S16', 'region': 'REG-03'},
    17: {'name': 'S17', 'short': 'S17', 'region': 'REG-04'},
    18: {'name': 'S18', 'short': 'S18', 'region': 'REG-05'},
    19: {'name': 'S19', 'short': 'S19', 'region': 'REG-06'},
    20: {'name': 'S20', 'short': 'S20', 'region': 'REG-07'},
    21: {'name': 'S21', 'short': 'S21', 'region': 'REG-01'},
    22: {'name': 'S22', 'short': 'S22', 'region': 'REG-02'},
    23: {'name': 'S23', 'short': 'S23', 'region': 'REG-03'},
    24: {'name': 'S24', 'short': 'S24', 'region': 'REG-04'},
    25: {'name': 'S25', 'short': 'S25', 'region': 'REG-05'},
    26: {'name': 'S26', 'short': 'S26', 'region': 'REG-06'},
    27: {'name': 'S27', 'short': 'S27', 'region': 'REG-07'},
    28: {'name': 'S28', 'short': 'S28', 'region': 'REG-01'},
    29: {'name': 'S29', 'short': 'S29', 'region': 'REG-02'},
    30: {'name': 'S30', 'short': 'S30', 'region': 'REG-03'},
}

# 站点状态（停业站点，不计入活跃站）
CLOSED_STATIONS = {
    11: '修路占道，无法营业',
    12: '修路占道，无法营业',
    21: '停业，库存清零',
}

# 正式报表不直接展示停业站明细，但汇总口径仍保留原始数据。
REPORT_HIDDEN_STATION_KEYS = set(CLOSED_STATIONS.keys())
REPORT_HIDDEN_STATION_NOTE = '备注：11、12、21这三个加油站停业，暂时无法恢复营业。'

MAP_ZERO_INVENTORY_STATIONS = {11, 12, 21}

FORCE_NORMAL_STATIONS = {2, 29}

# 装修停业但仍需沿用最近库存快照的站点：
# 若进入新月份后仍无新班次/无销售，则月初起初量取月初前最新一期末量，
# 且当月期末量在无新快照时与起初量保持一致。
RENOVATION_CARRY_FORWARD_STATIONS = set()

# 站点地理坐标（用于地图展示）
SHOP_COORDS = {
    1: {'lng': 0, 'lat': 0},
    2: {'lng': 0, 'lat': 0},
    3: {'lng': 0, 'lat': 0},
    4: {'lng': 0, 'lat': 0},
    5: {'lng': 0, 'lat': 0},
    6: {'lng': 0, 'lat': 0},
    7: {'lng': 0, 'lat': 0},
    8: {'lng': 0, 'lat': 0},
    9: {'lng': 0, 'lat': 0},
    10: {'lng': 0, 'lat': 0},
    11: {'lng': 0, 'lat': 0},
    12: {'lng': 0, 'lat': 0},
    13: {'lng': 0, 'lat': 0},
    14: {'lng': 0, 'lat': 0},
    15: {'lng': 0, 'lat': 0},
    16: {'lng': 0, 'lat': 0},
    17: {'lng': 0, 'lat': 0},
    18: {'lng': 0, 'lat': 0},
    19: {'lng': 0, 'lat': 0},
    20: {'lng': 0, 'lat': 0},
    21: {'lng': 0, 'lat': 0},
    22: {'lng': 0, 'lat': 0},
    23: {'lng': 0, 'lat': 0},
    24: {'lng': 0, 'lat': 0},
    25: {'lng': 0, 'lat': 0},
    26: {'lng': 0, 'lat': 0},
    27: {'lng': 0, 'lat': 0},
    28: {'lng': 0, 'lat': 0},
    29: {'lng': 0, 'lat': 0},
    30: {'lng': 0, 'lat': 0},
}

# 油库坐标（2026-09-28 按 WPS 加油站清单统一：D-0X 总部 / D-0X CTY-22 / D-0X REG-08）
DEPOT_COORDS = {
    'D-01': {'lng': 0, 'lat': 0},
    'D-02': {'lng': 0, 'lat': 0},
    'D-03': {'lng': 0, 'lat': 0},
}


