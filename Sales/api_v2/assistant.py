from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from assistant_agent import enhance_assistant_response, is_action_request, read_only_refusal
from db import get_connection
from settings import get_settings
from .knowledge import search_knowledge_snippets
from .permission_service import get_effective_auth


def ensure_ai_call_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_agent_call_logs (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            user_id BIGINT NULL,
            username VARCHAR(128) NULL,
            provider VARCHAR(64) NOT NULL DEFAULT 'openrouter',
            model_name VARCHAR(128) NULL,
            mode VARCHAR(64) NOT NULL DEFAULT 'read_only',
            question MEDIUMTEXT NULL,
            status VARCHAR(64) NOT NULL,
            llm_used BOOLEAN NOT NULL DEFAULT FALSE,
            duration_ms INT NULL,
            error VARCHAR(255) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_created_at (created_at),
            KEY idx_status_created (status, created_at),
            KEY idx_user_created (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)


def _user_context(user_id: int) -> dict[str, Any]:
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute("SELECT id, username, display_name, role FROM system_users WHERE id = %s AND is_active = TRUE", (user_id,))
            user = cur.fetchone()
            if not user:
                return {}
            auth = get_effective_auth(cur, user_id, user["role"])
            conn.commit()
            return {
                "user": {
                    "id": user["id"],
                    "username": user["username"],
                    "displayName": user["display_name"],
                    "role": user["role"],
                },
                "permissionCodes": auth.get("permissionCodes", []),
                "roles": auth.get("roles", []),
                "departments": auth.get("departments", []),
                "dataScopes": auth.get("dataScopes", {}),
            }
    finally:
        conn.close()


def _record_ai_call(user_id: int | None, question: str, agent: dict[str, Any]) -> None:
    try:
        conn = get_connection(autocommit=True)
        try:
            with conn.cursor(pymysql.cursors.DictCursor) as cur:
                ensure_ai_call_schema(cur)
                username = None
                if user_id:
                    cur.execute("SELECT username FROM system_users WHERE id = %s", (user_id,))
                    row = cur.fetchone()
                    username = row["username"] if row else None
                cur.execute("""
                    INSERT INTO ai_agent_call_logs
                        (user_id, username, provider, model_name, mode, question, status, llm_used, duration_ms, error)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    username,
                    agent.get("provider") or "openrouter",
                    agent.get("model"),
                    agent.get("mode") or "read_only",
                    question[:12000],
                    agent.get("status") or "unknown",
                    1 if agent.get("llmUsed") else 0,
                    agent.get("durationMs"),
                    agent.get("error"),
                ))
        finally:
            conn.close()
    except Exception:
        pass


def _legacy_assistant_query(question: str, language: str | None) -> tuple[dict[str, Any], int]:
    headers = {}
    auth = request.headers.get("Authorization")
    if auth:
        headers["Authorization"] = auth
    with current_app.test_client() as client:
        resp = client.post("/api/data-assistant/query", json={"question": question, "language": language}, headers=headers)
        payload = resp.get_json(silent=True) or {"ok": False, "answer": resp.get_data(as_text=True)}
        return payload, resp.status_code


def _knowledge_reference_text(snippets: list[dict[str, Any]], language: str | None) -> str:
    if not snippets:
        return ""
    is_ru = str(language or "").lower().startswith("ru")
    title = "Справка из базы знаний:" if is_ru else "知识库参考："
    lines = [title]
    for index, item in enumerate(snippets, start=1):
        source = " / ".join(part for part in [item.get("spaceName"), item.get("categoryName")] if part)
        prefix = f"{index}. 《{item.get('title') or '-'}》"
        if source:
            prefix += f"（{source}）"
        lines.append(f"{prefix}: {item.get('snippet') or ''}")
    return "\n".join(lines)


@bp_v2.route("/assistant/query", methods=["POST"])
@jwt_required()
def assistant_query():
    payload = request.get_json() or {}
    question = str(payload.get("question") or "").strip()
    language = payload.get("language")
    use_llm = payload.get("useLlm", True) is not False
    if not question:
        return jsonify({"code": 4221, "message": "question_required", "data": None}), 422

    user_id = int(get_jwt_identity())
    if is_action_request(question):
        result = read_only_refusal(question, language)
        _record_ai_call(user_id, question, result.get("agent") or {})
        return jsonify({"code": 0, "message": "success", "data": result})

    source_payload, status = _legacy_assistant_query(question, language)
    if status >= 400:
        result = {
            "ok": False,
            "question": question,
            "answer": source_payload.get("answer") or source_payload.get("error") or "query_failed",
            "tables": [],
            "agent": {"mode": "read_only", "provider": "openrouter", "status": "source_query_failed", "llmUsed": False},
        }
        _record_ai_call(user_id, question, result["agent"])
        return jsonify({"code": 502, "message": "assistant_source_query_failed", "data": result}), 502

    knowledge_snippets: list[dict[str, Any]] = []
    try:
        knowledge_snippets = search_knowledge_snippets(user_id, question, limit=3)
        if knowledge_snippets:
            source_payload["knowledge"] = knowledge_snippets
    except Exception as exc:
        current_app.logger.warning("knowledge search failed for assistant: %s", exc)

    result = enhance_assistant_response(
        source_payload,
        question=question,
        language=language,
        use_llm=use_llm,
        user_context=_user_context(user_id),
    )
    if knowledge_snippets:
        result["knowledge"] = knowledge_snippets
        reference = _knowledge_reference_text(knowledge_snippets, language)
        answer = str(result.get("answer") or "").strip()
        result["answer"] = f"{answer}\n\n{reference}" if answer else reference
    _record_ai_call(user_id, question, result.get("agent") or {})
    return jsonify({"code": 0, "message": "success", "data": result})


@bp_v2.route("/assistant/status", methods=["GET"])
@jwt_required()
def assistant_status():
    settings = get_settings()
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_ai_call_schema(cur)
            cur.execute("""
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
                       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                       AVG(duration_ms) AS avg_duration_ms,
                       MAX(created_at) AS last_called_at
                FROM ai_agent_call_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            """)
            row = cur.fetchone() or {}
            return jsonify({"code": 0, "message": "success", "data": {
                "configured": bool(settings.OPENROUTER_API_KEY),
                "provider": "openrouter",
                "model": settings.resolved_openrouter_model,
                "freeOnly": True,
                "total7d": int(row.get("total") or 0),
                "ok7d": int(row.get("ok_count") or 0),
                "failed7d": int(row.get("failed_count") or 0),
                "avgDurationMs": int(row.get("avg_duration_ms") or 0),
                "lastCalledAt": row["last_called_at"].isoformat(sep=" ") if isinstance(row.get("last_called_at"), datetime) else None,
            }})
    finally:
        conn.close()
