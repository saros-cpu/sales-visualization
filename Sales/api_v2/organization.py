from __future__ import annotations

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from db import get_connection
from .permission_service import (
    DATA_SCOPE_TYPES,
    ensure_permission_schema,
    has_permission,
    list_resources,
)


def _row_value(row, key, index):
    return row[key] if isinstance(row, dict) else row[index]


def _current_user(cur):
    user_id = int(get_jwt_identity())
    cur.execute(
        "SELECT id, username, role FROM system_users WHERE id = %s AND is_active = TRUE",
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        "id": _row_value(row, "id", 0),
        "username": _row_value(row, "username", 1),
        "role": _row_value(row, "role", 2),
    }


def _is_admin(user):
    return bool(user and user["role"] == "admin")


def _has_any_permission(cur, user, permission_codes):
    if _is_admin(user):
        return True
    if not user:
        return False
    return any(has_permission(cur, user["id"], code, user["role"]) for code in permission_codes)


def _forbidden():
    return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403


def _list_departments(cur):
    cur.execute("""
        SELECT id, parent_id, dept_code, dept_name, dept_name_ru, sort_order, is_active
        FROM system_departments
        ORDER BY sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "parentId": row["parent_id"],
            "deptCode": row["dept_code"],
            "deptName": row["dept_name"],
            "deptNameRu": row["dept_name_ru"],
            "sortOrder": row["sort_order"],
            "isActive": bool(row["is_active"]),
        }
        for row in cur.fetchall()
    ]


def _list_roles(cur):
    cur.execute("""
        SELECT id, role_code, role_name, description, data_scope,
               is_system, is_active, sort_order
        FROM system_roles
        ORDER BY sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "roleCode": row["role_code"],
            "roleName": row["role_name"],
            "description": row["description"],
            "dataScope": row["data_scope"],
            "isSystem": bool(row["is_system"]),
            "isActive": bool(row["is_active"]),
            "sortOrder": row["sort_order"],
        }
        for row in cur.fetchall()
    ]


def _list_permissions(cur):
    cur.execute("""
        SELECT id, permission_code, module_key, action_key, permission_type,
               permission_name, sort_order, is_active
        FROM system_permissions
        WHERE is_active = TRUE
        ORDER BY sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "permissionCode": row["permission_code"],
            "moduleKey": row["module_key"],
            "actionKey": row["action_key"],
            "permissionType": row["permission_type"],
            "permissionName": row["permission_name"],
            "sortOrder": row["sort_order"],
            "isActive": bool(row["is_active"]),
        }
        for row in cur.fetchall()
    ]


def _list_modules(cur):
    cur.execute("""
        SELECT id, module_key, module_name, parent_key, sort_order, is_active
        FROM app_modules
        WHERE is_active = TRUE
        ORDER BY sort_order, id
    """)
    return [
        {
            "id": row["id"],
            "moduleKey": row["module_key"],
            "moduleName": row["module_name"],
            "parentKey": row["parent_key"],
            "sortOrder": row["sort_order"],
        }
        for row in cur.fetchall()
    ]


def _list_role_permissions(cur):
    cur.execute("""
        SELECT r.role_code, p.permission_code, rp.granted
        FROM system_role_permissions rp
        JOIN system_roles r ON r.id = rp.role_id
        JOIN system_permissions p ON p.id = rp.permission_id
        ORDER BY r.sort_order, p.sort_order
    """)
    return [
        {
            "roleCode": row["role_code"],
            "permissionCode": row["permission_code"],
            "granted": bool(row["granted"]),
        }
        for row in cur.fetchall()
    ]


def _list_role_data_scopes(cur):
    cur.execute("""
        SELECT r.role_code, ds.module_key, ds.scope_type
        FROM system_role_data_scopes ds
        JOIN system_roles r ON r.id = ds.role_id
        ORDER BY r.sort_order, ds.module_key
    """)
    return [
        {
            "roleCode": row["role_code"],
            "moduleKey": row["module_key"],
            "scopeType": row["scope_type"],
        }
        for row in cur.fetchall()
    ]


def _list_data_scope_resources(cur):
    cur.execute("""
        SELECT sr.id, sr.owner_type, sr.owner_id, r.role_code,
               sr.module_key, sr.resource_type, sr.resource_id, sr.resource_label
        FROM system_data_scope_resources sr
        LEFT JOIN system_roles r ON sr.owner_type = 'role' AND r.id = sr.owner_id
        ORDER BY sr.owner_type, sr.owner_id, sr.module_key, sr.resource_type, sr.resource_label
    """)
    return [
        {
            "id": row["id"],
            "ownerType": row["owner_type"],
            "ownerId": row["owner_id"],
            "roleCode": row["role_code"],
            "moduleKey": row["module_key"],
            "resourceType": row["resource_type"],
            "resourceId": row["resource_id"],
            "resourceLabel": row["resource_label"],
        }
        for row in cur.fetchall()
    ]


@bp_v2.route("/organization/overview", methods=["GET"])
@jwt_required()
def organization_overview():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["users:manage", "roles:manage", "departments:manage"]):
                return _forbidden()
            conn.commit()
            data = {
                "modules": _list_modules(cur),
                "departments": _list_departments(cur),
                "roles": _list_roles(cur),
                "permissions": _list_permissions(cur),
                "rolePermissions": _list_role_permissions(cur),
                "roleDataScopes": _list_role_data_scopes(cur),
                "dataScopeResources": _list_data_scope_resources(cur),
                "resourceOptions": list_resources(cur),
                "dataScopeTypes": list(DATA_SCOPE_TYPES),
            }
            return jsonify({"code": 0, "message": "success", "data": data})
    finally:
        conn.close()


@bp_v2.route("/organization/departments", methods=["POST"])
@jwt_required()
def create_department():
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["departments:manage"]):
                return _forbidden()
            dept_code = str(payload.get("deptCode") or "").strip()
            dept_name = str(payload.get("deptName") or "").strip()
            dept_name_ru = str(payload.get("deptNameRu") or "").strip() or None
            if not dept_code or not dept_name:
                return jsonify({"code": 4221, "message": "deptCode and deptName are required", "data": None}), 422
            cur.execute("""
                INSERT INTO system_departments
                    (parent_id, dept_code, dept_name, dept_name_ru, sort_order, is_active)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                payload.get("parentId"),
                dept_code,
                dept_name,
                dept_name_ru,
                int(payload.get("sortOrder") or 0),
                1 if payload.get("isActive", True) else 0,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route("/organization/departments/<int:dept_id>", methods=["PUT"])
@jwt_required()
def update_department(dept_id):
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["departments:manage"]):
                return _forbidden()
            dept_name = str(payload.get("deptName") or "").strip()
            dept_name_ru = str(payload.get("deptNameRu") or "").strip() or None
            if not dept_name:
                return jsonify({"code": 4221, "message": "deptName is required", "data": None}), 422
            cur.execute("""
                UPDATE system_departments
                SET parent_id = %s, dept_name = %s, dept_name_ru = %s, sort_order = %s, is_active = %s
                WHERE id = %s
            """, (
                payload.get("parentId"),
                dept_name,
                dept_name_ru,
                int(payload.get("sortOrder") or 0),
                1 if payload.get("isActive", True) else 0,
                dept_id,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()


@bp_v2.route("/organization/roles", methods=["POST"])
@jwt_required()
def create_role():
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["roles:manage"]):
                return _forbidden()
            role_code = str(payload.get("roleCode") or "").strip()
            role_name = str(payload.get("roleName") or "").strip()
            data_scope = payload.get("dataScope") if payload.get("dataScope") in DATA_SCOPE_TYPES else "dept"
            if not role_code or not role_name:
                return jsonify({"code": 4221, "message": "roleCode and roleName are required", "data": None}), 422
            cur.execute("""
                INSERT INTO system_roles
                    (role_code, role_name, description, data_scope, is_system, is_active, sort_order)
                VALUES (%s, %s, %s, %s, FALSE, %s, %s)
            """, (
                role_code,
                role_name,
                payload.get("description"),
                data_scope,
                1 if payload.get("isActive", True) else 0,
                int(payload.get("sortOrder") or 0),
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": {"id": cur.lastrowid}})
    finally:
        conn.close()


@bp_v2.route("/organization/roles/<int:role_id>", methods=["PUT"])
@jwt_required()
def update_role(role_id):
    payload = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["roles:manage"]):
                return _forbidden()
            data_scope = payload.get("dataScope") if payload.get("dataScope") in DATA_SCOPE_TYPES else "dept"
            cur.execute("""
                UPDATE system_roles
                SET role_name = %s, description = %s, data_scope = %s,
                    is_active = %s, sort_order = %s
                WHERE id = %s
            """, (
                str(payload.get("roleName") or "").strip(),
                payload.get("description"),
                data_scope,
                1 if payload.get("isActive", True) else 0,
                int(payload.get("sortOrder") or 0),
                role_id,
            ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()


@bp_v2.route("/organization/roles/<role_code>/permissions", methods=["PUT"])
@jwt_required()
def update_role_permissions(role_code):
    payload = request.get_json() or {}
    permission_codes = payload.get("permissionCodes") or []
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["roles:manage"]):
                return _forbidden()
            cur.execute("SELECT id FROM system_roles WHERE role_code = %s", (role_code,))
            role = cur.fetchone()
            if not role:
                return jsonify({"code": 4004, "message": "role not found", "data": None}), 404
            role_id = role["id"]
            cur.execute("DELETE FROM system_role_permissions WHERE role_id = %s", (role_id,))
            for code in permission_codes:
                cur.execute("SELECT id FROM system_permissions WHERE permission_code = %s", (code,))
                perm = cur.fetchone()
                if perm:
                    cur.execute("""
                        INSERT INTO system_role_permissions (role_id, permission_id, granted)
                        VALUES (%s, %s, TRUE)
                    """, (role_id, perm["id"]))
            cur.execute("DELETE FROM role_module_permissions WHERE role = %s", (role_code,))
            modules = set()
            for code in permission_codes:
                if code.endswith(":view") and ":" in code:
                    modules.add(code.split(":", 1)[0])
            for module_key in modules:
                cur.execute("""
                    INSERT INTO role_module_permissions (role, module_key, granted)
                    VALUES (%s, %s, TRUE)
                """, (role_code, module_key))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()


@bp_v2.route("/organization/roles/<role_code>/data-scopes", methods=["PUT"])
@jwt_required()
def update_role_data_scopes(role_code):
    payload = request.get_json() or {}
    scopes = payload.get("scopes") or []
    resources = payload.get("resources") or []
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_permission_schema(cur)
            user = _current_user(cur)
            if not _has_any_permission(cur, user, ["roles:manage"]):
                return _forbidden()
            cur.execute("SELECT id FROM system_roles WHERE role_code = %s", (role_code,))
            role = cur.fetchone()
            if not role:
                return jsonify({"code": 4004, "message": "role not found", "data": None}), 404
            role_id = role["id"]
            for item in scopes:
                module_key = item.get("moduleKey")
                scope_type = item.get("scopeType")
                if not module_key or scope_type not in DATA_SCOPE_TYPES:
                    continue
                cur.execute("""
                    INSERT INTO system_role_data_scopes (role_id, module_key, scope_type)
                    VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type)
                """, (role_id, module_key, scope_type))
            cur.execute("""
                DELETE FROM system_data_scope_resources
                WHERE owner_type = 'role' AND owner_id = %s
            """, (role_id,))
            for item in resources:
                module_key = item.get("moduleKey")
                resource_type = item.get("resourceType")
                resource_id = item.get("resourceId")
                if not module_key or not resource_type or not resource_id:
                    continue
                cur.execute("""
                    INSERT IGNORE INTO system_data_scope_resources
                        (owner_type, owner_id, module_key, resource_type, resource_id, resource_label)
                    VALUES ('role', %s, %s, %s, %s, %s)
                """, (
                    role_id,
                    module_key,
                    resource_type,
                    str(resource_id),
                    item.get("resourceLabel"),
                ))
            conn.commit()
            return jsonify({"code": 0, "message": "success", "data": None})
    finally:
        conn.close()
