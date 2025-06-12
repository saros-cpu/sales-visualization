from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from db import get_connection
from import_helpers import load_entity_lookup, lookup_entity


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()
        entity_lookup = load_entity_lookup(cur)
        cur.execute(
            """
            SELECT id, raw_entity_name, entity_type, entity_code, standard_entity_name
            FROM wholesale_detail_records
            WHERE classification = 'transfer'
            """
        )
        rows = cur.fetchall()
        updated = 0
        for row_id, raw_name, old_type, old_code, old_name in rows:
            entity = lookup_entity(entity_lookup, raw_name)
            if not entity:
                continue
            new_values = (
                entity["entity_type"],
                entity["entity_code"],
                entity["standard_name"],
            )
            if new_values == (old_type, old_code, old_name):
                continue
            cur.execute(
                """
                UPDATE wholesale_detail_records
                SET entity_type = %s,
                    entity_code = %s,
                    standard_entity_name = %s
                WHERE id = %s
                """,
                (*new_values, row_id),
            )
            updated += 1
        conn.commit()
        print(f"entity aliases reconciled: scanned={len(rows)}, updated={updated}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
