"""桌面端 API v2 蓝图"""
from flask import Blueprint

bp_v2 = Blueprint('api_v2', __name__, url_prefix='/api/v2')

from . import auth, weighing, train_entry, wholesale, procurement, contracts, materials, transfer_loss, users, dashboard, map, aliases, organization, audit_logs, assistant, system, retail_alerts  # noqa


def register_v2_blueprints(app):
    app.register_blueprint(bp_v2)
