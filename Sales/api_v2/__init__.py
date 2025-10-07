"""桌面端 API v2 蓝图"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from db import get_connection
from shared_utils import user_requires_password_change

bp_v2 = Blueprint('api_v2', __name__, url_prefix='/api/v2')


PASSWORD_CHANGE_ALLOWED_PATHS = {
    '/api/v2/auth/login',
    '/api/v2/auth/logout',
    '/api/v2/auth/refresh',
    '/api/v2/auth/me',
    '/api/v2/auth/change-password',
}


@bp_v2.before_request
def enforce_password_change():
    if request.method == 'OPTIONS' or request.path in PASSWORD_CHANGE_ALLOWED_PATHS:
        return None
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
    except Exception:
        return None
    if not identity:
        return None
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            if user_requires_password_change(cur, identity):
                return jsonify({
                    'code': 4091,
                    'message': 'password_change_required',
                    'data': {'mustChangePassword': True},
                }), 403
    finally:
        conn.close()
    return None

from . import auth, weighing, train_entry, wholesale, procurement, contracts, materials, transfer_loss, users, dashboard, map, aliases, organization, audit_logs, assistant, system, retail_alerts, management, knowledge  # noqa


def register_v2_blueprints(app):
    app.register_blueprint(bp_v2)
