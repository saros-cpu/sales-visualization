from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from api_v2 import bp_v2
from werkzeug.security import generate_password_hash
import pymysql
from db import get_connection
from shared_utils import ensure_auth_schema
from .permission_service import (
    ensure_permission_schema as ensure_org_permission_schema,
    ensure_user_org_assignments,
    has_permission,
    list_user_departments,
    list_user_roles,
    set_user_departments,
    set_user_roles,
)


ROLES = ('admin', 'operator', 'auditor', 'viewer')

MODULE_CATALOG = [
    ('dashboard', '数据可视化', 10),
    ('retail', '零售', 20),
    ('wholesale', '批发', 30),
    ('exchange', '汇率查询', 40),
    ('train_entry', '数据录入', 50),
    ('procurement', '采购查询', 60),
    ('contracts', '合同管理', 70),
    ('materials', '物资调拨', 80),
    ('transfer_loss', '外运损耗', 90),
    ('map', '3D 地图', 100),
    ('knowledge', '知识库', 105),
    ('users', '用户管理', 110),
    ('aliases', '别名管理', 120),
    ('weighing', '称重审核', 130),
    ('audit_logs', '审计日志', 135),
    ('settings', '设置', 140),
]

DEFAULT_ROLE_MODULES = {
    'admin': tuple(key for key, _, _ in MODULE_CATALOG),
    'operator': (
        'dashboard', 'retail', 'wholesale', 'exchange', 'train_entry',
        'procurement', 'contracts', 'materials', 'transfer_loss', 'map',
        'knowledge', 'aliases', 'weighing', 'settings',
    ),
    'auditor': (
        'dashboard', 'retail', 'wholesale', 'exchange', 'contracts',
        'knowledge', 'aliases', 'weighing', 'map', 'settings',
    ),
    'viewer': ('dashboard', 'retail', 'wholesale', 'exchange', 'map', 'knowledge', 'settings'),
}


def _ensure_permission_catalog(cur):
    cur.execute('''
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
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS role_module_permissions (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            role VARCHAR(64) NOT NULL,
            module_key VARCHAR(64) NOT NULL,
            granted BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_role_module (role, module_key),
            KEY idx_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ''')
    for module_key, module_name, sort_order in MODULE_CATALOG:
        cur.execute('''
            INSERT INTO app_modules (module_key, module_name, sort_order, is_active)
            VALUES (%s, %s, %s, TRUE)
            ON DUPLICATE KEY UPDATE
                module_name = VALUES(module_name),
                sort_order = VALUES(sort_order),
                is_active = TRUE
        ''', (module_key, module_name, sort_order))

    for role in ROLES:
        granted = set(DEFAULT_ROLE_MODULES[role])
        for module_key, _, _ in MODULE_CATALOG:
            cur.execute('''
                INSERT INTO role_module_permissions (role, module_key, granted)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE role = role
            ''', (role, module_key, module_key in granted))


def _ensure_user_role_column(cur):
    cur.execute("SHOW COLUMNS FROM system_users LIKE 'role'")
    row = cur.fetchone()
    if not row:
        return
    column_type = str(row.get('Type') if isinstance(row, dict) else row[1])
    if 'operator' in column_type and 'viewer' in column_type:
        return
    if column_type.lower().startswith('enum'):
        cur.execute("ALTER TABLE system_users MODIFY role VARCHAR(64) NOT NULL DEFAULT 'viewer'")
        cur.execute("UPDATE system_users SET role = 'viewer' WHERE role = 'user'")


def _current_user(cur):
    user_id = int(get_jwt_identity())
    cur.execute(
        'SELECT id, role FROM system_users WHERE id = %s AND is_active = TRUE',
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    return {
        'id': row['id'] if isinstance(row, dict) else row[0],
        'role': row['role'] if isinstance(row, dict) else row[1],
    }


def _require_any(cur, permission_codes):
    user = _current_user(cur)
    if not user:
        return None, (jsonify({'code': 4001, 'message': 'unauthorized', 'data': None}), 401)
    if user['role'] == 'admin':
        return user['id'], None
    if any(has_permission(cur, user['id'], code, user['role']) for code in permission_codes):
        return user['id'], None
    return None, (jsonify({'code': 4003, 'message': 'forbidden', 'data': None}), 403)


def _require_admin(cur):
    user = _current_user(cur)
    if not user:
        return None, (jsonify({'code': 4001, 'message': 'unauthorized', 'data': None}), 401)
    if user['role'] != 'admin':
        return None, (jsonify({'code': 4003, 'message': 'forbidden', 'data': None}), 403)
    return user['id'], None


@bp_v2.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_auth_schema(cur)
            _, error = _require_any(cur, ['users:view', 'users:manage'])
            if error:
                return error
            _ensure_user_role_column(cur)
            ensure_org_permission_schema(cur)
            conn.commit()
            cur.execute('''
                SELECT id, username, display_name, role, is_active, must_change_password, last_login_at, created_at
                FROM system_users ORDER BY id
            ''')
            users = []
            for row in cur.fetchall():
                ensure_user_org_assignments(cur, row['id'], row['role'])
                users.append({
                    'id': row['id'],
                    'username': row['username'],
                    'displayName': row['display_name'],
                    'role': row['role'],
                    'roles': list_user_roles(cur, row['id']),
                    'departments': list_user_departments(cur, row['id']),
                    'isActive': bool(row['is_active']),
                    'mustChangePassword': bool(row['must_change_password']),
                    'lastLoginAt': str(row['last_login_at']) if row['last_login_at'] else None,
                    'createdAt': str(row['created_at']),
                })
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': users})
    finally:
        conn.close()


@bp_v2.route('/users', methods=['POST'])
@jwt_required()
def create_user():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    display_name = data.get('displayName', '')
    role_codes = data.get('roleCodes')
    if not isinstance(role_codes, list):
        role_codes = [data.get('role') or 'viewer']
    role = role_codes[0] if role_codes else 'viewer'
    department_ids = data.get('departmentIds') if isinstance(data.get('departmentIds'), list) else []
    if password and len(password) < 8:
        return jsonify({'code': 4221, 'message': '密码长度不能少于8位', 'data': None}), 422

    if not username or not password:
        return jsonify({'code': 4221, 'message': '用户名和密码不能为空', 'data': None}), 422

    password_hash = generate_password_hash(password)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            ensure_auth_schema(cur)
            _, error = _require_any(cur, ['users:create', 'users:manage'])
            if error:
                return error
            _ensure_user_role_column(cur)
            ensure_org_permission_schema(cur)
            cur.execute('''
                INSERT INTO system_users
                    (username, password_hash, display_name, role, is_active, must_change_password, password_reset_at)
                VALUES (%s, %s, %s, %s, 1, TRUE, NOW())
            ''', (username, password_hash, display_name, role))
            user_id = cur.lastrowid
            primary_role = set_user_roles(cur, user_id, role_codes, role)
            set_user_departments(cur, user_id, department_ids)
            cur.execute('UPDATE system_users SET role = %s WHERE id = %s', (primary_role, user_id))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': user_id}})
    except pymysql.err.IntegrityError:
        return jsonify({'code': 4222, 'message': '用户名已存在', 'data': None}), 422
    finally:
        conn.close()


@bp_v2.route('/users/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            ensure_auth_schema(cur)
            _, error = _require_any(cur, ['users:update', 'users:manage'])
            if error:
                return error
            updates = []
            params = []
            if 'displayName' in data:
                updates.append('display_name = %s')
                params.append(data['displayName'])
            if 'role' in data:
                if not data['role']:
                    return jsonify({'code': 4223, 'message': '角色无效', 'data': None}), 422
                _ensure_user_role_column(cur)
                ensure_org_permission_schema(cur)
                set_user_roles(cur, user_id, [data['role']], data['role'])
                updates.append('role = %s')
                params.append(data['role'])
            if isinstance(data.get('roleCodes'), list):
                ensure_org_permission_schema(cur)
                primary_role = set_user_roles(cur, user_id, data.get('roleCodes'), data.get('role'))
                updates.append('role = %s')
                params.append(primary_role)
            if isinstance(data.get('departmentIds'), list):
                ensure_org_permission_schema(cur)
                set_user_departments(cur, user_id, data.get('departmentIds'))
            if 'isActive' in data:
                updates.append('is_active = %s')
                params.append(1 if data['isActive'] else 0)
            if updates:
                params.append(user_id)
                cur.execute(f'UPDATE system_users SET {", ".join(updates)} WHERE id = %s', params)
                conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/users/<int:user_id>/reset-password', methods=['PUT'])
@jwt_required()
def reset_password(user_id):
    data = request.get_json() or {}
    new_password = data.get('password', '')
    if new_password and len(new_password) < 8:
        return jsonify({'code': 4221, 'message': '密码长度不能少于8位', 'data': None}), 422
    if not new_password:
        return jsonify({'code': 4221, 'message': '密码不能为空', 'data': None}), 422

    password_hash = generate_password_hash(new_password)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            ensure_auth_schema(cur)
            _, error = _require_any(cur, ['users:reset_password', 'users:manage'])
            if error:
                return error
            cur.execute('''
                UPDATE system_users
                SET password_hash = %s,
                    must_change_password = TRUE,
                    password_changed_at = NULL,
                    password_reset_at = NOW()
                WHERE id = %s
            ''', (password_hash, user_id))
            conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/users/<int:user_id>/permissions', methods=['PUT'])
@jwt_required()
def update_permissions(user_id):
    data = request.get_json() or {}
    permissions = data.get('permissions', [])

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            _, error = _require_any(cur, ['users:manage', 'roles:manage'])
            if error:
                return error
            cur.execute('DELETE FROM user_module_permissions WHERE user_id = %s', (user_id,))
            for perm in permissions:
                cur.execute('''
                    INSERT INTO user_module_permissions (user_id, module_key, can_view, can_edit)
                    VALUES (%s, %s, %s, %s)
                ''', (user_id, perm['moduleKey'], perm.get('canView', 1), perm.get('canEdit', 0)))
            conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/users/permissions/modules', methods=['GET'])
@jwt_required()
def list_modules():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _, error = _require_any(cur, ['users:manage', 'roles:manage'])
            if error:
                return error
            _ensure_permission_catalog(cur)
            conn.commit()
            cur.execute('SELECT id, module_key, module_name FROM app_modules WHERE is_active = 1 ORDER BY sort_order, id')
            rows = cur.fetchall()
        data = [{'id': r['id'], 'moduleKey': r['module_key'], 'moduleName': r['module_name']} for r in rows]
        return jsonify({'code': 0, 'message': 'success', 'data': data})
    finally:
        conn.close()


@bp_v2.route('/users/permissions', methods=['GET'])
@jwt_required()
def list_role_permissions():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _, error = _require_any(cur, ['users:manage', 'roles:manage'])
            if error:
                return error
            _ensure_permission_catalog(cur)
            conn.commit()
            cur.execute('''
                SELECT roles.role, m.module_key, COALESCE(r.granted, 0) AS granted
                FROM (
                    SELECT 'admin' AS role UNION ALL
                    SELECT 'operator' UNION ALL
                    SELECT 'auditor' UNION ALL
                    SELECT 'viewer'
                ) roles
                JOIN app_modules m ON m.is_active = 1
                LEFT JOIN role_module_permissions r
                  ON r.role = roles.role AND r.module_key = m.module_key
                ORDER BY m.sort_order, m.id
            ''')
            data = [{'role': r['role'], 'moduleKey': r['module_key'], 'granted': bool(r['granted'])} for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': data})
    finally:
        conn.close()


@bp_v2.route('/users/permissions', methods=['PUT'])
@jwt_required()
def save_role_permissions():
    data = request.get_json() or {}
    permissions = data.get('permissions', [])
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            _, error = _require_any(cur, ['users:manage', 'roles:manage'])
            if error:
                return error
            _ensure_permission_catalog(cur)
            cur.execute('DELETE FROM role_module_permissions')
            for perm in permissions:
                role = perm.get('role')
                module_key = perm.get('moduleKey')
                if role not in ROLES or not module_key:
                    continue
                cur.execute(
                    'INSERT INTO role_module_permissions (role, module_key, granted) VALUES (%s, %s, %s)',
                    (role, module_key, 1 if perm.get('granted') else 0),
                )
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()
