from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt_identity
import pymysql

from db import get_connection
from .permission_service import has_permission


def permission_required(permission_code: str):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user_id = int(get_jwt_identity())
            conn = get_connection()
            try:
                with conn.cursor(pymysql.cursors.DictCursor) as cur:
                    cur.execute(
                        "SELECT role FROM system_users WHERE id = %s AND is_active = TRUE",
                        (user_id,),
                    )
                    user = cur.fetchone()
                    if not user:
                        return jsonify({"code": 4001, "message": "unauthorized", "data": None}), 401
                    if user["role"] != "admin" and not has_permission(cur, user_id, permission_code, user["role"]):
                        return jsonify({"code": 4003, "message": "forbidden", "data": None}), 403
                    conn.commit()
            finally:
                conn.close()
            return fn(*args, **kwargs)
        return wrapper
    return decorator
