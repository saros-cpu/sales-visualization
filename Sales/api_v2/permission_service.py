from __future__ import annotations

from collections import defaultdict
from typing import Any

import pymysql


DATA_SCOPE_TYPES = ("all", "dept_tree", "dept", "self", "custom")


MODULE_CATALOG = [
    ("dashboard", "数据可视化", 10),
    ("retail", "零售", 20),
    ("wholesale", "批发", 30),
    ("exchange", "汇率查询", 40),
    ("train_entry", "数据录入", 50),
    ("procurement", "原料采购", 60),
    ("contracts", "合同管理", 70),
    ("materials", "物资调拨", 80),
    ("transfer_loss", "外运损耗", 90),
    ("map", "3D 地图", 100),
    ("knowledge", "知识库", 105),
    ("users", "用户管理", 110),
    ("departments", "部门管理", 112),
    ("roles", "角色权限", 114),
    ("aliases", "别名管理", 120),
    ("weighing", "称重审核", 130),
    ("audit_logs", "审计日志", 135),
    ("system_health", "系统健康", 138),
    ("settings", "设置", 140),
]

LEGACY_MODULE_KEYS = (
    "data_entry",
    "contract_mgmt",
    "data_view",
    "wholesale_view",
    "transfer_view",
    "procurement_view",
    "processing_view",
    "retail_view",
    "contract_view",
    "reports",
    "print_detail",
    "print_summary",
    "print_loss",
    "print_retail",
    "user_mgmt",
    "about",
)


PERMISSION_CATALOG = [
    ("dashboard:view", "dashboard", "view", "menu", "View data visualization", 10),
    ("retail:view", "retail", "view", "menu", "View retail", 20),
    ("retail:export", "retail", "export", "button", "Export retail data", 21),
    ("wholesale:view", "wholesale", "view", "menu", "View wholesale", 30),
    ("wholesale:export", "wholesale", "export", "button", "Export wholesale data", 31),
    ("exchange:view", "exchange", "view", "menu", "View exchange rates", 40),
    ("train_entry:view", "train_entry", "view", "menu", "View train entries", 50),
    ("train_entry:create", "train_entry", "create", "button", "Create train entry", 51),
    ("train_entry:update", "train_entry", "update", "button", "Update train entry", 52),
    ("train_entry:delete", "train_entry", "delete", "button", "Delete train entry", 53),
    ("procurement:view", "procurement", "view", "menu", "View procurement", 60),
    ("procurement:export", "procurement", "export", "button", "Export procurement", 61),
    ("contracts:view", "contracts", "view", "menu", "View contracts", 70),
    ("contracts:create", "contracts", "create", "button", "Create contract", 71),
    ("contracts:update", "contracts", "update", "button", "Update contract", 72),
    ("contracts:delete", "contracts", "delete", "button", "Delete contract", 73),
    ("contracts:export", "contracts", "export", "button", "Export contracts", 74),
    ("materials:view", "materials", "view", "menu", "View materials", 80),
    ("materials:create", "materials", "create", "button", "Create material record", 81),
    ("materials:update", "materials", "update", "button", "Update material record", 82),
    ("materials:delete", "materials", "delete", "button", "Delete material record", 83),
    ("materials:approve", "materials", "approve", "button", "Approve material transfer", 84),
    ("transfer_loss:view", "transfer_loss", "view", "menu", "View transfer loss", 90),
    ("transfer_loss:export", "transfer_loss", "export", "button", "Export transfer loss", 91),
    ("map:view", "map", "view", "menu", "View map", 100),
    ("knowledge:view", "knowledge", "view", "menu", "View knowledge base", 105),
    ("knowledge:manage", "knowledge", "manage", "api", "Manage knowledge base", 106),
    ("knowledge:reindex", "knowledge", "reindex", "button", "Rebuild knowledge attachment index", 107),
    ("users:view", "users", "view", "menu", "View users", 110),
    ("users:create", "users", "create", "button", "Create user", 111),
    ("users:update", "users", "update", "button", "Update user", 112),
    ("users:reset_password", "users", "reset_password", "button", "Reset password", 113),
    ("users:manage", "users", "manage", "api", "Manage users", 114),
    ("departments:manage", "departments", "manage", "api", "Manage departments", 120),
    ("roles:manage", "roles", "manage", "api", "Manage roles and permissions", 130),
    ("aliases:view", "aliases", "view", "menu", "View aliases", 140),
    ("aliases:create", "aliases", "create", "button", "Create alias", 141),
    ("aliases:delete", "aliases", "delete", "button", "Delete alias", 142),
    ("weighing:view", "weighing", "view", "menu", "View weighing review", 150),
    ("weighing:verify", "weighing", "verify", "button", "Verify weighing data", 151),
    ("weighing:export", "weighing", "export", "button", "Export weighing data", 152),
    ("audit_logs:view", "audit_logs", "view", "menu", "View operation audit logs", 155),
    ("audit_logs:export", "audit_logs", "export", "button", "Export operation audit logs", 156),
    ("system_health:view", "system_health", "view", "menu", "View system health", 158),
    ("system_health:manage", "system_health", "manage", "button", "Run system maintenance tasks", 159),
    ("settings:view", "settings", "view", "menu", "View settings", 160),
    ("settings:update", "settings", "update", "button", "Update settings", 161),
]


ROLE_SEEDS = [
    ("admin", "系统管理员", "all", 10, True),
    ("leadership", "领导层", "all", 15, False),
    ("operator", "业务操作员", "dept", 20, True),
    ("auditor", "审计员", "dept_tree", 30, True),
    ("viewer", "查看员", "dept", 40, True),
    ("sales_manager", "销售主管", "dept_tree", 50, False),
    ("sales_staff", "销售专员", "dept", 60, False),
    ("procurement_staff", "采购专员", "dept", 70, False),
    ("loading_staff", "物流管理专员", "dept", 80, False),
    ("finance_staff", "财务资产专员", "dept", 90, False),
]


DEPARTMENT_SEEDS = [
    ("management", "综合管理部", "Отдел общего управления", None, 10),
    ("sales", "ProductTeam", "Отдел маркетинга и продаж", None, 20),
    ("procurement", "原料采购部", "Отдел закупки сырья", None, 30),
    ("loading", "物流管理部", "Отдел управления логистикой", None, 40),
    ("finance", "财务资产部", "Отдел финансов и активов", None, 50),
]


DATA_VIEW_ACTIONS = {
    "dashboard:view", "retail:view", "wholesale:view", "exchange:view",
    "train_entry:view", "procurement:view", "contracts:view", "materials:view",
    "transfer_loss:view", "map:view", "knowledge:view", "weighing:view", "settings:view",
}

SALES_DEPARTMENT_ACTIONS = DATA_VIEW_ACTIONS | {
    "train_entry:create", "train_entry:update",
    "contracts:create",
    "materials:create", "materials:update", "materials:approve",
}

PROCUREMENT_DEPARTMENT_ACTIONS = DATA_VIEW_ACTIONS | {
    "train_entry:create", "train_entry:update",
}

LOGISTICS_DEPARTMENT_ACTIONS = DATA_VIEW_ACTIONS | {
    "weighing:verify", "materials:approve",
}


ROLE_DEFAULT_ACTIONS = {
    "admin": {"*"},
    "leadership": DATA_VIEW_ACTIONS,
    "operator": SALES_DEPARTMENT_ACTIONS,
    "auditor": DATA_VIEW_ACTIONS,
    "viewer": DATA_VIEW_ACTIONS,
    "sales_manager": SALES_DEPARTMENT_ACTIONS,
    "sales_staff": SALES_DEPARTMENT_ACTIONS,
    "procurement_staff": PROCUREMENT_DEPARTMENT_ACTIONS,
    "loading_staff": LOGISTICS_DEPARTMENT_ACTIONS,
    "finance_staff": DATA_VIEW_ACTIONS,
}


def _safe_execute(cur, sql: str, params: tuple[Any, ...] | None = None) -> None:
    cur.execute(sql, params or ())


def ensure_permission_schema(cur) -> None:
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS app_modules (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            module_key VARCHAR(64) NOT NULL UNIQUE,
            module_name VARCHAR(128) NOT NULL,
            parent_key VARCHAR(64) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_parent (parent_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_departments (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            parent_id BIGINT NULL,
            dept_code VARCHAR(64) NOT NULL UNIQUE,
            dept_name VARCHAR(128) NOT NULL,
            dept_name_ru VARCHAR(128) NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_parent_active (parent_id, is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _ensure_department_language_columns(cur)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_roles (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            role_code VARCHAR(64) NOT NULL UNIQUE,
            role_name VARCHAR(128) NOT NULL,
            description VARCHAR(255) NULL,
            data_scope ENUM('all','dept_tree','dept','self','custom') NOT NULL DEFAULT 'self',
            is_system BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_role_active (is_active, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_user_roles (
            user_id BIGINT NOT NULL,
            role_id BIGINT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, role_id),
            KEY idx_role_user (role_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_user_departments (
            user_id BIGINT NOT NULL,
            dept_id BIGINT NOT NULL,
            is_primary BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, dept_id),
            KEY idx_dept_user (dept_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_permissions (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            permission_code VARCHAR(128) NOT NULL UNIQUE,
            module_key VARCHAR(64) NOT NULL,
            action_key VARCHAR(64) NOT NULL,
            permission_type ENUM('menu','button','api') NOT NULL DEFAULT 'button',
            permission_name VARCHAR(128) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_perm_module (module_key, action_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_role_permissions (
            role_id BIGINT NOT NULL,
            permission_id BIGINT NOT NULL,
            granted BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (role_id, permission_id),
            KEY idx_perm_role (permission_id, role_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_user_permission_overrides (
            user_id BIGINT NOT NULL,
            permission_id BIGINT NOT NULL,
            effect ENUM('allow','deny') NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, permission_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_role_data_scopes (
            role_id BIGINT NOT NULL,
            module_key VARCHAR(64) NOT NULL,
            scope_type ENUM('all','dept_tree','dept','self','custom') NOT NULL DEFAULT 'self',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (role_id, module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _safe_execute(cur, """
        CREATE TABLE IF NOT EXISTS system_data_scope_resources (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            owner_type ENUM('role','department','user') NOT NULL,
            owner_id BIGINT NOT NULL,
            module_key VARCHAR(64) NOT NULL,
            resource_type VARCHAR(64) NOT NULL,
            resource_id VARCHAR(128) NOT NULL,
            resource_label VARCHAR(255) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_scope_resource (owner_type, owner_id, module_key, resource_type, resource_id),
            KEY idx_scope_owner (owner_type, owner_id, module_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    _seed_catalog(cur)


def _ensure_department_language_columns(cur) -> None:
    _safe_execute(cur, "SHOW COLUMNS FROM system_departments LIKE 'dept_name_ru'")
    if not cur.fetchone():
        _safe_execute(cur, """
            ALTER TABLE system_departments
            ADD COLUMN dept_name_ru VARCHAR(128) NULL AFTER dept_name
        """)


def _seed_catalog(cur) -> None:
    _safe_execute(cur, "SELECT permission_code FROM system_permissions")
    existing_permission_codes = {
        row["permission_code"] if isinstance(row, dict) else row[0]
        for row in cur.fetchall()
    }
    legacy_placeholders = ",".join(["%s"] * len(LEGACY_MODULE_KEYS))
    _safe_execute(
        cur,
        f"UPDATE app_modules SET is_active = FALSE WHERE module_key IN ({legacy_placeholders})",
        LEGACY_MODULE_KEYS,
    )
    _safe_execute(
        cur,
        f"UPDATE system_permissions SET is_active = FALSE WHERE module_key IN ({legacy_placeholders})",
        LEGACY_MODULE_KEYS,
    )
    for module_key, module_name, sort_order in MODULE_CATALOG:
        _safe_execute(cur, """
            INSERT INTO app_modules (module_key, module_name, sort_order, is_active)
            VALUES (%s, %s, %s, TRUE)
            ON DUPLICATE KEY UPDATE
                module_name = VALUES(module_name),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        """, (module_key, module_name, sort_order))
    for dept_code, dept_name, dept_name_ru, parent_code, sort_order in DEPARTMENT_SEEDS:
        parent_id = None
        if parent_code:
            _safe_execute(cur, "SELECT id FROM system_departments WHERE dept_code = %s", (parent_code,))
            row = cur.fetchone()
            parent_id = row["id"] if isinstance(row, dict) and row else row[0] if row else None
        _safe_execute(cur, """
            INSERT INTO system_departments (dept_code, dept_name, dept_name_ru, parent_id, sort_order, is_active)
            VALUES (%s, %s, %s, %s, %s, TRUE)
            ON DUPLICATE KEY UPDATE
                dept_name = IF(dept_name IS NULL OR dept_name = '', VALUES(dept_name), dept_name),
                dept_name_ru = IF(dept_name_ru IS NULL OR dept_name_ru = '', VALUES(dept_name_ru), dept_name_ru),
                parent_id = VALUES(parent_id),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        """, (dept_code, dept_name, dept_name_ru, parent_id, sort_order))
    for role_code, role_name, data_scope, sort_order, is_system in ROLE_SEEDS:
        _safe_execute(cur, """
            INSERT INTO system_roles (role_code, role_name, data_scope, is_system, is_active, sort_order)
            VALUES (%s, %s, %s, %s, TRUE, %s)
            ON DUPLICATE KEY UPDATE
                role_name = VALUES(role_name),
                is_system = VALUES(is_system),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        """, (role_code, role_name, data_scope, 1 if is_system else 0, sort_order))
    for code, module_key, action_key, permission_type, name, sort_order in PERMISSION_CATALOG:
        _safe_execute(cur, """
            INSERT INTO system_permissions
                (permission_code, module_key, action_key, permission_type, permission_name, sort_order, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, TRUE)
            ON DUPLICATE KEY UPDATE
                module_key = VALUES(module_key),
                action_key = VALUES(action_key),
                permission_type = VALUES(permission_type),
                permission_name = VALUES(permission_name),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        """, (code, module_key, action_key, permission_type, name, sort_order))
    _seed_default_role_permissions(cur, existing_permission_codes)


def _seed_default_role_permissions(cur, existing_permission_codes: set[str] | None = None) -> None:
    existing_permission_codes = existing_permission_codes or set()
    _safe_execute(cur, "SELECT id, permission_code, module_key FROM system_permissions WHERE is_active = TRUE")
    permissions = cur.fetchall()
    permission_rows = [
        {
            "id": row["id"] if isinstance(row, dict) else row[0],
            "permission_code": row["permission_code"] if isinstance(row, dict) else row[1],
            "module_key": row["module_key"] if isinstance(row, dict) else row[2],
        }
        for row in permissions
    ]
    for role_code, defaults in ROLE_DEFAULT_ACTIONS.items():
        _safe_execute(cur, "SELECT id FROM system_roles WHERE role_code = %s", (role_code,))
        row = cur.fetchone()
        if not row:
            continue
        role_id = row["id"] if isinstance(row, dict) else row[0]
        _safe_execute(cur, "SELECT COUNT(*) AS total FROM system_role_permissions WHERE role_id = %s", (role_id,))
        count_row = cur.fetchone()
        total = count_row["total"] if isinstance(count_row, dict) else count_row[0]
        for perm in permission_rows:
            code = perm["permission_code"]
            module_key = perm["module_key"]
            granted = "*" in defaults or code in defaults or f"{module_key}:*" in defaults
            if granted and (not total or code not in existing_permission_codes):
                _safe_execute(cur, """
                    INSERT IGNORE INTO system_role_permissions (role_id, permission_id, granted)
                    VALUES (%s, %s, TRUE)
                """, (role_id, perm["id"]))
        for module_key, _, _ in MODULE_CATALOG:
            scope = _default_scope_for_role(role_code)
            _safe_execute(cur, """
                INSERT IGNORE INTO system_role_data_scopes (role_id, module_key, scope_type)
                VALUES (%s, %s, %s)
            """, (role_id, module_key, scope))
def _default_scope_for_role(role_code: str) -> str:
    if role_code in ("admin", "leadership"):
        return "all"
    if role_code in ("auditor", "sales_manager"):
        return "dept_tree"
    if role_code in ("operator", "viewer"):
        return "dept"
    return "dept"


def ensure_user_org_assignments(cur, user_id: int, legacy_role: str | None = None) -> None:
    ensure_permission_schema(cur)
    role_code = legacy_role or "viewer"
    _safe_execute(cur, """
        SELECT COUNT(*) AS total
        FROM system_user_roles ur
        JOIN system_roles r ON r.id = ur.role_id
        WHERE ur.user_id = %s
    """, (user_id,))
    row = cur.fetchone()
    total = row["total"] if isinstance(row, dict) else row[0]
    if not total:
        _safe_execute(cur, "SELECT id FROM system_roles WHERE role_code = %s", (role_code,))
        role = cur.fetchone()
        if not role and role_code != "viewer":
            _safe_execute(cur, "SELECT id FROM system_roles WHERE role_code = 'viewer'")
            role = cur.fetchone()
        if role:
            role_id = role["id"] if isinstance(role, dict) else role[0]
            _safe_execute(cur, """
                INSERT IGNORE INTO system_user_roles (user_id, role_id, is_primary)
                VALUES (%s, %s, TRUE)
            """, (user_id, role_id))
    _safe_execute(cur, "SELECT COUNT(*) AS total FROM system_user_departments WHERE user_id = %s", (user_id,))
    dept_row = cur.fetchone()
    dept_total = dept_row["total"] if isinstance(dept_row, dict) else dept_row[0]
    if not dept_total:
        dept_code = "management" if role_code == "admin" else "sales"
        _safe_execute(cur, "SELECT id FROM system_departments WHERE dept_code = %s", (dept_code,))
        dept = cur.fetchone()
        if dept:
            dept_id = dept["id"] if isinstance(dept, dict) else dept[0]
            _safe_execute(cur, """
                INSERT IGNORE INTO system_user_departments (user_id, dept_id, is_primary)
                VALUES (%s, %s, TRUE)
            """, (user_id, dept_id))


def get_effective_auth(cur, user_id: int, legacy_role: str | None = None) -> dict[str, Any]:
    ensure_user_org_assignments(cur, user_id, legacy_role)
    roles = list_user_roles(cur, user_id)
    departments = list_user_departments(cur, user_id)
    permission_codes = _collect_permission_codes(cur, user_id)
    if legacy_role == "admin" or any(role["roleCode"] == "admin" for role in roles):
        permission_codes = _all_permission_codes(cur)
    module_permissions = _permission_codes_to_legacy_map(permission_codes)
    data_scopes = _collect_data_scopes(cur, roles)
    return {
        "roles": roles,
        "departments": departments,
        "permissionCodes": sorted(set(permission_codes)),
        "permissions": module_permissions,
        "dataScopes": data_scopes,
    }


def _all_permission_codes(cur) -> list[str]:
    _safe_execute(cur, "SELECT permission_code FROM system_permissions WHERE is_active = TRUE")
    return [row["permission_code"] if isinstance(row, dict) else row[0] for row in cur.fetchall()]


def _collect_permission_codes(cur, user_id: int) -> list[str]:
    _safe_execute(cur, """
        SELECT DISTINCT p.permission_code
        FROM system_user_roles ur
        JOIN system_role_permissions rp ON rp.role_id = ur.role_id AND rp.granted = TRUE
        JOIN system_permissions p ON p.id = rp.permission_id AND p.is_active = TRUE
        WHERE ur.user_id = %s
    """, (user_id,))
    codes = {row["permission_code"] if isinstance(row, dict) else row[0] for row in cur.fetchall()}
    _safe_execute(cur, """
        SELECT p.permission_code, o.effect
        FROM system_user_permission_overrides o
        JOIN system_permissions p ON p.id = o.permission_id AND p.is_active = TRUE
        WHERE o.user_id = %s
    """, (user_id,))
    for row in cur.fetchall():
        code = row["permission_code"] if isinstance(row, dict) else row[0]
        effect = row["effect"] if isinstance(row, dict) else row[1]
        if effect == "allow":
            codes.add(code)
        else:
            codes.discard(code)
    return sorted(codes)


def _permission_codes_to_legacy_map(codes: list[str]) -> dict[str, dict[str, bool]]:
    result: dict[str, dict[str, bool]] = {}
    for code in codes:
        if ":" not in code:
            continue
        module_key, action = code.split(":", 1)
        item = result.setdefault(module_key, {"view": False, "edit": False})
        if action == "view":
            item["view"] = True
        else:
            item["edit"] = True
            if action in ("create", "update", "delete", "manage"):
                item["view"] = True
    return result


def _collect_data_scopes(cur, roles: list[dict[str, Any]]) -> dict[str, str]:
    priority = {"self": 1, "dept": 2, "custom": 3, "dept_tree": 4, "all": 5}
    result: dict[str, str] = {}
    role_ids = [role["id"] for role in roles]
    if not role_ids:
        return result
    placeholders = ",".join(["%s"] * len(role_ids))
    _safe_execute(cur, f"""
        SELECT module_key, scope_type
        FROM system_role_data_scopes
        WHERE role_id IN ({placeholders})
    """, tuple(role_ids))
    for row in cur.fetchall():
        module_key = row["module_key"] if isinstance(row, dict) else row[0]
        scope_type = row["scope_type"] if isinstance(row, dict) else row[1]
        current = result.get(module_key)
        if not current or priority.get(scope_type, 0) > priority.get(current, 0):
            result[module_key] = scope_type
    return result


def list_user_roles(cur, user_id: int) -> list[dict[str, Any]]:
    _safe_execute(cur, """
        SELECT r.id, r.role_code, r.role_name, r.data_scope, ur.is_primary
        FROM system_user_roles ur
        JOIN system_roles r ON r.id = ur.role_id
        WHERE ur.user_id = %s AND r.is_active = TRUE
        ORDER BY ur.is_primary DESC, r.sort_order, r.id
    """, (user_id,))
    return [
        {
            "id": row["id"] if isinstance(row, dict) else row[0],
            "roleCode": row["role_code"] if isinstance(row, dict) else row[1],
            "roleName": row["role_name"] if isinstance(row, dict) else row[2],
            "dataScope": row["data_scope"] if isinstance(row, dict) else row[3],
            "isPrimary": bool(row["is_primary"] if isinstance(row, dict) else row[4]),
        }
        for row in cur.fetchall()
    ]


def list_user_departments(cur, user_id: int) -> list[dict[str, Any]]:
    _safe_execute(cur, """
        SELECT d.id, d.dept_code, d.dept_name, d.dept_name_ru, d.parent_id, ud.is_primary
        FROM system_user_departments ud
        JOIN system_departments d ON d.id = ud.dept_id
        WHERE ud.user_id = %s AND d.is_active = TRUE
        ORDER BY ud.is_primary DESC, d.sort_order, d.id
    """, (user_id,))
    return [
        {
            "id": row["id"] if isinstance(row, dict) else row[0],
            "deptCode": row["dept_code"] if isinstance(row, dict) else row[1],
            "deptName": row["dept_name"] if isinstance(row, dict) else row[2],
            "deptNameRu": row["dept_name_ru"] if isinstance(row, dict) else row[3],
            "parentId": row["parent_id"] if isinstance(row, dict) else row[4],
            "isPrimary": bool(row["is_primary"] if isinstance(row, dict) else row[5]),
        }
        for row in cur.fetchall()
    ]


def set_user_roles(cur, user_id: int, role_codes: list[str] | None, legacy_role: str | None = None) -> str:
    ensure_permission_schema(cur)
    codes = [code for code in (role_codes or []) if code]
    if not codes and legacy_role:
        codes = [legacy_role]
    if not codes:
        codes = ["viewer"]
    _safe_execute(cur, "DELETE FROM system_user_roles WHERE user_id = %s", (user_id,))
    primary_code = codes[0]
    for code in codes:
        _safe_execute(cur, "SELECT id FROM system_roles WHERE role_code = %s AND is_active = TRUE", (code,))
        row = cur.fetchone()
        if not row:
            continue
        role_id = row["id"] if isinstance(row, dict) else row[0]
        _safe_execute(cur, """
            INSERT INTO system_user_roles (user_id, role_id, is_primary)
            VALUES (%s, %s, %s)
        """, (user_id, role_id, 1 if code == primary_code else 0))
    return primary_code


def set_user_departments(cur, user_id: int, department_ids: list[int] | None) -> None:
    ensure_permission_schema(cur)
    ids = [int(dept_id) for dept_id in (department_ids or []) if dept_id]
    _safe_execute(cur, "DELETE FROM system_user_departments WHERE user_id = %s", (user_id,))
    for index, dept_id in enumerate(ids):
        _safe_execute(cur, """
            INSERT IGNORE INTO system_user_departments (user_id, dept_id, is_primary)
            VALUES (%s, %s, %s)
        """, (user_id, dept_id, 1 if index == 0 else 0))


def has_permission(cur, user_id: int, permission_code: str, legacy_role: str | None = None) -> bool:
    if legacy_role == "admin":
        return True
    auth = get_effective_auth(cur, user_id, legacy_role)
    return permission_code in set(auth["permissionCodes"])


def list_resources(cur) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for table, resource_type, id_col, label_col in [
        ("depots", "depot", "id", "name_zh"),
        ("customers", "customer", "id", "standard_name"),
    ]:
        try:
            _safe_execute(cur, f"SELECT {id_col} AS id, {label_col} AS label FROM {table} ORDER BY {label_col} LIMIT 1000")
            result[resource_type] = [
                {"resourceId": str(row["id"] if isinstance(row, dict) else row[0]),
                 "resourceLabel": row["label"] if isinstance(row, dict) else row[1]}
                for row in cur.fetchall()
            ]
        except pymysql.err.ProgrammingError:
            result[resource_type] = []
    try:
        from shared_utils import retail_station_catalog_cached

        result["station"] = [
            {
                "resourceId": str(item.get("shopKey") or key),
                "resourceLabel": item.get("name") or item.get("short") or str(key),
            }
            for key, item in sorted(retail_station_catalog_cached().items())
        ]
    except Exception:
        result["station"] = []
    return dict(result)
