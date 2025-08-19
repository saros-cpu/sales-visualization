"""桌面端认证 API — 使用 JWT（跨域 Electron 无法使用 Session Cookie）"""
from flask import request, jsonify
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    jwt_required, get_jwt_identity
)
from werkzeug.security import check_password_hash, generate_password_hash
from api_v2 import bp_v2
from db import get_connection
from .permission_service import get_effective_auth
import pymysql
from datetime import timedelta


ALL_MODULE_KEYS = (
    'dashboard', 'retail', 'wholesale', 'exchange', 'train_entry',
    'procurement', 'contracts', 'materials', 'transfer_loss', 'map',
    'users', 'aliases', 'weighing', 'settings',
)

DEFAULT_ROLE_MODULES = {
    'admin': ALL_MODULE_KEYS,
    'operator': (
        'dashboard', 'retail', 'wholesale', 'exchange', 'train_entry',
        'procurement', 'contracts', 'materials', 'transfer_loss', 'map',
        'aliases', 'weighing', 'settings',
    ),
    'auditor': (
        'dashboard', 'retail', 'wholesale', 'exchange', 'contracts',
        'aliases', 'weighing', 'map', 'settings',
    ),
    'viewer': ('dashboard', 'retail', 'wholesale', 'exchange', 'map', 'settings'),
    'user': ('dashboard', 'retail', 'wholesale', 'exchange', 'map', 'settings'),
}


def _permission_item(can_edit=False):
    return {'view': True, 'edit': bool(can_edit)}


def _ensure_permission_schema(cur):
    cur.execute('''
        CREATE TABLE IF NOT EXISTS user_module_permissions (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            user_id BIGINT NOT NULL,
            module_key VARCHAR(64) NOT NULL,
            can_view BOOLEAN NOT NULL DEFAULT TRUE,
            can_edit BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_user_module (user_id, module_key),
            KEY idx_user (user_id)
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


def _get_user_authz(user_id, role):
    """Return the new organization auth model and the legacy module map."""
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            authz = get_effective_auth(cur, user_id, role)
            conn.commit()
            return authz
    finally:
        conn.close()


def _get_user_permissions(user_id, role):
    return _get_user_authz(user_id, role)['permissions']


def _get_legacy_user_permissions(user_id, role):
    """获取用户权限：角色授权为基线，用户单独授权覆盖。"""
    if role == 'admin':
        return {'*': _permission_item(can_edit=True)}
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            _ensure_permission_schema(cur)
            cur.execute('SELECT module_key, granted FROM role_module_permissions WHERE role = %s', (role,))
            role_rows = cur.fetchall()
            cur.execute('''
                SELECT module_key, can_view, can_edit
                FROM user_module_permissions
                WHERE user_id = %s
            ''', (user_id,))
            user_rows = cur.fetchall()

            has_current_catalog = any(row['module_key'] in ALL_MODULE_KEYS for row in role_rows)
            if has_current_catalog:
                granted_keys = [
                    row['module_key']
                    for row in role_rows
                    if row['module_key'] in ALL_MODULE_KEYS and row['granted']
                ]
            else:
                granted_keys = list(DEFAULT_ROLE_MODULES.get(role, DEFAULT_ROLE_MODULES['viewer']))

            perms = {key: _permission_item() for key in granted_keys}
            editable_defaults = {'operator'}
            for key in granted_keys:
                if role in editable_defaults:
                    perms[key]['edit'] = True

            for row in user_rows:
                module_key = row['module_key']
                if row['can_view']:
                    perms[module_key] = _permission_item(can_edit=row['can_edit'])
                else:
                    perms.pop(module_key, None)
            return perms
    finally:
        conn.close()


@bp_v2.route('/auth/login', methods=['POST'])
def login():
    """桌面端登录 — 返回 JWT Token"""
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'code': 4221, 'message': '请输入用户名和密码', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, username, password_hash, display_name, role, is_active 
                FROM system_users WHERE username = %s
            ''', (username,))
            user = cur.fetchone()

        if not user or not check_password_hash(user['password_hash'], password):
            return jsonify({'code': 4001, 'message': '用户名或密码错误', 'data': None}), 401

        if not user['is_active']:
            return jsonify({'code': 4003, 'message': '账户已被禁用', 'data': None}), 403

        with conn.cursor() as cur:
            cur.execute('UPDATE system_users SET last_login_at = NOW() WHERE id = %s', (user['id'],))
        conn.commit()

        identity = str(user['id'])
        access_token = create_access_token(
            identity=identity,
            additional_claims={
                'username': user['username'],
                'role': user['role'],
            },
            expires_delta=timedelta(hours=2)
        )
        refresh_token = create_refresh_token(
            identity=identity,
            expires_delta=timedelta(days=7)
        )

        authz = _get_user_authz(user['id'], user['role'])

        return jsonify({
            'code': 0,
            'message': 'success',
            'data': {
                'accessToken': access_token,
                'refreshToken': refresh_token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'displayName': user['display_name'],
                    'role': user['role'],
                },
                'permissions': authz['permissions'],
                'permissionCodes': authz['permissionCodes'],
                'roles': authz['roles'],
                'departments': authz['departments'],
                'dataScopes': authz['dataScopes'],
            }
        })
    finally:
        conn.close()


@bp_v2.route('/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """刷新 Token"""
    identity = get_jwt_identity()
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('SELECT username, role FROM system_users WHERE id = %s AND is_active = TRUE', (identity,))
            user = cur.fetchone()
        if not user:
            return jsonify({'code': 4001, 'message': 'з”Ёж€·дёЌе­ењЁ', 'data': None}), 401
        access_token = create_access_token(
            identity=identity,
            additional_claims={
                'username': user['username'],
                'role': user['role'],
            },
            expires_delta=timedelta(hours=2)
        )
    finally:
        conn.close()
    return jsonify({
        'code': 0, 'message': 'success',
        'data': {'accessToken': access_token}
    })


@bp_v2.route('/auth/logout', methods=['POST'])
def logout():
    return jsonify({'code': 0, 'message': 'success', 'data': None})


@bp_v2.route('/auth/me', methods=['GET'])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, username, display_name, role
                FROM system_users WHERE id = %s
            ''', (user_id,))
            user = cur.fetchone()
        if not user:
            return jsonify({'code': 4001, 'message': '用户不存在', 'data': None}), 401

        authz = _get_user_authz(user['id'], user['role'])
        return jsonify({
            'code': 0, 'message': 'success',
            'data': {
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'displayName': user['display_name'],
                    'role': user['role'],
                },
                'permissions': authz['permissions'],
                'permissionCodes': authz['permissionCodes'],
                'roles': authz['roles'],
                'departments': authz['departments'],
                'dataScopes': authz['dataScopes'],
            }
        })
    finally:
        conn.close()


@bp_v2.route('/auth/change-password', methods=['POST'])
@jwt_required()
def change_password():
    """用户修改自己的密码（需旧密码验证）"""
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    old_password = data.get('oldPassword', '')
    new_password = data.get('newPassword', '')

    if not old_password or not new_password:
        return jsonify({'code': 4221, 'message': '旧密码和新密码不能为空', 'data': None}), 422
    if len(new_password) < 6:
        return jsonify({'code': 4221, 'message': '新密码长度不能少于6位', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('SELECT password_hash FROM system_users WHERE id = %s', (user_id,))
            user = cur.fetchone()
            if not user:
                return jsonify({'code': 4004, 'message': '用户不存在', 'data': None}), 404
            if not check_password_hash(user['password_hash'], old_password):
                return jsonify({'code': 4001, 'message': '旧密码错误', 'data': None}), 401

            new_hash = generate_password_hash(new_password)
            cur.execute('UPDATE system_users SET password_hash = %s WHERE id = %s', (new_hash, user_id))
            conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()
