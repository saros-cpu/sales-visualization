import hashlib
import json
import os
from pathlib import Path

from flask import jsonify, send_file

DESKTOP_DIST = Path(__file__).resolve().parent.parent / "SalesDesktop" / "dist"


def register_update_routes(app):
    @app.route("/api/update/version.json")
    def update_version():
        version_file = DESKTOP_DIST / "version.json"
        if not version_file.exists():
            return jsonify({"error": "not found"}), 404
        return jsonify(json.loads(version_file.read_text(encoding="utf-8")))

    @app.route("/api/update/app.exe")
    def update_app_exe():
        app_exe = DESKTOP_DIST / "app.exe"
        if not app_exe.exists():
            return jsonify({"error": "not found"}), 404
        return send_file(str(app_exe), mimetype="application/octet-stream")
