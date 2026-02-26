from __future__ import annotations

import json
import re
import time
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from settings import get_settings


SENSITIVE_KEYS = (
    "password", "token", "secret", "authorization", "credential",
    "api_key", "apikey", "file_path", "filepath", "local_path",
)

ACTION_PATTERNS = (
    r"(帮我|请|替我|给我|直接).{0,12}(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入)",
    r"^(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入)",
    r"(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入).{0,12}(数据|合同|文件|代码|项目|缓存|记录|表)",
    r"\b(delete|update|insert|create|save|submit|import|export|refresh|restart|execute|run|write|commit)\b",
    r"\b(удали|измени|создай|сохрани|импорт|экспорт|обнови|перезапусти|выполни|запусти)\b",
)


STRICT_ACTION_PATTERNS = (
    r"(帮我|请|替我|给我|直接|立刻|马上).{0,16}(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载)",
    r"^(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载)",
    r"(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载).{0,16}(数据|合同|文件|代码|项目|缓存|记录|报表|账号|权限)",
    r"\b(delete|update|insert|create|save|submit|import|export|refresh|restart|execute|run|write|commit|download|generate)\b",
    r"\b(удали|измени|изменить|создай|сохрани|импорт|экспорт|обнови|перезапусти|выполни|запусти|запиши|скачай)\b",
)


def detect_language(question: str | None, fallback: str | None = None) -> str:
    if fallback in {"zh", "ru"}:
        return fallback
    text = question or ""
    has_cyrillic = bool(re.search(r"[А-Яа-яЁё]", text))
    has_cjk = bool(re.search(r"[\u4e00-\u9fff]", text))
    return "ru" if has_cyrillic and not has_cjk else "zh"


def is_action_request(question: str | None) -> bool:
    text = (question or "").strip().lower()
    patterns = (*ACTION_PATTERNS, *STRICT_ACTION_PATTERNS)
    return bool(text) and any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def read_only_refusal(question: str, language: str | None = None) -> dict[str, Any]:
    lang = detect_language(question, language)
    answer = (
        "Я работаю только в режиме чтения: могу искать данные, объяснять показатели и отвечать на вопросы, "
        "но не изменяю код, файлы, договоры, кэш или бизнес-данные."
        if lang == "ru"
        else "我现在只能只读查询：可以查数据、解释指标、回答问题，但不会修改代码、文件、合同、缓存或任何业务数据。"
    )
    return {
        "ok": True,
        "question": question,
        "periodLabel": "read_only",
        "answer": answer,
        "tables": [],
        "agent": _agent_meta("blocked_action_request", llm_used=False),
    }

    lang = detect_language(question, language)
    if lang == "ru":
        answer = (
            "Я работаю только в режиме чтения: могу искать данные, объяснять показатели и отвечать на вопросы, "
            "но не изменяю код, файлы, договоры, кэш или бизнес-данные."
        )
    else:
        answer = "我现在只读：可以查询数据、解释指标、回答问题，但不会修改代码、文件、合同、缓存或任何业务数据。"
    return {
        "ok": True,
        "question": question,
        "periodLabel": "read_only",
        "answer": answer,
        "tables": [],
        "agent": _agent_meta("blocked_action_request", llm_used=False),
    }


def _agent_meta(status: str, *, llm_used: bool, error: str | None = None, duration_ms: int | None = None) -> dict[str, Any]:
    settings = get_settings()
    return {
        "mode": "read_only",
        "provider": "openrouter",
        "model": settings.resolved_openrouter_model,
        "llmUsed": llm_used,
        "status": status,
        "error": error,
        "durationMs": duration_ms,
        "canModifyCode": False,
        "canModifyFiles": False,
        "canModifyBusinessData": False,
    }


def _json_default(value: Any) -> str | int | float | None:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def _redact_key(key: str) -> bool:
    lower = key.lower()
    return any(item in lower for item in SENSITIVE_KEYS)


def _compact_value(value: Any, *, depth: int = 0, max_depth: int = 4) -> Any:
    if depth >= max_depth:
        return "...truncated..."
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= 50:
                result["..."] = f"{len(value) - index} more keys"
                break
            key_text = str(key)
            result[key_text] = "***" if _redact_key(key_text) else _compact_value(item, depth=depth + 1, max_depth=max_depth)
        return result
    if isinstance(value, (list, tuple)):
        items = [_compact_value(item, depth=depth + 1, max_depth=max_depth) for item in list(value)[:20]]
        if len(value) > 20:
            items.append(f"...{len(value) - 20} more rows")
        return items
    if isinstance(value, (datetime, date, Decimal)):
        return _json_default(value)
    if isinstance(value, str):
        return value[:1000] + "...truncated..." if len(value) > 1000 else value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)


def _compact_tables(tables: Any) -> list[dict[str, Any]]:
    result = []
    for table in (tables or [])[:6]:
        if not isinstance(table, dict):
            continue
        rows = table.get("rows") or []
        result.append({
            "title": table.get("title"),
            "columns": table.get("columns") or [],
            "rows": rows[:30],
            "truncatedRows": max(len(rows) - 30, 0) if isinstance(rows, list) else 0,
        })
    return result


def compact_assistant_payload(payload: dict[str, Any], user_context: dict[str, Any] | None = None) -> dict[str, Any]:
    assistant_plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    return {
        "question": payload.get("question"),
        "periodLabel": payload.get("periodLabel"),
        "assistantPlan": _compact_value(assistant_plan),
        "selectedTool": _compact_value(assistant_plan.get("tool") if isinstance(assistant_plan, dict) else {}),
        "subPlans": _compact_value(assistant_plan.get("subPlans") if isinstance(assistant_plan, dict) else []),
        "comparison": _compact_value(assistant_plan.get("comparison") if isinstance(assistant_plan, dict) else {}),
        "executionHints": _compact_value(assistant_plan.get("executionHints") if isinstance(assistant_plan, dict) else []),
        "assumptions": _compact_value(assistant_plan.get("assumptions") if isinstance(assistant_plan, dict) else []),
        "contextUsed": _compact_value(assistant_plan.get("contextUsed") if isinstance(assistant_plan, dict) else []),
        "conversationContext": _compact_value(payload.get("conversationContext")),
        "knowledge": _compact_value(payload.get("knowledge")),
        "deterministicAnswer": payload.get("answer"),
        "tables": _compact_tables(payload.get("tables")),
        "data": _compact_value(payload.get("data")),
        "userContext": _compact_value(user_context or {}),
    }


def _openrouter_chat(question: str, context: dict[str, Any], language: str) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    started_at = time.perf_counter()
    body = {
        "model": settings.resolved_openrouter_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a read-only business data assistant for an oil sales management system. "
                    "You can only answer from the supplied JSON context. Use assistantPlan to understand the "
                    "business domain, selected read-only tool, period, entities, metric, dimensions, and any "
                    "context inherited from earlier turns. If assistantPlan.subPlans exists, explain that the "
                    "question was decomposed and summarize each read-only tool result in order. If comparison exists, "
                    "state the baseline period explicitly. Treat deterministicAnswer and tables as authoritative. "
                    "Mention executionHints and assumptions when they materially affect interpretation. "
                    "If assistantPlan.needsClarification is true, ask the clarification question and do not assume "
                    "missing domain, metric, dimension, station, or period values. "
                    "If the user asks a follow-up, preserve the resolved period/entities from assistantPlan unless "
                    "the current question explicitly changes them. You cannot modify project code, files, "
                    "database rows, contracts, aliases, cache, or business records. You cannot run commands or "
                    "call write APIs. If a user asks for a modifying action, refuse briefly and offer a read-only check. "
                    "Answer in Chinese when language=zh, and in Russian when language=ru. Be concise and mention "
                    "the data period when it matters."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({
                    "language": language,
                    "question": question,
                    "readonlyPolicy": {
                        "canModifyCode": False,
                        "canModifyFiles": False,
                        "canModifyBusinessData": False,
                        "allowed": ["query", "answer", "explain", "summarize"],
                    },
                    "context": context,
                }, ensure_ascii=False, default=_json_default),
            },
        ],
        "temperature": settings.OPENROUTER_TEMPERATURE,
        "max_tokens": settings.OPENROUTER_MAX_TOKENS,
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": settings.OPENROUTER_APP_TITLE,
    }
    if settings.OPENROUTER_HTTP_REFERER:
        headers["HTTP-Referer"] = settings.OPENROUTER_HTTP_REFERER
    req = Request(settings.OPENROUTER_BASE_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
    with urlopen(req, timeout=settings.OPENROUTER_TIMEOUT_SECONDS) as resp:
        response_payload = json.loads(resp.read().decode("utf-8"))
    content = ((response_payload.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
    if not content:
        raise RuntimeError("empty_model_response")
    return content, {
        "durationMs": int((time.perf_counter() - started_at) * 1000),
        "model": response_payload.get("model") or settings.resolved_openrouter_model,
    }


def enhance_assistant_response(
    payload: dict[str, Any],
    *,
    question: str,
    language: str | None = None,
    use_llm: bool = True,
    user_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = dict(payload)
    if not payload.get("ok") or not payload.get("answer"):
        return result
    lang = detect_language(question, language)
    settings = get_settings()
    result["sourceAnswer"] = str(payload.get("answer") or "")
    result["agent"] = _agent_meta("disabled" if not use_llm else "not_configured", llm_used=False)
    if not use_llm or not settings.OPENROUTER_API_KEY:
        return result
    try:
        answer, meta = _openrouter_chat(question, compact_assistant_payload(payload, user_context), lang)
        result["answer"] = answer
        result["agent"].update({"llmUsed": True, "status": "ok", "model": meta.get("model"), "durationMs": meta.get("durationMs")})
    except HTTPError as exc:
        result["agent"].update({"status": "failed", "error": f"openrouter_http_{exc.code}"})
    except (URLError, TimeoutError) as exc:
        result["agent"].update({"status": "failed", "error": exc.__class__.__name__})
    except Exception as exc:
        result["agent"].update({"status": "failed", "error": exc.__class__.__name__})
    return result
