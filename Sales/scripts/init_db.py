from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from db import get_connection
from reference_data import ENTITY_ALIASES, INITIAL_DENSITIES, PRODUCT_ALIASES, PRODUCTS, SYSTEM_USER
from text_utils import normalize_station_name, normalize_text


def execute_sql_file(cur, path):
    sql = path.read_text(encoding="utf-8")
    statements = []
    current = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        current.append(line)
        if stripped.endswith(";"):
            statements.append("\n".join(current).rstrip(";"))
            current = []
    if current:
        statements.append("\n".join(current))

    for statement in statements:
        cur.execute(statement)


def seed_reference_data(cur):
    for item in PRODUCTS:
        cur.execute(
            """
            INSERT INTO products (product_code, display_name, category, retail_resource_key)
            VALUES (%s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                display_name = VALUES(display_name),
                category = VALUES(category),
                retail_resource_key = VALUES(retail_resource_key),
                is_active = TRUE
            """,
            (item["code"], item["display_name"], item["category"], item["retail_resource_key"]),
        )

    cur.execute("SELECT id, product_code FROM products")
    product_ids = {code: product_id for product_id, code in cur.fetchall()}

    for product_code, alias_name in PRODUCT_ALIASES:
        cur.execute(
            """
            INSERT INTO product_aliases (product_id, alias_name, normalized_alias, source)
            VALUES (%s, %s, %s, 'seed')
            ON DUPLICATE KEY UPDATE
                product_id = VALUES(product_id),
                alias_name = VALUES(alias_name)
            """,
            (product_ids[product_code], alias_name, normalize_text(alias_name)),
        )

    for product_code, density, effective_date, source in INITIAL_DENSITIES:
        cur.execute(
            """
            INSERT INTO product_density_history
                (product_id, density, effective_date, source, created_by, note)
            VALUES (%s, %s, %s, %s, %s, 'Initial density copied from retail project.')
            ON DUPLICATE KEY UPDATE
                density = VALUES(density),
                source = VALUES(source)
            """,
            (product_ids[product_code], density, effective_date, source, SYSTEM_USER),
        )

    for entity_type, entity_code, standard_name, alias_name, confidence in ENTITY_ALIASES:
        cur.execute(
            """
            INSERT INTO entity_aliases
                (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
            VALUES (%s, %s, %s, %s, %s, %s, 'seed')
            ON DUPLICATE KEY UPDATE
                entity_type = VALUES(entity_type),
                entity_code = VALUES(entity_code),
                standard_name = VALUES(standard_name),
                alias_name = VALUES(alias_name),
                confidence = VALUES(confidence)
            """,
            (entity_type, entity_code, standard_name, alias_name, normalize_text(alias_name), confidence),
        )

    seed_retail_station_aliases(cur)


def seed_retail_station_aliases(cur):
    oilstation_root = PROJECT_ROOT.parent / "OilStation"
    sys.path.insert(0, str(oilstation_root))
    try:
        from constants import SHOP_KEY_MAP
    finally:
        sys.path = [item for item in sys.path if item != str(oilstation_root)]

    for shop_key, info in SHOP_KEY_MAP.items():
        short_name = info.get("short") or f"Station {shop_key}"
        aliases = {short_name, f"АЗС {short_name}", normalize_station_name(short_name)}
        for alias_name in aliases:
            if not alias_name:
                continue
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES ('retail_station', %s, %s, %s, %s, 95, 'oilstation')
                ON DUPLICATE KEY UPDATE
                    entity_type = VALUES(entity_type),
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = VALUES(confidence)
                """,
                (str(shop_key), short_name, alias_name, normalize_station_name(alias_name)),
            )

    manual_aliases = [
        ("26", "S-52", ["X-40", "S-52"]),
        ("24", "X-43", ["АЗС CTY-07 4", "CTY-07 4"]),
        ("5", "S-10", ["АЗС S-10", "АЗС S-10", "S-10", "S-10"]),
        ("7", "X-47", ["X-44", "X-47"]),
        ("1", "S-02", ["X-25", "X-37", "АЗС CTY-06", "CTY-06"]),
    ]
    for shop_key, standard_name, aliases in manual_aliases:
        for alias_name in aliases:
            cur.execute(
                """
                INSERT INTO entity_aliases
                    (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                VALUES ('retail_station', %s, %s, %s, %s, 99, 'manual')
                ON DUPLICATE KEY UPDATE
                    entity_type = VALUES(entity_type),
                    entity_code = VALUES(entity_code),
                    standard_name = VALUES(standard_name),
                    alias_name = VALUES(alias_name),
                    confidence = VALUES(confidence),
                    source = VALUES(source)
                """,
                (shop_key, standard_name, alias_name, normalize_station_name(alias_name)),
            )


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()
        execute_sql_file(cur, PROJECT_ROOT / "schema.sql")
        seed_reference_data(cur)
        conn.commit()
        print("schema and reference data initialized")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
