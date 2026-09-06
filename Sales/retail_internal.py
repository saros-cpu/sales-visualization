from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from threading import Lock


PROJECT_ROOT = Path(__file__).resolve().parent
OILSTATION_ROOT = PROJECT_ROOT.parent / "OilStation"

_APP = None
_LOCK = Lock()

_MODULES_TO_ISOLATE = (
    "api",
    "config",
    "db",
    "business_time",
    "cache_store",
    "constants",
    "export_excel",
    "routes",
    "routes.basic",
)


def oilstation_app():
    global _APP
    if _APP is not None:
        return _APP

    with _LOCK:
        if _APP is not None:
            return _APP

        saved_modules = {name: sys.modules.get(name) for name in _MODULES_TO_ISOLATE}
        for name in _MODULES_TO_ISOLATE:
            sys.modules.pop(name, None)

    sys.path.insert(0, str(OILSTATION_ROOT / "scripts"))
    sys.path.insert(0, str(OILSTATION_ROOT))
    try:
        spec = importlib.util.spec_from_file_location(
            "embedded_oilstation_api",
            OILSTATION_ROOT / "api.py",
        )
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        _APP = module.app
        return _APP
    finally:
        try:
            sys.path.remove(str(OILSTATION_ROOT))
        except ValueError:
            pass
        for name, module in saved_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def open_oilstation(path, method="GET", query_string=None, data=None, headers=None):
    client = oilstation_app().test_client()
    return client.open(
        path=path,
        method=method,
        query_string=query_string,
        data=data,
        headers=headers or {},
    )


def get_oilstation_json(path, query_string=None):
    response = open_oilstation(path, query_string=query_string)
    if response.status_code >= 400:
        raise RuntimeError(response.get_data(as_text=True))
    return response.get_json()


# Both Sales and OilStation expose these names at the top level. When an OilStation
# module is imported from a test, its `from config import ...` / `from constants import ...`
# would otherwise bind these names to OilStation's versions in the shared sys.modules and
# leak into every later test. Isolate them around the import.
_OILSTATION_IMPORT_ISOLATE = (
    "api",
    "config",
    "db",
    "business_time",
    "cache_store",
    "constants",
    "export_excel",
    "routes",
    "routes.basic",
    "scripts",
)


def import_oilstation(dotted_name):
    """Import an OilStation module (e.g. ``endpoints.v1.retail.export.service.daily_briefing``
    or ``constants``) without clobbering Sales' same-named top-level modules in the shared
    ``sys.modules``.

    OilStation modules bind their dependencies (config/constants/...) at module level, so the
    returned module keeps working after isolation is released.
    """
    saved = {name: sys.modules.get(name) for name in _OILSTATION_IMPORT_ISOLATE}
    for name in _OILSTATION_IMPORT_ISOLATE:
        sys.modules.pop(name, None)
    sys.path.insert(0, str(OILSTATION_ROOT / "scripts"))
    sys.path.insert(0, str(OILSTATION_ROOT))
    try:
        return importlib.import_module(dotted_name)
    finally:
        try:
            sys.path.remove(str(OILSTATION_ROOT))
        except ValueError:
            pass
        for name, module in saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module
