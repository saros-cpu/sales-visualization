from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from flask import Response, current_app, jsonify, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required
import pymysql

from api_v2 import bp_v2
from assistant_quality import (
    build_knowledge_references,
    build_permission_refusal,
    enrich_assistant_payload,
    has_required_permission,
    required_permissions,
)
from assistant_agent import (
    clear_assistant_response,
    enhance_assistant_response,
    is_action_request,
    is_clear_assistant_command,
    is_sensitive_info_request,
    read_only_refusal,
    sensitive_info_refusal,
)
from db import get_connection
from routes_assistant import assistant_tool_catalog, build_assistant_query_plan, execute_assistant_query_payload
from settings import get_settings
from .knowledge import search_knowledge_snippets
from .permission_service import get_effective_auth


RULE_ENGINE_FAST_PATH_ROUTES = frozenset({
    "accounting_report_status",
    "alias_summary",
    "dashboard_summary",
    "density_summary",
    "knowledge_summary",
    "map_location",
    "report_center_summary",
    "settings_summary",
    "station_status",
    "system_health_summary",
    "user_permission_summary",
})


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
    _ensure_ai_call_column(cur, "route", "route VARCHAR(96) NULL AFTER question")
    _ensure_ai_call_column(cur, "domain_key", "domain_key VARCHAR(64) NULL AFTER route")
    _ensure_ai_call_column(cur, "intent_key", "intent_key VARCHAR(64) NULL AFTER domain_key")
    _ensure_ai_call_column(cur, "quality_score", "quality_score DECIMAL(5,2) NULL AFTER status")
    _ensure_ai_call_column(cur, "quality_status", "quality_status VARCHAR(32) NULL AFTER quality_score")
    _ensure_ai_call_column(cur, "self_check_status", "self_check_status VARCHAR(32) NULL AFTER quality_status")
    _ensure_ai_call_column(cur, "permission_status", "permission_status VARCHAR(32) NULL AFTER self_check_status")
    _ensure_ai_call_column(cur, "diagnostics_status", "diagnostics_status VARCHAR(32) NULL AFTER permission_status")
    _ensure_ai_call_column(cur, "table_count", "table_count INT NULL AFTER diagnostics_status")
    _ensure_ai_call_column(cur, "chart_count", "chart_count INT NULL AFTER table_count")
    _ensure_ai_call_column(cur, "knowledge_count", "knowledge_count INT NULL AFTER chart_count")


def ensure_ai_feedback_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ai_agent_feedback (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            call_id BIGINT NULL,
            user_id BIGINT NULL,
            rating VARCHAR(32) NOT NULL,
            reason VARCHAR(255) NULL,
            comment TEXT NULL,
            question MEDIUMTEXT NULL,
            answer MEDIUMTEXT NULL,
            route VARCHAR(96) NULL,
            quality_status VARCHAR(32) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_call_id (call_id),
            KEY idx_created_at (created_at),
            KEY idx_rating_created (rating, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)


def _ensure_ai_call_column(cur, column_name: str, definition: str) -> None:
    cur.execute("SHOW COLUMNS FROM ai_agent_call_logs LIKE %s", (column_name,))
    if cur.fetchone():
        return
    cur.execute(f"ALTER TABLE ai_agent_call_logs ADD COLUMN {definition}")


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
                "dataScopeResources": _data_scope_resources(cur, user_id, auth),
            }
    finally:
        conn.close()


def _data_scope_resources(cur, user_id: int, auth: dict[str, Any]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    role_ids = [role.get("id") for role in auth.get("roles") or [] if role.get("id") is not None]
    dept_ids = [dept.get("id") for dept in auth.get("departments") or [] if dept.get("id") is not None]
    owner_conditions = ["(owner_type = 'user' AND owner_id = %s)"]
    owner_params: list[Any] = [user_id]
    if role_ids:
        owner_conditions.append(f"(owner_type = 'role' AND owner_id IN ({','.join(['%s'] * len(role_ids))}))")
        owner_params.extend(role_ids)
    if dept_ids:
        owner_conditions.append(f"(owner_type = 'department' AND owner_id IN ({','.join(['%s'] * len(dept_ids))}))")
        owner_params.extend(dept_ids)
    try:
        cur.execute(f"""
            SELECT module_key, resource_type, resource_id, resource_label
            FROM system_data_scope_resources
            WHERE {' OR '.join(owner_conditions)}
        """, owner_params)
    except pymysql.err.ProgrammingError:
        return {}
    result: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for row in cur.fetchall():
        module_key = str(row.get("module_key") or "")
        resource_type = str(row.get("resource_type") or "")
        if not module_key or not resource_type:
            continue
        result.setdefault(module_key, {}).setdefault(resource_type, []).append({
            "id": str(row.get("resource_id") or ""),
            "label": str(row.get("resource_label") or ""),
        })
    return result


def _record_ai_call(user_id: int | None, question: str, agent: dict[str, Any], result: dict[str, Any] | None = None) -> int | None:
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
                result = result if isinstance(result, dict) else {}
                plan = result.get("assistantPlan") if isinstance(result.get("assistantPlan"), dict) else {}
                quality = result.get("quality") if isinstance(result.get("quality"), dict) else {}
                permission = result.get("permission") if isinstance(result.get("permission"), dict) else {}
                diagnostics = result.get("diagnostics") if isinstance(result.get("diagnostics"), dict) else {}
                self_check = plan.get("selfCheck") if isinstance(plan.get("selfCheck"), dict) else {}
                cur.execute("""
                    INSERT INTO ai_agent_call_logs
                        (user_id, username, provider, model_name, mode, question,
                         route, domain_key, intent_key, status, quality_score, quality_status,
                         self_check_status, permission_status, diagnostics_status,
                         table_count, chart_count, knowledge_count,
                         llm_used, duration_ms, error)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    user_id,
                    username,
                    agent.get("provider") or "openrouter",
                    agent.get("model"),
                    agent.get("mode") or "read_only",
                    question[:12000],
                    plan.get("route"),
                    plan.get("domain"),
                    plan.get("intent"),
                    agent.get("status") or "unknown",
                    quality.get("score"),
                    quality.get("status"),
                    self_check.get("status"),
                    "allowed" if permission.get("allowed") is True else "denied" if permission.get("allowed") is False else None,
                    diagnostics.get("status"),
                    len(result.get("tables") or []),
                    len(result.get("charts") or []),
                    len(result.get("knowledgeReferences") or result.get("knowledge") or []),
                    1 if agent.get("llmUsed") else 0,
                    agent.get("durationMs"),
                    agent.get("error"),
                ))
                return int(cur.lastrowid or 0) or None
        finally:
            conn.close()
    except Exception:
        return None


def _record_and_attach(user_id: int | None, question: str, result: dict[str, Any]) -> dict[str, Any]:
    call_id = _record_ai_call(user_id, question, result.get("agent") or {}, result)
    if call_id:
        agent = result.get("agent") if isinstance(result.get("agent"), dict) else {}
        agent["callId"] = call_id
        result["agent"] = agent
    return result


def _json_safe_row(row: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            safe[key] = value.isoformat(sep=" ")
        elif hasattr(value, "__float__") and value.__class__.__module__ == "decimal":
            safe[key] = float(value)
        else:
            safe[key] = value
    return safe


def _compact_assistant_plan(plan: Any) -> dict[str, Any]:
    if not isinstance(plan, dict):
        return {}
    compact = {
        "domain": plan.get("domain"),
        "intent": plan.get("intent"),
        "route": plan.get("route"),
        "metric": plan.get("metric"),
        "dimensions": plan.get("dimensions") if isinstance(plan.get("dimensions"), list) else [],
        "period": plan.get("period") if isinstance(plan.get("period"), dict) else {},
        "tool": plan.get("tool") if isinstance(plan.get("tool"), dict) else {},
        "businessTerms": plan.get("businessTerms") if isinstance(plan.get("businessTerms"), dict) else {},
        "comparison": plan.get("comparison") if isinstance(plan.get("comparison"), dict) else None,
        "executionHints": plan.get("executionHints") if isinstance(plan.get("executionHints"), list) else [],
        "assumptions": plan.get("assumptions") if isinstance(plan.get("assumptions"), list) else [],
        "selfCheck": plan.get("selfCheck") if isinstance(plan.get("selfCheck"), dict) else {},
        "contextUsed": plan.get("contextUsed") if isinstance(plan.get("contextUsed"), list) else [],
        "visual": plan.get("visual") if isinstance(plan.get("visual"), dict) else {},
        "needsClarification": bool(plan.get("needsClarification")),
        "clarification": plan.get("clarification") if isinstance(plan.get("clarification"), dict) else None,
        "clarificationResolved": plan.get("clarificationResolved") if isinstance(plan.get("clarificationResolved"), dict) else None,
        "explicit": plan.get("explicit") if isinstance(plan.get("explicit"), dict) else {},
    }
    entities = plan.get("entities")
    if isinstance(entities, dict):
        station = entities.get("station")
        if isinstance(station, dict):
            compact.setdefault("entities", {})["station"] = {
                "shopKey": station.get("shopKey"),
                "name": station.get("name"),
                "short": station.get("short"),
            }
        resource = entities.get("resource")
        if isinstance(resource, dict):
            compact.setdefault("entities", {})["resource"] = {
                "resourceKey": resource.get("resourceKey"),
                "name": resource.get("name"),
            }
    subplans = plan.get("subPlans")
    if isinstance(subplans, list):
        compact["subPlans"] = [_compact_assistant_plan(item) for item in subplans[:5] if isinstance(item, dict)]
    return compact


def _compact_conversation_context(value: Any, session_id: str | None = None) -> dict[str, Any]:
    context = value if isinstance(value, dict) else {}
    result: dict[str, Any] = {}
    resolved_session = str(session_id or context.get("sessionId") or "").strip()
    if resolved_session:
        result["sessionId"] = resolved_session[:128]

    previous_plan = _compact_assistant_plan(context.get("lastAssistantPlan") or context.get("assistantPlan"))
    if previous_plan:
        result["lastAssistantPlan"] = previous_plan

    recent_messages = context.get("recentMessages")
    if isinstance(recent_messages, list):
        safe_messages = []
        for item in recent_messages[-8:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "")[:24]
            content = str(item.get("content") or "").strip()
            if role not in {"user", "assistant"} or not content:
                continue
            row = {"role": role, "content": content[:500]}
            if item.get("periodLabel"):
                row["periodLabel"] = str(item.get("periodLabel"))[:80]
            if item.get("assistantPlan"):
                row["assistantPlan"] = _compact_assistant_plan(item.get("assistantPlan"))
            chart_hints = item.get("chartHints")
            if isinstance(chart_hints, list):
                safe_charts = []
                for chart in chart_hints[:3]:
                    if not isinstance(chart, dict):
                        continue
                    safe_charts.append({
                        "title": str(chart.get("title") or "")[:120],
                        "type": str(chart.get("type") or "")[:32],
                        "xAxis": [str(value)[:80] for value in (chart.get("xAxis") or [])[:12]],
                    })
                if safe_charts:
                    row["chartHints"] = safe_charts
            table_hints = item.get("tableHints")
            if isinstance(table_hints, list):
                safe_tables = []
                for table in table_hints[:2]:
                    if not isinstance(table, dict):
                        continue
                    safe_tables.append({
                        "title": str(table.get("title") or "")[:120],
                        "columns": [str(value)[:80] for value in (table.get("columns") or [])[:8]],
                        "firstRows": [
                            [str(cell)[:80] for cell in row_values[:8]]
                            for row_values in (table.get("firstRows") or [])[:3]
                            if isinstance(row_values, list)
                        ],
                    })
                if safe_tables:
                    row["tableHints"] = safe_tables
            safe_messages.append(row)
        if safe_messages:
            result["recentMessages"] = safe_messages
    page_context = context.get("pageContext")
    if isinstance(page_context, dict):
        safe_page: dict[str, Any] = {}
        for key in ("path", "pathname", "search", "hash", "module", "page", "title"):
            if page_context.get(key):
                safe_page[key] = str(page_context.get(key))[:200]
        search_params = page_context.get("searchParams")
        if isinstance(search_params, dict):
            safe_page["searchParams"] = {
                str(key)[:80]: str(value)[:160]
                for key, value in search_params.items()
                if value is not None
            }
        if safe_page:
            result["pageContext"] = safe_page
    return result


def _conversation_context_search_text(context: dict[str, Any]) -> str:
    parts: list[str] = []
    plan = context.get("lastAssistantPlan")
    if isinstance(plan, dict):
        parts.extend(str(plan.get(key) or "") for key in ("domain", "intent", "route", "metric"))
        period = plan.get("period")
        if isinstance(period, dict):
            parts.append(str(period.get("label") or ""))
        station = ((plan.get("entities") or {}).get("station") if isinstance(plan.get("entities"), dict) else None)
        if isinstance(station, dict):
            parts.extend(str(station.get(key) or "") for key in ("shopKey", "name", "short"))
    messages = context.get("recentMessages")
    if isinstance(messages, list):
        parts.extend(str(item.get("content") or "") for item in messages[-3:] if isinstance(item, dict))
    return " ".join(part for part in parts if part)


def _execute_business_assistant_query(
    question: str,
    language: str | None,
    session_id: str | None = None,
    conversation_context: dict[str, Any] | None = None,
    user_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], int]:
    body: dict[str, Any] = {"question": question, "language": language}
    if session_id:
        body["sessionId"] = session_id
    if conversation_context:
        body["conversationContext"] = conversation_context
    if user_context:
        body["userContext"] = user_context
    result, status = execute_assistant_query_payload(body)
    return result if isinstance(result, dict) else {"ok": False, "answer": str(result)}, int(status or 200)


def _business_rule_agent(model: str = "assistant-rule-engine", status: str = "ok") -> dict[str, Any]:
    return {
        "mode": "read_only",
        "provider": "business-rule-engine",
        "model": model,
        "llmUsed": False,
        "status": status,
        "canModifyCode": False,
        "canModifyFiles": False,
        "canModifyBusinessData": False,
    }


def _should_use_rule_engine_fast_path(source_payload: dict[str, Any], use_llm: bool) -> bool:
    if not use_llm:
        return True
    plan = source_payload.get("assistantPlan") if isinstance(source_payload.get("assistantPlan"), dict) else {}
    return str(plan.get("route") or "") in RULE_ENGINE_FAST_PATH_ROUTES


def _mark_llm_fallback(result: dict[str, Any]) -> dict[str, Any]:
    """LLM 增强失败但规则引擎已产出结构化答案时，把状态修正为 ok + assistant-fallback。"""
    if not isinstance(result, dict):
        return result
    agent = result.get("agent") if isinstance(result.get("agent"), dict) else {}
    if agent.get("status") != "failed" or not str(result.get("answer") or "").strip():
        return result
    error = agent.get("error")
    agent.update({
        "status": "ok",
        "llmUsed": False,
        "model": "assistant-fallback",
        "error": None,
        "llmError": error,
    })
    result["agent"] = agent
    result["sourceAnswer"] = str(result.get("sourceAnswer") or result.get("answer") or "")
    result["fallback"] = True
    return result


def _finalize_rule_engine_response(
    user_id: int | None,
    question: str,
    source_payload: dict[str, Any],
    user_context: dict[str, Any],
    *,
    model: str = "assistant-fast-path",
) -> dict[str, Any]:
    result = dict(source_payload)
    result["sourceAnswer"] = str(source_payload.get("answer") or "")
    result["agent"] = _business_rule_agent(model=model)
    result = enrich_assistant_payload(result, user_context)
    return _record_and_attach(user_id, question, result)


def _knowledge_reference_text(references: list[dict[str, Any]], language: str | None) -> str:
    if not references:
        return ""
    is_ru = str(language or "").lower().startswith("ru")
    title = "Справка из базы знаний:" if is_ru else "知识库依据："
    lines = [title]
    for item in references:
        source = item.get("source") or ""
        prefix = f"[{item.get('id')}] 《{item.get('title') or '-'}》"
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
    session_id = str(payload.get("sessionId") or "").strip()[:128]
    conversation_context = _compact_conversation_context(payload.get("conversationContext"), session_id)
    if not question:
        return jsonify({"code": 4221, "message": "question_required", "data": None}), 422

    user_id = int(get_jwt_identity())
    user_context = _user_context(user_id)
    if is_clear_assistant_command(question):
        result = clear_assistant_response(question, language)
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})
    if is_sensitive_info_request(question):
        result = sensitive_info_refusal(question, language)
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})
    if is_action_request(question):
        result = read_only_refusal(question, language)
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})

    preflight_plan = build_assistant_query_plan(question, context=conversation_context)
    if not preflight_plan.get("needsClarification") and not has_required_permission(user_context, preflight_plan):
        result = build_permission_refusal(question, preflight_plan, user_context, language)
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})

    source_payload, status = _execute_business_assistant_query(question, language, session_id, conversation_context, user_context)
    if status >= 400:
        result = {
            "ok": False,
            "question": question,
            "answer": source_payload.get("answer") or source_payload.get("error") or "query_failed",
            "tables": [],
            "agent": {"mode": "read_only", "provider": "openrouter", "status": "source_query_failed", "llmUsed": False},
        }
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 502, "message": "assistant_source_query_failed", "data": result}), 502

    if source_payload.get("needsClarification") or (source_payload.get("assistantPlan") or {}).get("needsClarification"):
        result = dict(source_payload)
        result["sourceAnswer"] = str(source_payload.get("answer") or "")
        result["agent"] = {
            "mode": "read_only",
            "provider": "business-rule-engine",
            "model": "assistant-plan",
            "llmUsed": False,
            "status": "clarification_required",
            "canModifyCode": False,
            "canModifyFiles": False,
            "canModifyBusinessData": False,
        }
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})

    source_plan = source_payload.get("assistantPlan") if isinstance(source_payload.get("assistantPlan"), dict) else {}
    if source_plan and not has_required_permission(user_context, source_plan):
        result = build_permission_refusal(question, source_plan, user_context, language)
        result = enrich_assistant_payload(result, user_context)
        result = _record_and_attach(user_id, question, result)
        return jsonify({"code": 0, "message": "success", "data": result})

    if session_id:
        source_payload["sessionId"] = session_id
    if conversation_context:
        source_payload["conversationContext"] = conversation_context

    if _should_use_rule_engine_fast_path(source_payload, use_llm):
        result = _finalize_rule_engine_response(
            user_id,
            question,
            source_payload,
            user_context,
            model="assistant-fast-path" if use_llm else "assistant-rule-engine",
        )
        return jsonify({"code": 0, "message": "success", "data": result})

    knowledge_snippets: list[dict[str, Any]] = []
    try:
        knowledge_query = " ".join(
            part for part in (question, _conversation_context_search_text(conversation_context)) if part
        )
        knowledge_snippets = search_knowledge_snippets(user_id, knowledge_query, limit=3)
        if knowledge_snippets:
            source_payload["knowledge"] = knowledge_snippets
            source_payload["knowledgeReferences"] = build_knowledge_references(knowledge_snippets)
    except Exception as exc:
        current_app.logger.warning("knowledge search failed for assistant: %s", exc)

    result = enhance_assistant_response(
        source_payload,
        question=question,
        language=language,
        use_llm=use_llm,
        user_context=user_context,
    )
    # LLM 增强失败/超时时，规则引擎的结构化答案仍然完整可用：
    # 标记为 ok + assistant-fallback，避免前端/日志把“拿到了答案”误记为 failed。
    result = _mark_llm_fallback(result)
    if knowledge_snippets:
        result["knowledge"] = knowledge_snippets
        result["knowledgeReferences"] = build_knowledge_references(knowledge_snippets)
        reference = _knowledge_reference_text(result["knowledgeReferences"], language)
        answer = str(result.get("answer") or "").strip()
        result["answer"] = f"{answer}\n\n{reference}" if answer else reference
    result = enrich_assistant_payload(result, user_context)
    result = _record_and_attach(user_id, question, result)
    return jsonify({"code": 0, "message": "success", "data": result})


def _sse_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _sse_final(status: str = "ok") -> str:
    return _sse_event("final", {"status": status})


@bp_v2.route("/assistant/query/stream", methods=["POST"])
@jwt_required()
def assistant_query_stream():
    payload = request.get_json() or {}
    question = str(payload.get("question") or "").strip()
    language = payload.get("language")
    session_id = str(payload.get("sessionId") or "").strip()[:128]
    conversation_context = _compact_conversation_context(payload.get("conversationContext"), session_id)
    user_id = int(get_jwt_identity())
    user_context = _user_context(user_id)

    @stream_with_context
    def generate():
        if not question:
            yield _sse_event("error", {"code": 4221, "message": "question_required"})
            yield _sse_final("error")
            return
        yield _sse_event("started", {"question": question})
        if is_clear_assistant_command(question):
            result = enrich_assistant_payload(clear_assistant_response(question, language), user_context)
            result = _record_and_attach(user_id, question, result)
            yield _sse_event("completed", result)
            yield _sse_final()
            return
        if is_sensitive_info_request(question):
            result = enrich_assistant_payload(sensitive_info_refusal(question, language), user_context)
            result = _record_and_attach(user_id, question, result)
            yield _sse_event("completed", result)
            yield _sse_final()
            return
        if is_action_request(question):
            result = enrich_assistant_payload(read_only_refusal(question, language), user_context)
            result = _record_and_attach(user_id, question, result)
            yield _sse_event("completed", result)
            yield _sse_final()
            return
        plan = build_assistant_query_plan(question, context=conversation_context)
        yield _sse_event("planned", {"assistantPlan": plan})
        if not plan.get("needsClarification") and not has_required_permission(user_context, plan):
            result = enrich_assistant_payload(build_permission_refusal(question, plan, user_context, language), user_context)
            result = _record_and_attach(user_id, question, result)
            yield _sse_event("completed", result)
            yield _sse_final()
            return
        source_payload, status = _execute_business_assistant_query(question, language, session_id, conversation_context, user_context)
        if status >= 400:
            yield _sse_event("error", {"code": status, "message": source_payload.get("error") or "assistant_source_query_failed"})
            yield _sse_final("error")
            return
        result = enrich_assistant_payload(source_payload, user_context)
        result["agent"] = {
            "mode": "read_only",
            "provider": "business-rule-engine",
            "model": "assistant-stream",
            "llmUsed": False,
            "status": "ok",
            "canModifyCode": False,
            "canModifyFiles": False,
            "canModifyBusinessData": False,
        }
        result = _record_and_attach(user_id, question, result)
        yield _sse_event("completed", result)
        yield _sse_final()

    response = Response(generate(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


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
                       AVG(quality_score) AS avg_quality_score,
                       SUM(CASE WHEN quality_status = 'fail' THEN 1 ELSE 0 END) AS quality_failed_count,
                       SUM(CASE WHEN permission_status = 'denied' THEN 1 ELSE 0 END) AS permission_denied_count,
                       MAX(created_at) AS last_called_at
                FROM ai_agent_call_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            """)
            row = cur.fetchone() or {}
            provider = settings.resolved_assistant_provider
            return jsonify({"code": 0, "message": "success", "data": {
                "configured": bool(settings.OPENROUTER_API_KEY) if provider == "openrouter" else bool(settings.LOCAL_LLM_BASE_URL and settings.LOCAL_LLM_MODEL),
                "provider": provider,
                "model": settings.resolved_assistant_model,
                "freeOnly": provider == "openrouter",
                "total7d": int(row.get("total") or 0),
                "ok7d": int(row.get("ok_count") or 0),
                "failed7d": int(row.get("failed_count") or 0),
                "avgDurationMs": int(row.get("avg_duration_ms") or 0),
                "avgQualityScore": float(row.get("avg_quality_score") or 0),
                "qualityFailed7d": int(row.get("quality_failed_count") or 0),
                "permissionDenied7d": int(row.get("permission_denied_count") or 0),
                "lastCalledAt": row["last_called_at"].isoformat(sep=" ") if isinstance(row.get("last_called_at"), datetime) else None,
            }})
    finally:
        conn.close()


@bp_v2.route("/assistant/tools", methods=["GET"])
@jwt_required()
def assistant_tools():
    user_id = int(get_jwt_identity())
    user_context = _user_context(user_id)
    tools = []
    for route, item in assistant_tool_catalog().items():
        plan = {"route": route}
        if has_required_permission(user_context, plan):
            tools.append({
                **item,
                "permission": {
                    "allowed": True,
                    "required": list(required_permissions(plan)),
                },
            })
    return jsonify({"code": 0, "message": "success", "data": {"items": tools, "count": len(tools)}})


@bp_v2.route("/assistant/feedback", methods=["POST"])
@jwt_required()
def assistant_feedback():
    payload = request.get_json() or {}
    rating = str(payload.get("rating") or "").strip().lower()
    if rating not in {"correct", "useful", "wrong", "unclear", "scope_error", "format_error"}:
        return jsonify({"code": 4221, "message": "invalid_rating", "data": None}), 422
    user_id = int(get_jwt_identity())
    plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    quality = payload.get("quality") if isinstance(payload.get("quality"), dict) else {}
    conn = get_connection(autocommit=True)
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_ai_feedback_schema(cur)
            cur.execute("""
                INSERT INTO ai_agent_feedback
                    (call_id, user_id, rating, reason, comment, question, answer, route, quality_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                payload.get("callId") or (payload.get("agent") or {}).get("callId"),
                user_id,
                rating,
                str(payload.get("reason") or "")[:255],
                str(payload.get("comment") or "")[:4000],
                str(payload.get("question") or "")[:12000],
                str(payload.get("answer") or "")[:12000],
                plan.get("route"),
                quality.get("status"),
            ))
            feedback_id = int(cur.lastrowid or 0)
    finally:
        conn.close()
    return jsonify({"code": 0, "message": "success", "data": {"id": feedback_id}})


@bp_v2.route("/assistant/quality-dashboard", methods=["GET"])
@jwt_required()
def assistant_quality_dashboard():
    user_id = int(get_jwt_identity())
    user_context = _user_context(user_id)
    if not has_required_permission(user_context, {"route": "system_health_summary"}):
        return jsonify({"code": 4031, "message": "permission_denied", "data": None}), 403
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            ensure_ai_call_schema(cur)
            ensure_ai_feedback_schema(cur)
            cur.execute("""
                SELECT route,
                       COUNT(*) AS total,
                       AVG(quality_score) AS avg_quality_score,
                       SUM(CASE WHEN quality_status = 'fail' THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN quality_status = 'warn' THEN 1 ELSE 0 END) AS warned,
                       SUM(CASE WHEN permission_status = 'denied' THEN 1 ELSE 0 END) AS denied
                FROM ai_agent_call_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY route
                ORDER BY failed DESC, warned DESC, total DESC
                LIMIT 20
            """)
            routes = [_json_safe_row(row) for row in cur.fetchall()]
            cur.execute("""
                SELECT rating, COUNT(*) AS total
                FROM ai_agent_feedback
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY rating
            """)
            feedback = [_json_safe_row(row) for row in cur.fetchall()]
            cur.execute("""
                SELECT id, created_at, route, question, quality_score, quality_status, diagnostics_status
                FROM ai_agent_call_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                  AND (quality_status IN ('fail', 'warn') OR permission_status = 'denied')
                ORDER BY created_at DESC
                LIMIT 20
            """)
            recent = [_json_safe_row(row) for row in cur.fetchall()]
    finally:
        conn.close()
    return jsonify({"code": 0, "message": "success", "data": {
        "routes": routes,
        "feedback": feedback,
        "recentIssues": recent,
    }})
