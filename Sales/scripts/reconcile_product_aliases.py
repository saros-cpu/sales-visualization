from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from calculations import recalculate_wholesale_batch
from db import get_connection
from import_helpers import load_product_lookup, lookup_product


def update_product_ids(cur, table, name_column, id_column="product_id"):
    product_lookup = load_product_lookup(cur)
    cur.execute(f"SELECT id, {name_column}, {id_column} FROM {table}")
    rows = cur.fetchall()
    updated = 0
    recognized = 0
    for row_id, raw_name, old_product_id in rows:
        product = lookup_product(product_lookup, raw_name)
        if not product:
            continue
        recognized += 1
        if old_product_id != product["id"]:
            cur.execute(
                f"UPDATE {table} SET {id_column} = %s WHERE id = %s",
                (product["id"], row_id),
            )
            updated += 1
    return {"scanned": len(rows), "recognized": recognized, "updated": updated}


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()
        detail = update_product_ids(cur, "wholesale_detail_records", "raw_product_name")
        summary = update_product_ids(cur, "wholesale_summary_records", "raw_product_name")
        contracts = update_product_ids(cur, "contracts", "raw_product_name")
        cur.execute(
            """
            SELECT id
            FROM import_batches
            WHERE source_type IN ('export_sales_excel', 'manual')
              AND status = 'imported'
            """
        )
        total = {"matched": 0, "unmatched": 0, "missing_rates": 0}
        for (batch_id,) in cur.fetchall():
            result = recalculate_wholesale_batch(cur, batch_id)
            for key in total:
                total[key] += result[key]
        conn.commit()
        print({
            "detail": detail,
            "summary": summary,
            "contracts": contracts,
            "recalculation": total,
        })
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
