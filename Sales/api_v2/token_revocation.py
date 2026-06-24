from __future__ import annotations

from time import time
from typing import Any, Mapping


_REVOKED_TOKEN_EXPIRY_BY_JTI: dict[str, int] = {}


def _purge_expired(now: int | None = None) -> None:
    current = int(time()) if now is None else now
    expired = [jti for jti, exp in _REVOKED_TOKEN_EXPIRY_BY_JTI.items() if exp <= current]
    for jti in expired:
        _REVOKED_TOKEN_EXPIRY_BY_JTI.pop(jti, None)


def revoke_jwt_payload(payload: Mapping[str, Any] | None) -> int:
    if not payload:
        return 0
    jti = str(payload.get("jti") or "").strip()
    if not jti:
        return 0
    exp = int(payload.get("exp") or (int(time()) + 3600))
    _purge_expired()
    _REVOKED_TOKEN_EXPIRY_BY_JTI[jti] = exp
    return 1


def is_token_revoked_payload(payload: Mapping[str, Any] | None) -> bool:
    if not payload:
        return False
    _purge_expired()
    jti = str(payload.get("jti") or "").strip()
    return bool(jti and jti in _REVOKED_TOKEN_EXPIRY_BY_JTI)
