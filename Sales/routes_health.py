from __future__ import annotations

from flask import jsonify

"""健康检查路由（自 api.py 纯搬移拆分）。"""

def health():
    return jsonify({"ok": True, "project": "销售数据可视化"})


# Register route modules


def register_health_routes(app):
    app.add_url_rule("/api/health", "health", health)
