"""Deprecated legacy role-module permission migration.

Current permission data is maintained by api_v2.permission_service and the
organization permission APIs. This script is intentionally a no-op so a manual
rerun cannot recreate the retired role_module_permissions table.
"""

print("Migration 004 skipped: legacy role_module_permissions is deprecated")
