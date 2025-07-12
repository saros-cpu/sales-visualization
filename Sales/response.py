from __future__ import annotations

from typing import Any, Optional

from flask import jsonify


def ok(data: Any = None, message: str = "success"):
    return jsonify({"code": 0, "message": message, "data": data})


def fail(message: str = "error", http_code: int = 400, biz_code: Optional[int] = None):
    body_code = biz_code if biz_code is not None else http_code
    return jsonify({"code": body_code, "message": message, "data": None}), http_code
