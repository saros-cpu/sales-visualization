from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from calculations import recalculate_wholesale_all
from db import get_connection


def main():
    conn = get_connection()
    try:
        cur = conn.cursor()
        total = recalculate_wholesale_all(cur)
        conn.commit()
        print(f"wholesale recalculation complete: {total}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
