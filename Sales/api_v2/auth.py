"""桌面端认证 API — 使用 JWT（跨域 Electron 无法使用 Session Cookie）"""
from flask import request, jsonify, session
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    decode_token, get_jwt, jwt_required, get_jwt_identity, verify_jwt_in_request
)
from werkzeug.security import check_password_hash, generate_password_hash
from api_v2 import bp_v2
from db import get_connection
from shared_utils import ensure_auth_schema, has_users
from .permission_service import get_effective_auth
from .token_revocation import revoke_jwt_payload
import pymysql
from datetime import timedelta


def _get_user_authz(user_id, role):
    """Return the effective organization permission payload for the user."""
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            authz = get_effective_auth(cur, user_id, role)
            conn.commit()
            return authz
    finally:
        conn.close()


def _user_payload(user):
    return {
        'id': user['id'],
        'username': user['username'],
        'displayName': user['display_name'],
        'role': user['role'],
        'mustChangePassword': bool(user.get('must_change_password')),
    }


def _store_session_user(user):
    payload = _user_payload(user)
    session.permanent = True
    session['user'] = payload
    return payload


def _create_tokens(user):
    identity = str(user['id'])
    access_token = create_access_token(
        identity=identity,
        additional_claims={
            'username': user['username'],
            'role': user['role'],
            'mustChangePassword': bool(user.get('must_change_password')),
        },
        expires_delta=timedelta(hours=2)
    )
    refresh_token = create_refresh_token(
        identity=identity,
        expires_delta=timedelta(days=7)
    )
    return access_token, refresh_token


def _auth_payload(user, include_tokens=False):
    authz = _get_user_authz(user['id'], user['role'])
    payload = {
        'user': _store_session_user(user),
        'permissions': authz['permissions'],
        'permissionCodes': authz['permissionCodes'],
        'roles': authz['roles'],
        'departments': authz['departments'],
        'dataScopes': authz['dataScopes'],
    }
    if include_tokens:
        access_token, refresh_token = _create_tokens(user)
        payload.update({'accessToken': access_token, 'refreshToken': refresh_token})
    return payload


@bp_v2.route('/auth/status', methods=['GET'])
def status():
    user = None
    identity = None
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
    except Exception:
        identity = None

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_auth_schema(cur)
            if identity:
                cur.execute('''
                    SELECT id, username, display_name, role, must_change_password
                    FROM system_users WHERE id = %s AND is_active = TRUE
                ''', (identity,))
                user = cur.fetchone()
            elif isinstance(session.get('user'), dict) and session['user'].get('id'):
                cur.execute('''
                    SELECT id, username, display_name, role, must_change_password
                    FROM system_users WHERE id = %s AND is_active = TRUE
                ''', (session['user'].get('id'),))
                user = cur.fetchone()
            has_any_user = has_users(cur)
    finally:
        conn.close()

    data = {'hasUsers': has_any_user, 'authenticated': bool(user), 'user': None}
    if user:
        # Web sessions may be restored from the Flask session cookie after a
        # reload; return fresh JWTs so v2 API calls do not bounce back to login.
        data.update(_auth_payload(user, include_tokens=True))
    return jsonify({'code': 0, 'message': 'success', 'data': data})


@bp_v2.route('/auth/bootstrap', methods=['POST'])
def bootstrap():
    data = request.get_json() or {}
    username = str(data.get('username') or '').strip()
    password = data.get('password') or ''
    display_name = str(data.get('displayName') or '').strip() or username
    if not username or len(password) < 8:
        return jsonify({'code': 4221, 'message': 'username and password length >= 8 are required', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_auth_schema(cur)
            if has_users(cur):
                return jsonify({'code': 4091, 'message': 'admin already exists', 'data': None}), 409
            cur.execute('''
                INSERT INTO system_users
                    (username, password_hash, display_name, role, must_change_password, password_changed_at)
                VALUES (%s, %s, %s, 'admin', FALSE, NOW())
            ''', (username, generate_password_hash(password), display_name))
            user_id = cur.lastrowid
            conn.commit()
        user = {
            'id': user_id,
            'username': username,
            'display_name': display_name,
            'role': 'admin',
            'must_change_password': False,
        }
        return jsonify({'code': 0, 'message': 'success', 'data': _auth_payload(user, include_tokens=True)})
    except Exception:
        conn.rollback()
        raise
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
            ensure_auth_schema(cur)
            cur.execute('''
                SELECT id, username, password_hash, display_name, role, is_active, must_change_password
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

        return jsonify({
            'code': 0,
            'message': 'success',
            'data': _auth_payload(user, include_tokens=True)
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
            ensure_auth_schema(cur)
            cur.execute('SELECT username, role, must_change_password FROM system_users WHERE id = %s AND is_active = TRUE', (identity,))
            user = cur.fetchone()
        if not user:
            return jsonify({'code': 4001, 'message': '用户不存在', 'data': None}), 401
        access_token = create_access_token(
            identity=identity,
            additional_claims={
                'username': user['username'],
                'role': user['role'],
                'mustChangePassword': bool(user.get('must_change_password')),
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
    data = request.get_json(silent=True) or {}
    try:
        verify_jwt_in_request(optional=True)
        jwt_payload = get_jwt() or {}
    except Exception:
        jwt_payload = {}
    revoked_count = revoke_jwt_payload(jwt_payload) if jwt_payload else 0
    refresh_token = (data.get('refreshToken') or '').strip()
    if refresh_token:
        try:
            revoked_count += revoke_jwt_payload(decode_token(refresh_token))
        except Exception:
            pass
    session.clear()
    return jsonify({'code': 0, 'message': 'success', 'data': {'revoked': revoked_count}})


@bp_v2.route('/auth/me', methods=['GET'])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_auth_schema(cur)
            cur.execute('''
                SELECT id, username, display_name, role, must_change_password
                FROM system_users WHERE id = %s AND is_active = TRUE
            ''', (user_id,))
            user = cur.fetchone()
        if not user:
            return jsonify({'code': 4001, 'message': '用户不存在', 'data': None}), 401

        return jsonify({
            'code': 0, 'message': 'success',
            'data': _auth_payload(user)
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
    if len(new_password) < 8:
        return jsonify({'code': 4221, 'message': '新密码长度不能少于8位', 'data': None}), 422

    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_auth_schema(cur)
            cur.execute('SELECT password_hash FROM system_users WHERE id = %s', (user_id,))
            user = cur.fetchone()
            if not user:
                return jsonify({'code': 4004, 'message': '用户不存在', 'data': None}), 404
            if not check_password_hash(user['password_hash'], old_password):
                return jsonify({'code': 4001, 'message': '旧密码错误', 'data': None}), 401

            if check_password_hash(user['password_hash'], new_password):
                return jsonify({'code': 4221, 'message': '新密码不能与旧密码相同', 'data': None}), 422

            new_hash = generate_password_hash(new_password)
            cur.execute('''
                UPDATE system_users
                SET password_hash = %s,
                    must_change_password = FALSE,
                    password_changed_at = NOW()
                WHERE id = %s
            ''', (new_hash, user_id))
            conn.commit()
        if isinstance(session.get('user'), dict):
            session['user'] = {**session['user'], 'mustChangePassword': False}
        return jsonify({'code': 0, 'message': 'success', 'data': {'mustChangePassword': False}})
    finally:
        conn.close()
