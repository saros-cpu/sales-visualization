from __future__ import annotations

import re
from pathlib import Path

from flask import jsonify, send_from_directory

PROJECT_ROOT = Path(__file__).resolve().parent

"""桌面端安装包下载路由（自 api.py 纯搬移拆分）。"""

def download_desktop(filename: str):
    allowed_installer = re.fullmatch(r"SalesDesktop Setup \d+\.\d+\.\d+\.exe(?:\.blockmap)?", filename)
    if filename != "latest.yml" and not allowed_installer:
        return jsonify({"error": "not_found"}), 404
    desktop_root = PROJECT_ROOT.parent / "SalesDesktop"
    candidates = [
        desktop_root / "download" / filename,
        desktop_root / filename,
        desktop_root / "release_build" / filename,
    ]
    filepath = next((item for item in candidates if item.is_file()), None)
    if filepath is None:
        return jsonify({"error": "file_not_ready"}), 404
    return send_from_directory(str(filepath.parent), filepath.name, as_attachment=True)


def register_download_routes(app):
    app.add_url_rule("/api/download/<filename>", "download_desktop", download_desktop)
