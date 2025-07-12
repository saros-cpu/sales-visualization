from flask import request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from api_v2 import bp_v2
from werkzeug.security import generate_password_hash
import pymysql
from db import get_connection


def _require_admin():
    claims = get_jwt()
    if claims.get('role') != 'admin':
        return None, (jsonify({'code': 4003, 'message': '无权限', 'data': None}), 403)
    return int(get_jwt_identity()), None


@bp_v2.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    _, error = _require_admin()
    if error:
        return error

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('''
                SELECT id, username, display_name, role, is_active, last_login_at, created_at
                FROM system_users ORDER BY id
            ''')
            users = []
            for row in cur.fetchall():
                users.append({
                    'id': row['id'],
                    'username': row['username'],
                    'displayName': row['display_name'],
                    'role': row['role'],
                    'isActive': bool(row['is_active']),
                    'lastLoginAt': str(row['last_login_at']) if row['last_login_at'] else None,
                    'createdAt': str(row['created_at']),
                })
            return jsonify({'code': 0, 'message': 'success', 'data': users})
    finally:
        conn.close()


@bp_v2.route('/users', methods=['POST'])
@jwt_required()
def create_user():
    _, error = _require_admin()
    if error:
        return error

    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')
    display_name = data.get('displayName', '')
    role = data.get('role', 'viewer')

    if not username or not password:
        return jsonify({'code': 4221, 'message': '用户名和密码不能为空', 'data': None}), 422

    password_hash = generate_password_hash(password)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('''
                INSERT INTO system_users (username, password_hash, display_name, role, is_active)
                VALUES (%s, %s, %s, %s, 1)
            ''', (username, password_hash, display_name, role))
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': {'id': cur.lastrowid}})
    except pymysql.err.IntegrityError:
        return jsonify({'code': 4222, 'message': '用户名已存在', 'data': None}), 422
    finally:
        conn.close()


@bp_v2.route('/users/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    _, error = _require_admin()
    if error:
        return error

    data = request.get_json() or {}
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            updates = []
            params = []
            if 'displayName' in data:
                updates.append('display_name = %s')
                params.append(data['displayName'])
            if 'role' in data:
                updates.append('role = %s')
                params.append(data['role'])
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
    _, error = _require_admin()
    if error:
        return error

    data = request.get_json() or {}
    new_password = data.get('password', '')
    if not new_password:
        return jsonify({'code': 4221, 'message': '密码不能为空', 'data': None}), 422

    password_hash = generate_password_hash(new_password)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('UPDATE system_users SET password_hash = %s WHERE id = %s',
                       (password_hash, user_id))
            conn.commit()
        return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()


@bp_v2.route('/users/<int:user_id>/permissions', methods=['PUT'])
@jwt_required()
def update_permissions(user_id):
    _, error = _require_admin()
    if error:
        return error

    data = request.get_json() or {}
    permissions = data.get('permissions', [])

    conn = get_connection()
    try:
        with conn.cursor() as cur:
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
            cur.execute('SELECT id, module_key, module_name FROM app_modules WHERE is_active = 1 ORDER BY sort_order, id')
            rows = cur.fetchall()
        if rows:
            data = [{'id': r['id'], 'moduleKey': r['module_key'], 'moduleName': r['module_name']} for r in rows]
            return jsonify({'code': 0, 'message': 'success', 'data': data})
    finally:
        conn.close()
    modules = [
        {'key': 'dashboard', 'label': '首页看板'},
        {'key': 'retail', 'label': '零售查看'},
        {'key': 'weighing_view', 'label': '称重浏览'},
        {'key': 'weighing_verify', 'label': '称重审核'},
        {'key': 'train_entry', 'label': '火车录入'},
        {'key': 'wholesale', 'label': '批发/采购查看'},
        {'key': 'contracts', 'label': '合同管理'},
        {'key': 'materials', 'label': '物资调拨'},
        {'key': 'transfer_loss', 'label': '外运损耗'},
        {'key': 'users', 'label': '用户管理'},
    ]
    data = [{'id': i + 1, 'moduleKey': m['key'], 'moduleName': m['label']} for i, m in enumerate(modules)]
    return jsonify({'code': 0, 'message': 'success', 'data': data})


@bp_v2.route('/users/permissions', methods=['GET'])
@jwt_required()
def list_role_permissions():
    _, error = _require_admin()
    if error:
        return error
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute('SELECT role, module_key, granted FROM role_module_permissions')
            data = [{'role': r['role'], 'moduleKey': r['module_key'], 'granted': bool(r['granted'])} for r in cur.fetchall()]
            return jsonify({'code': 0, 'message': 'success', 'data': data})
    finally:
        conn.close()


@bp_v2.route('/users/permissions', methods=['PUT'])
@jwt_required()
def save_role_permissions():
    _, error = _require_admin()
    if error:
        return error
    data = request.get_json() or {}
    permissions = data.get('permissions', [])
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM role_module_permissions')
            for perm in permissions:
                cur.execute(
                    'INSERT INTO role_module_permissions (role, module_key, granted) VALUES (%s, %s, %s)',
                    (perm['role'], perm['moduleKey'], 1 if perm.get('granted') else 0),
                )
            conn.commit()
            return jsonify({'code': 0, 'message': 'success', 'data': None})
    finally:
        conn.close()
