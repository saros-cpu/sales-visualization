from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from db import get_connection


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()

        # records with exact join to kj_weighing
        cur.execute("""
            UPDATE wholesale_detail_records w
            INNER JOIN kj_weighing k
                ON w.vehicle_no = k.车号
                AND w.business_date = DATE(k.毛重日期)
                AND w.source_row_number = k.序号
            SET
                w.weigh_serial_no = COALESCE(NULLIF(TRIM(k.编号), ''), w.weigh_serial_no),
                w.sender_name = COALESCE(NULLIF(TRIM(k.发货单位), ''), w.sender_name)
            WHERE w.weigh_serial_no IS NULL
               OR w.sender_name IS NULL
        """)
        updated = cur.rowcount
        conn.commit()
        print(f"Backfill complete: {updated} records updated.")

        # verify
        cur.execute("SELECT COUNT(*) FROM wholesale_detail_records WHERE weigh_serial_no IS NULL OR weigh_serial_no = ''")
        missing_serial = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM wholesale_detail_records WHERE sender_name IS NULL OR sender_name = ''")
        missing_sender = cur.fetchone()[0]
        print(f"Remaining empty: weigh_serial_no={missing_serial}, sender_name={missing_sender}")

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
