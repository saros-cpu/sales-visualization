from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timedelta
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
    r"(帮我|请|替我|给我|直接|把).{0,12}(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入)",
    r"(帮我|请|替我|给我|直接|把).{0,16}(改|调整|设置).{0,16}(数据|合同|文件|账号|权限|用户|记录|缓存)",
    r"(帮我|请|替我|给我|直接|把).{0,16}(数据|合同|文件|账号|权限|用户|记录|缓存).{0,16}(改|调整|设置)",
    r"(帮我|请|替我|给我|直接|把).{0,16}(审核|审批|通过|驳回|作废|启用|停用|授权)",
    r"^(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入)",
    r"^(审核|审批|通过|驳回|作废|启用|停用|授权).{0,12}(单|合同|账号|权限|用户|记录|申请)",
    r"(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入).{0,12}(数据|合同|文件|代码|项目|缓存|记录|表)",
    r"(审核通过|审批通过|驳回|作废|启用|停用|授权).{0,12}(单|合同|账号|权限|用户|记录|申请)",
    r"(单|合同|账号|权限|用户|记录|申请).{0,16}(审核通过|审批通过|驳回|作废|启用|停用|授权)",
    r"\b(delete|update|insert|create|save|submit|import|export|refresh|restart|execute|run|write|commit)\b",
    r"\b(удали|измени|создай|сохрани|импорт|экспорт|обнови|перезапусти|выполни|запусти)\b",
)


CLEAR_ASSISTANT_PATTERNS = (
    r"^(清空|清除|清屏|重置|删除)(问答|对话|聊天|记录|上下文)?$",
    r"^\s*(clear|reset|delete)\s+(chat|conversation|history|context)\s*$",
    r"^\s*(очисти|сбрось|удали)\s+(чат|диалог|историю|контекст)\s*$",
)


READ_ONLY_ACTION_QUESTION_PATTERNS = (
    r"(可以|能|能够|支持).{0,12}(导出|下载).{0,12}(哪些|什么|列表|文件|报表)",
    r"(有哪些|哪些|什么).{0,12}(可以|可|能|支持).{0,8}(导出|下载)",
    r"(导出|下载).{0,8}(哪些|什么).{0,8}(文件|报表|内容)",
)


STRICT_ACTION_PATTERNS = (
    r"(帮我|请|替我|给我|直接|立刻|马上|把).{0,16}(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载)",
    r"(帮我|请|替我|给我|直接|立刻|马上|把).{0,20}(改|调整|设置).{0,20}(数据|合同|文件|账号|权限|用户|记录|缓存)",
    r"(帮我|请|替我|给我|直接|立刻|马上|把).{0,20}(数据|合同|文件|账号|权限|用户|记录|缓存).{0,20}(改|调整|设置)",
    r"(帮我|请|替我|给我|直接|立刻|马上|把).{0,20}(审核|审批|通过|驳回|作废|启用|停用|授权)",
    r"^(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载)",
    r"^(审核|审批|通过|驳回|作废|启用|停用|授权).{0,16}(单|合同|账号|权限|用户|记录|申请)",
    r"(修改|删除|新增|创建|保存|提交|导入|导出|刷新|重启|执行|运行|写入|生成文件|下载).{0,16}(数据|合同|文件|代码|项目|缓存|记录|报表|账号|权限)",
    r"(审核通过|审批通过|驳回|作废|启用|停用|授权).{0,16}(单|合同|账号|权限|用户|记录|申请)",
    r"(单|合同|账号|权限|用户|记录|申请).{0,20}(审核通过|审批通过|驳回|作废|启用|停用|授权)",
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
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in READ_ONLY_ACTION_QUESTION_PATTERNS):
        return False
    patterns = (*ACTION_PATTERNS, *STRICT_ACTION_PATTERNS)
    return bool(text) and any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def is_clear_assistant_command(question: str | None) -> bool:
    text = (question or "").strip().lower()
    return bool(text) and any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in CLEAR_ASSISTANT_PATTERNS)


def clear_assistant_response(question: str, language: str | None = None) -> dict[str, Any]:
    lang = detect_language(question, language)
    answer = (
        "Это команда интерфейса для очистки диалога. В новой версии клиент очистит историю локально; бизнес-данные не меняются."
        if lang == "ru"
        else "这是清空问答的界面指令。新版本客户端会在本地清空对话记录，不会查询或修改任何业务数据。"
    )
    return {
        "ok": True,
        "question": question,
        "periodLabel": "ui_command",
        "answer": answer,
        "tables": [],
        "agent": _agent_meta("clear_conversation_command", llm_used=False),
        "uiCommand": {"type": "clearConversation"},
    }


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
        "provider": settings.resolved_assistant_provider,
        "model": settings.resolved_assistant_model,
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


def _compact_charts(charts: Any) -> list[dict[str, Any]]:
    result = []
    for chart in (charts or [])[:6]:
        if not isinstance(chart, dict):
            continue
        compact = {
            "title": chart.get("title"),
            "type": chart.get("type"),
            "unit": chart.get("unit"),
            "summary": chart.get("summary"),
        }
        x_axis = chart.get("xAxis")
        if isinstance(x_axis, list):
            compact["xAxis"] = x_axis[:30]
            compact["truncatedXAxis"] = max(len(x_axis) - 30, 0)
        series = []
        for item in (chart.get("series") or [])[:4]:
            if isinstance(item, dict):
                data = item.get("data") if isinstance(item.get("data"), list) else []
                series.append({
                    "name": item.get("name"),
                    "type": item.get("type"),
                    "unit": item.get("unit"),
                    "data": data[:30],
                    "truncatedData": max(len(data) - 30, 0),
                })
        if series:
            compact["series"] = series
        pie_data = chart.get("data")
        if isinstance(pie_data, list):
            compact["data"] = pie_data[:20]
            compact["truncatedData"] = max(len(pie_data) - 20, 0)
        result.append(compact)
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
        "selfCheck": _compact_value(assistant_plan.get("selfCheck") if isinstance(assistant_plan, dict) else {}),
        "contextUsed": _compact_value(assistant_plan.get("contextUsed") if isinstance(assistant_plan, dict) else []),
        "conversationContext": _compact_value(payload.get("conversationContext")),
        "knowledge": _compact_value(payload.get("knowledge")),
        "knowledgeReferences": _compact_value(payload.get("knowledgeReferences")),
        "deterministicAnswer": payload.get("answer"),
        "tables": _compact_tables(payload.get("tables")),
        "charts": _compact_charts(payload.get("charts")),
        "querySpec": _compact_value(payload.get("querySpec")),
        "permission": _compact_value(payload.get("permission")),
        "chartGuidance": _compact_value(payload.get("chartGuidance")),
        "diagnostics": _compact_value(payload.get("diagnostics")),
        "freshness": _compact_value(payload.get("freshness")),
        "conversationMemory": _compact_value(payload.get("conversationMemory")),
        "reportGuidance": _compact_value(payload.get("reportGuidance")),
        "quality": _compact_value(payload.get("quality")),
        "data": _compact_value(payload.get("data")),
        "userContext": _compact_value(user_context or {}),
    }


def _assistant_messages(question: str, context: dict[str, Any], language: str) -> list[dict[str, Any]]:
    return [
        {
            "role": "system",
            "content": (
                "You are a read-only business data assistant for an oil sales management system. "
                "You can only answer from the supplied JSON context. Use assistantPlan to understand the "
                "business domain, selected read-only tool, period, entities, metric, dimensions, and any "
                "context inherited from earlier turns. If assistantPlan.subPlans exists, explain that the "
                "question was decomposed and summarize each read-only tool result in order. If comparison exists, "
                "state the baseline period explicitly. Treat deterministicAnswer, tables, and charts as authoritative. "
                "Mention executionHints, assumptions, and selfCheck risks when they materially affect interpretation. "
                "Use querySpec, permission, diagnostics, quality, chartGuidance, and knowledgeReferences when present. "
                "When citing knowledge, use the supplied reference ids such as [K1] and do not invent sources. "
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
    ]


def _chat_completion(
    *,
    url: str,
    model: str,
    messages: list[dict[str, Any]],
    provider: str,
    api_key: str = "",
    timeout: int = 30,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    started_at = time.perf_counter()
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature if temperature is not None else settings.OPENROUTER_TEMPERATURE,
        "max_tokens": max_tokens if max_tokens is not None else settings.OPENROUTER_MAX_TOKENS,
    }
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if provider == "openrouter":
        headers["X-Title"] = settings.OPENROUTER_APP_TITLE
    if provider == "openrouter" and settings.OPENROUTER_HTTP_REFERER:
        headers["HTTP-Referer"] = settings.OPENROUTER_HTTP_REFERER
    req = Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        response_payload = json.loads(resp.read().decode("utf-8"))
    content = ((response_payload.get("choices") or [{}])[0].get("message", {}).get("content", "") or "").strip()
    if not content:
        raise RuntimeError("empty_model_response")
    return content, {
        "durationMs": int((time.perf_counter() - started_at) * 1000),
        "model": response_payload.get("model") or model,
    }


def _openrouter_chat(question: str, context: dict[str, Any], language: str) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    return _chat_completion(
        url=settings.OPENROUTER_BASE_URL,
        model=settings.resolved_openrouter_model,
        messages=_assistant_messages(question, context, language),
        provider="openrouter",
        api_key=settings.OPENROUTER_API_KEY,
        timeout=settings.OPENROUTER_TIMEOUT_SECONDS,
    )


def _local_chat(question: str, context: dict[str, Any], language: str) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    return _chat_completion(
        url=settings.LOCAL_LLM_BASE_URL,
        model=settings.LOCAL_LLM_MODEL,
        messages=_assistant_messages(question, context, language),
        provider="local",
        api_key=settings.LOCAL_LLM_API_KEY,
        timeout=settings.LOCAL_LLM_TIMEOUT_SECONDS,
    )


_ASSISTANT_PERIOD_PARSE_SYSTEM_PROMPT = (
    "你是销售数据平台的查询理解助手。根据用户问题中的时间表达，输出唯一的时间区间。"
    "只输出一个 JSON 对象，不要输出任何其他文字，格式："
    '{"label": "月初", "start": "2026-08-01", "end": "2026-08-06"}。'
    "label 是简短的中文期间名（如 月初、上周、本月），start 为区间开始日（含），end 为区间结束日（含）。"
    "end 不得晚于今天，start 不得晚于 end。"
    '无法确定时间区间时输出 {"label": "", "start": "", "end": ""}。'
)


def _parse_period_json(content: str, today: date) -> tuple[str, date, date] | None:
    text = (content or "").strip()
    # openrouter/free 常路由到推理模型，JSON 可能被代码围栏或散文包住
    if text.startswith("```"):
        first_nl = text.find("\n")
        last = text.rfind("```")
        if first_nl != -1 and last > first_nl:
            text = text[first_nl + 1:last].strip()
    payload = None
    candidates = [text]
    start_brace = text.find("{")
    end_brace = text.rfind("}")
    if start_brace != -1 and end_brace > start_brace:
        candidates.append(text[start_brace:end_brace + 1])
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
            break
        except (json.JSONDecodeError, TypeError):
            continue
    if not isinstance(payload, dict):
        return None
    label = payload.get("label")
    start_text = payload.get("start")
    end_text = payload.get("end")
    if not isinstance(label, str) or not label.strip() or not start_text or not end_text:
        return None
    try:
        start = date.fromisoformat(str(start_text))
        end = date.fromisoformat(str(end_text))
    except (ValueError, TypeError):
        return None
    if start > end or end > today:
        return None
    return label.strip(), start, end


def assistant_llm_parse_period(question: str, today: date) -> tuple[str, date, date] | None:
    # 规则解析不出但问题带明确时间时，用 LLM 补一次结构化解析；任何失败都回退规则结果
    settings = get_settings()
    if settings.resolved_assistant_provider != "openrouter" or not settings.OPENROUTER_API_KEY:
        return None
    messages = [
        {"role": "system", "content": _ASSISTANT_PERIOD_PARSE_SYSTEM_PROMPT},
        {"role": "user", "content": f"今天是{today.isoformat()}。用户问题：{question}"},
    ]
    # openrouter/free 免费模型响应不稳定，空响应/坏格式时重试，最多 3 次
    for _ in range(3):
        try:
            content, _ = _chat_completion(
                url=settings.OPENROUTER_BASE_URL,
                model=settings.resolved_openrouter_model,
                messages=messages,
                provider="openrouter",
                api_key=settings.OPENROUTER_API_KEY,
                timeout=settings.OPENROUTER_TIMEOUT_SECONDS,
                temperature=0.0,
                max_tokens=512,
            )
        except Exception:
            continue
        parsed = _parse_period_json(content, today)
        if not parsed:
            continue
        label, start, end_inclusive = parsed
        return label, start, end_inclusive + timedelta(days=1)
    return None


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
    provider = settings.resolved_assistant_provider
    if not use_llm:
        return result
    if provider == "openrouter" and not settings.OPENROUTER_API_KEY:
        return result
    try:
        context = compact_assistant_payload(payload, user_context)
        answer, meta = _local_chat(question, context, lang) if provider == "local" else _openrouter_chat(question, context, lang)
        result["answer"] = answer
        result["agent"].update({"llmUsed": True, "status": "ok", "model": meta.get("model"), "durationMs": meta.get("durationMs")})
    except HTTPError as exc:
        result["agent"].update({"status": "failed", "error": f"openrouter_http_{exc.code}"})
    except (URLError, TimeoutError) as exc:
        result["agent"].update({"status": "failed", "error": exc.__class__.__name__})
    except Exception as exc:
        result["agent"].update({"status": "failed", "error": exc.__class__.__name__})
    return result
