from __future__ import annotations

import logging
from time import time
from typing import Any, Mapping
import threading

from db import get_connection

logger = logging.getLogger(__name__)

_REVOKED_TOKEN_EXPIRY_BY_JTI: dict[str, int] = {}
_lock = threading.Lock()
_loaded_from_db = False


def _purge_expired(now: int | None = None) -> list[str]:
    current = int(time()) if now is None else now
    expired = [jti for jti, exp in _REVOKED_TOKEN_EXPIRY_BY_JTI.items() if exp <= current]
    for jti in expired:
        _REVOKED_TOKEN_EXPIRY_BY_JTI.pop(jti, None)
    return expired


def _delete_expired_from_db(now: int) -> None:
    try:
        conn = get_connection(autocommit=True)
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM system_revoked_tokens WHERE expires_at <= %s", (now,))
        finally:
            conn.close()
    except Exception:
        logger.debug("Failed to delete expired revoked tokens from DB", exc_info=True)


def _load_revoked_from_db() -> None:
    global _loaded_from_db
    if _loaded_from_db:
        return
    try:
        conn = get_connection(autocommit=True)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT jti, expires_at FROM system_revoked_tokens WHERE expires_at > %s",
                    (int(time()),),
                )
                for jti, exp in cur.fetchall():
                    _REVOKED_TOKEN_EXPIRY_BY_JTI[str(jti)] = int(exp)
        finally:
            conn.close()
    except Exception:
        logger.warning("Failed to load revoked tokens from DB", exc_info=True)
    _loaded_from_db = True


def _persist_revoked_token(jti: str, exp: int) -> None:
    try:
        conn = get_connection(autocommit=True)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO system_revoked_tokens (jti, expires_at) VALUES (%s, %s) "
                    "ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)",
                    (jti, exp),
                )
        finally:
            conn.close()
    except Exception:
        logger.warning("Failed to persist revoked token %s to DB", jti, exc_info=True)


def revoke_jwt_payload(payload: Mapping[str, Any] | None) -> int:
    if not payload:
        return 0
    jti = str(payload.get("jti") or "").strip()
    if not jti:
        return 0
    exp = int(payload.get("exp") or (int(time()) + 3600))
    with _lock:
        expired = _purge_expired()
        _REVOKED_TOKEN_EXPIRY_BY_JTI[jti] = exp
    if expired:
        _delete_expired_from_db(int(time()))
    _persist_revoked_token(jti, exp)
    return 1


def is_token_revoked_payload(payload: Mapping[str, Any] | None) -> bool:
    if not payload:
        return False
    _load_revoked_from_db()
    with _lock:
        expired = _purge_expired()
        jti = str(payload.get("jti") or "").strip()
        revoked = bool(jti and jti in _REVOKED_TOKEN_EXPIRY_BY_JTI)
    if expired:
        _delete_expired_from_db(int(time()))
    return revoked
