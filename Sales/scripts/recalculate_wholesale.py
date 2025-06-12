from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from calculations import recalculate_wholesale_batch
from db import get_connection


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM import_batches WHERE source_type = 'export_sales_excel'")
        batch_ids = [row[0] for row in cur.fetchall()]
        total = {"matched": 0, "unmatched": 0, "missing_rates": 0}
        for batch_id in batch_ids:
            result = recalculate_wholesale_batch(cur, batch_id)
            for key in total:
                total[key] += result[key]
        conn.commit()
        print(f"wholesale recalculation complete: {total}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
