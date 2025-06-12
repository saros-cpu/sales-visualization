from datetime import date


SYSTEM_USER = "system"


PRODUCTS = [
    {"code": "AI80", "display_name": "80#汽油Бензин", "category": "汽油", "retail_resource_key": 102},
    {"code": "AI92", "display_name": "92#汽油Бензин", "category": "汽油", "retail_resource_key": 103},
    {"code": "AI95", "display_name": "95#汽油Бензин", "category": "汽油", "retail_resource_key": 104},
    {"code": "LPG", "display_name": "液化气ГАЗ", "category": "液化气", "retail_resource_key": 108},
    {"code": "DIESEL_K5", "display_name": "合格柴油Диз Топливо K5", "category": "柴油", "retail_resource_key": 106},
    {"code": "DIESEL_K3", "display_name": "合格柴油Диз Топливо", "category": "柴油", "retail_resource_key": 106},
    {"code": "DIESEL_REGULAR", "display_name": "合格柴油Диз Топливо（常柴）", "category": "柴油", "retail_resource_key": None},
    {"code": "HEATING_FUEL", "display_name": "催化柴油Печное Топливо", "category": "其他油品", "retail_resource_key": None},
    {"code": "MAZUT", "display_name": "油浆Топочный Мазут", "category": "其他油品", "retail_resource_key": None},
    {"code": "MMA", "display_name": "MMA 氮甲基苯胺", "category": "化工品", "retail_resource_key": None},
]


PRODUCT_ALIASES = [
    ("AI80", "80#汽油Бензин"),
    ("AI80", "80#"),
    ("AI92", "92#汽油Бензин"),
    ("AI92", "92#"),
    ("AI95", "95#汽油Бензин"),
    ("AI95", "95#"),
    ("LPG", "液化气ГАЗ"),
    ("LPG", "ГАЗ 液化气"),
    ("DIESEL_K5", "合格柴油Диз Топливо K5"),
    ("DIESEL_K5", "Д.Т. K5"),
    ("DIESEL_K5", "K5 -15"),
    ("DIESEL_K3", "合格柴油Диз Топливо"),
    ("DIESEL_K3", "Д.Т. K3"),
    ("DIESEL_K3", "合格柴油Диз Топливо（常柴）"),
    ("HEATING_FUEL", "催化柴油Печное Топливо"),
    ("HEATING_FUEL", "П.Т. 催柴"),
    ("MAZUT", "油浆топочныйМазут"),
    ("MAZUT", "油浆Топочный Мазут"),
    ("MAZUT", "М.Т. 油浆"),
    ("MMA", "MMA 氮甲基苯胺"),
]


# Initial densities mirror OilStation/export_excel.py. Later user-entered
# densities take effect only from their own effective_date.
INITIAL_DENSITIES = [
    ("AI80", 0.76, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("AI92", 0.74, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("AI95", 0.75, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("LPG", 0.554, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("DIESEL_K5", 0.85, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("DIESEL_K3", 0.85, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
    ("DIESEL_REGULAR", 0.85, date(2023, 12, 1), "OilStation RESOURCE_DENSITY"),
]


ENTITY_ALIASES = [
    ("own_depot", "south_CTY-30_depot", "S-64", "S-64", 100),
    ("own_depot", "south_CTY-30_depot", "S-64", "S-64", 98),
    ("own_depot", "south_CTY-30_depot", "S-64", "АЗС Нефтебаза CTY-05", 95),
    ("own_depot", "south_CTY-30_depot", "S-64", "Нефтебаза CTY-05", 95),
    ("own_depot", "north_CTY-22-LAT_depot", "S-66", "Балыкч DemoDepot", 95),
    ("own_depot", "north_CTY-22-LAT_depot", "S-66", "S-66", 100),
    ("own_depot", "north_CTY-22-LAT_depot", "S-66", "CTY-20 DemoDepot", 95),
    ("own_depot", "north_CTY-22-LAT_depot", "S-66", "DemoDepot CTY-08", 95),
]
