from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import get_connection
from api_v2.permission_service import ensure_permission_schema


conn = get_connection()
try:
    with conn.cursor() as cur:
        ensure_permission_schema(cur)
    conn.commit()
    print("Migration 005 OK")
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
