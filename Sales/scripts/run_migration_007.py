from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import get_connection
from api_v2.permission_service import (
    MODULE_CATALOG,
    ROLE_DEFAULT_ACTIONS,
    ensure_permission_schema,
    _default_scope_for_role,
)


def _matches(defaults, code, module_key):
    return "*" in defaults or code in defaults or f"{module_key}:*" in defaults


conn = get_connection()
try:
    with conn.cursor() as cur:
        ensure_permission_schema(cur)
        cur.execute("SELECT id, permission_code, module_key FROM system_permissions WHERE is_active = TRUE")
        permissions = cur.fetchall()

        for role_code, defaults in ROLE_DEFAULT_ACTIONS.items():
            cur.execute("SELECT id FROM system_roles WHERE role_code = %s", (role_code,))
            row = cur.fetchone()
            if not row:
                continue
            role_id = row[0] if not isinstance(row, dict) else row["id"]
            cur.execute("DELETE FROM system_role_permissions WHERE role_id = %s", (role_id,))
            for perm in permissions:
                perm_id = perm[0] if not isinstance(perm, dict) else perm["id"]
                code = perm[1] if not isinstance(perm, dict) else perm["permission_code"]
                module_key = perm[2] if not isinstance(perm, dict) else perm["module_key"]
                if _matches(defaults, code, module_key):
                    cur.execute(
                        "INSERT INTO system_role_permissions (role_id, permission_id, granted) VALUES (%s, %s, TRUE)",
                        (role_id, perm_id),
                    )

            scope = _default_scope_for_role(role_code)
            cur.execute("UPDATE system_roles SET data_scope = %s WHERE id = %s", (scope, role_id))
            for module_key, _, _ in MODULE_CATALOG:
                cur.execute(
                    """
                    INSERT INTO system_role_data_scopes (role_id, module_key, scope_type)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type)
                    """,
                    (role_id, module_key, scope),
                )

            cur.execute("DELETE FROM role_module_permissions WHERE role = %s", (role_code,))
            for module_key, _, _ in MODULE_CATALOG:
                granted = _matches(defaults, f"{module_key}:view", module_key)
                cur.execute(
                    "INSERT INTO role_module_permissions (role, module_key, granted) VALUES (%s, %s, %s)",
                    (role_code, module_key, 1 if granted else 0),
                )

    conn.commit()
    print("Migration 007 OK")
except Exception:
    conn.rollback()
    raise
finally:
    conn.close()
