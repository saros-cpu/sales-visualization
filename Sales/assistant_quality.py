from __future__ import annotations

from datetime import date
from typing import Any


ROUTE_PERMISSION_MAP: dict[str, tuple[str, ...]] = {
    "retail_summary": ("retail:view",),
    "retail_ranking": ("retail:view",),
    "retail_trend": ("retail:view",),
    "retail_comparison": ("retail:view",),
    "retail_resource_share": ("retail:view",),
    "retail_inventory": ("retail:view",),
    "retail_price": ("retail:view",),
    "retail_kpi": ("retail:view",),
    "station_trend_anomaly": ("retail:view",),
    "station_data_check": ("retail:view",),
    "station_status": ("retail:view",),
    "self_use_summary": ("retail:view",),
    "wholesale_summary": ("wholesale:view",),
    "wholesale_review": ("wholesale:view",),
    "combined_summary": ("dashboard:view",),
    "exchange_summary": ("exchange:view",),
    "market_summary": ("exchange:view",),
    "density_summary": ("retail:view",),
    "accounting_report_status": ("retail:view",),
    "contract_summary": ("contracts:view",),
    "procurement_summary": ("procurement:view",),
    "weighing_summary": ("weighing:view",),
    "materials_summary": ("materials:view",),
    "material_transfer_summary": ("materials:view",),
    "transfer_loss_summary": ("transfer_loss:view",),
    "system_health_summary": ("system_health:view",),
    "knowledge_summary": ("knowledge:view",),
    "audit_log_summary": ("audit_logs:view",),
    "alias_summary": ("aliases:view",),
    "user_permission_summary": ("users:view",),
    "settings_summary": ("settings:view",),
    "compound_query": ("dashboard:view",),
}

SUMMARY_ROUTES = {
    "retail_summary",
    "self_use_summary",
    "wholesale_summary",
    "combined_summary",
    "procurement_summary",
    "weighing_summary",
    "materials_summary",
    "material_transfer_summary",
    "transfer_loss_summary",
    "system_health_summary",
    "knowledge_summary",
    "audit_log_summary",
    "alias_summary",
    "user_permission_summary",
    "settings_summary",
}

CHART_CAPABLE_ROUTES = {
    "retail_summary",
    "retail_ranking",
    "retail_trend",
    "retail_comparison",
    "retail_resource_share",
    "retail_inventory",
    "retail_kpi",
    "station_trend_anomaly",
    "self_use_summary",
    "wholesale_summary",
    "combined_summary",
    "exchange_summary",
    "density_summary",
    "procurement_summary",
    "weighing_summary",
    "materials_summary",
    "material_transfer_summary",
    "transfer_loss_summary",
    "compound_query",
}

REPORT_GUIDANCE: dict[str, dict[str, Any]] = {
    "self_use_summary": {
        "reportNo": "24",
        "name": "自用油报表",
        "principle": "report24-only: BasePaymentTypeKey=2 AND DerivedPaymentTypeKey=2。",
    },
    "accounting_report_status": {
        "reportNo": "84",
        "name": "吉方财务交接日报",
        "principle": "必须与原 84 数据、版式、字段、顺序和文件行为完全一致。",
    },
    "retail_summary": {
        "reportNo": "254/84",
        "name": "零售管理汇总",
        "principle": "汇总口径对照原 254，明细数据源参考原 84，但按自然日汇总。",
    },
}


def compact_permission_codes(user_context: dict[str, Any] | None) -> set[str]:
    if not isinstance(user_context, dict):
        return set()
    codes = user_context.get("permissionCodes")
    if isinstance(codes, list):
        return {str(item) for item in codes if item}
    return set()


def user_role(user_context: dict[str, Any] | None) -> str:
    user = user_context.get("user") if isinstance(user_context, dict) else {}
    return str((user or {}).get("role") or "")


def required_permissions(plan: dict[str, Any] | None) -> tuple[str, ...]:
    route = str((plan or {}).get("route") or "")
    if route == "compound_query":
        required: list[str] = []
        for subplan in (plan or {}).get("subPlans") or []:
            if isinstance(subplan, dict):
                required.extend(required_permissions(subplan))
        return tuple(dict.fromkeys(required or list(ROUTE_PERMISSION_MAP.get(route, ()))))
    return ROUTE_PERMISSION_MAP.get(route, ("dashboard:view",))


def route_module(plan: dict[str, Any] | None) -> str:
    required = required_permissions(plan)
    if not required:
        return "dashboard"
    return str(required[0]).split(":", 1)[0]


def data_scope_result(user_context: dict[str, Any] | None, plan: dict[str, Any] | None) -> dict[str, Any]:
    module_key = route_module(plan)
    scope_type = ((user_context or {}).get("dataScopes") or {}).get(module_key)
    resources = ((user_context or {}).get("dataScopeResources") or {}).get(module_key) or {}
    return {
        "module": module_key,
        "scope": scope_type or "all",
        "resourceTypes": sorted(resources.keys()),
        "customResourceCount": sum(len(items or []) for items in resources.values()),
    }


def _custom_resource_sets(user_context: dict[str, Any] | None, module_key: str, resource_types: tuple[str, ...]) -> tuple[set[str], set[str]]:
    resources = ((user_context or {}).get("dataScopeResources") or {}).get(module_key) or {}
    ids: set[str] = set()
    labels: set[str] = set()
    for resource_type in resource_types:
        for item in resources.get(resource_type) or []:
            if isinstance(item, dict):
                if item.get("id") not in (None, ""):
                    ids.add(str(item.get("id")))
                if item.get("label"):
                    labels.add(str(item.get("label")))
    return ids, labels


def _station_entity_allowed(user_context: dict[str, Any] | None, plan: dict[str, Any] | None) -> bool:
    if not isinstance(plan, dict):
        return True
    module_key = route_module(plan)
    if ((user_context or {}).get("dataScopes") or {}).get(module_key) != "custom":
        return True
    station = (plan.get("entities") or {}).get("station") if isinstance(plan.get("entities"), dict) else None
    if not isinstance(station, dict):
        return True
    ids, labels = _custom_resource_sets(user_context, module_key, ("station", "depot"))
    candidates = {str(station.get("shopKey") or ""), str(station.get("stationNo") or ""), str(station.get("id") or "")}
    label_candidates = {str(station.get("name") or ""), str(station.get("short") or "")}
    return bool((ids and candidates.intersection(ids)) or (labels and label_candidates.intersection(labels)))


def has_required_permission(user_context: dict[str, Any] | None, plan: dict[str, Any] | None) -> bool:
    if not isinstance(plan, dict) or not plan.get("route"):
        return True
    role = user_role(user_context)
    if role == "admin":
        return True
    codes = compact_permission_codes(user_context)
    if "*" in codes:
        return True
    required = required_permissions(plan)
    for code in required:
        module = code.split(":", 1)[0]
        if code in codes or f"{module}:*" in codes:
            return _station_entity_allowed(user_context, plan)
    return False


def permission_result(user_context: dict[str, Any] | None, plan: dict[str, Any] | None) -> dict[str, Any]:
    required = required_permissions(plan)
    allowed = has_required_permission(user_context, plan)
    return {
        "allowed": allowed,
        "required": list(required),
        "role": user_role(user_context),
    }


def build_permission_refusal(question: str, plan: dict[str, Any], user_context: dict[str, Any] | None, language: str | None = None) -> dict[str, Any]:
    perm = permission_result(user_context, plan)
    is_ru = str(language or "").lower().startswith("ru")
    answer = (
        "У текущего пользователя нет прав на этот бизнес-раздел. Я не буду запрашивать или раскрывать эти данные."
        if is_ru
        else "当前用户没有这个业务模块的查看权限，我不会查询或展示这部分数据。"
    )
    return {
        "ok": True,
        "question": question,
        "periodLabel": "permission_denied",
        "answer": answer,
        "tables": [],
        "charts": [],
        "assistantPlan": plan,
        "permission": perm,
        "quality": {
            "status": "blocked",
            "score": 1.0,
            "checks": [{"code": "permission", "status": "blocked", "detail": "route permission denied"}],
        },
        "agent": {
            "mode": "read_only",
            "provider": "business-rule-engine",
            "model": "assistant-permission-guard",
            "llmUsed": False,
            "status": "permission_denied",
            "canModifyCode": False,
            "canModifyFiles": False,
            "canModifyBusinessData": False,
        },
    }


def build_query_spec(plan: dict[str, Any] | None, user_context: dict[str, Any] | None = None) -> dict[str, Any]:
    plan = plan if isinstance(plan, dict) else {}
    period = plan.get("period") if isinstance(plan.get("period"), dict) else {}
    comparison = plan.get("comparison") if isinstance(plan.get("comparison"), dict) else None
    entities = plan.get("entities") if isinstance(plan.get("entities"), dict) else {}
    return {
        "mode": "read_only",
        "route": plan.get("route"),
        "domain": plan.get("domain"),
        "intent": plan.get("intent"),
        "metric": plan.get("metric"),
        "dimensions": plan.get("dimensions") if isinstance(plan.get("dimensions"), list) else [],
        "period": {
            "label": period.get("label"),
            "start": period.get("start"),
            "endExclusive": period.get("endExclusive"),
        },
        "comparison": comparison,
        "entities": {
            key: value
            for key, value in entities.items()
            if key in {"station", "resource", "customer", "supplier", "vehicle"}
        },
        "allowedOperations": ["select", "aggregate", "rank", "trend", "compare", "explain"],
        "blockedOperations": ["insert", "update", "delete", "approve", "reject", "import", "export", "refresh", "execute"],
        "requiredPermissions": list(required_permissions(plan)),
        "permission": permission_result(user_context, plan) if user_context is not None else None,
        "dataScope": data_scope_result(user_context, plan) if user_context is not None else None,
    }


def build_knowledge_references(snippets: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    refs = []
    for index, item in enumerate(snippets or [], start=1):
        if not isinstance(item, dict):
            continue
        refs.append({
            "id": f"K{index}",
            "articleId": item.get("id"),
            "title": item.get("title") or "-",
            "source": " / ".join(part for part in [item.get("spaceName"), item.get("categoryName")] if part),
            "moduleKey": item.get("moduleKey") or "",
            "updatedAt": item.get("updatedAt"),
            "snippet": item.get("snippet") or "",
        })
    return refs


def recommended_chart(plan: dict[str, Any] | None, charts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    plan = plan if isinstance(plan, dict) else {}
    route = str(plan.get("route") or "")
    visual = plan.get("visual") if isinstance(plan.get("visual"), dict) else {}
    requested = bool(visual.get("requested"))
    preferred = str(visual.get("preferredType") or "auto")
    dimensions = plan.get("dimensions") if isinstance(plan.get("dimensions"), list) else []
    if route in {"retail_trend", "station_trend_anomaly", "exchange_summary"} or "date" in dimensions:
        chart_type = "line"
    elif route in {"retail_comparison", "combined_summary"} or plan.get("comparison"):
        chart_type = "mixed"
    elif route == "retail_resource_share" or preferred == "pie":
        chart_type = "pie"
    elif route in CHART_CAPABLE_ROUTES:
        chart_type = "bar"
    else:
        chart_type = preferred
    if preferred in {"bar", "line", "pie", "mixed"} and requested:
        chart_type = preferred
    reason = "趋势/日期维度优先折线，排行/分类优先柱状，对比优先混合图，结构占比优先饼图。"
    return {
        "requested": requested,
        "preferredType": preferred,
        "recommendedType": chart_type,
        "recommended": {
            "kind": chart_type,
            "reason": reason,
        },
        "hasCharts": bool(charts),
        "reason": reason,
    }


def build_business_diagnostics(payload: dict[str, Any], user_context: dict[str, Any] | None = None) -> dict[str, Any]:
    plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    route = str(plan.get("route") or "")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    warnings: list[str] = []
    insights: list[str] = []
    next_checks: list[str] = []
    if not payload.get("answer"):
        warnings.append("回答为空，需要检查只读工具是否返回了结论。")
    if route in SUMMARY_ROUTES and not payload.get("tables"):
        warnings.append("摘要类问题没有返回表格，建议补充明细或合计表。")
    if (plan.get("visual") or {}).get("requested") and not payload.get("charts"):
        warnings.append("用户要求图表，但本次响应没有可渲染 charts。")
    if route == "station_trend_anomaly":
        next_checks.extend(["核对日快照是否完整", "核对站点状态/停电停业记录", "核对油品结构和库存价格变化"])
    elif route == "accounting_report_status":
        next_checks.extend(["核对原 84 报表对应日期", "核对缺站清单", "核对前一日参考文件夹"])
    elif route == "transfer_loss_summary":
        next_checks.extend(["优先查看差异最大的站点", "核对外运称重与收油日期差", "核对系统吨数与实收吨数"])
    elif route == "weighing_summary":
        next_checks.extend(["按分类和审核状态拆分", "核对待审核/待复核积压", "核对车辆和来源单号"])
    elif route == "procurement_summary":
        next_checks.extend(["按供应商排行", "按油品拆分", "核对采购称重来源"])
    summary = data.get("summary") if isinstance(data.get("summary"), dict) else {}
    if summary:
        numeric_values = [float(value or 0) for value in summary.values() if isinstance(value, (int, float))]
        if numeric_values and all(value == 0 for value in numeric_values):
            warnings.append("汇总值为 0，可能是当前期间暂无数据或快照/导入尚未完成。")
    if isinstance(data.get("dataScope"), dict):
        insights.append("本次结果已按当前用户的数据范围过滤。")
    question = str(payload.get("question") or "")
    if any(word in question for word in ("为什么", "原因", "怎么回事", "异常", "下滑", "掉得厉害")):
        station_rows = data.get("stations") if isinstance(data.get("stations"), list) else []
        resource_rows = data.get("byResource") if isinstance(data.get("byResource"), list) else []
        if station_rows:
            top_station = max(station_rows, key=lambda item: float((item or {}).get("amount") or (item or {}).get("volume") or 0))
            insights.append(f"可先看站点贡献：{top_station.get('name') or top_station.get('stationName') or '-'}。")
        if resource_rows:
            top_resource = max(resource_rows, key=lambda item: float((item or {}).get("amount") or (item or {}).get("volume") or 0))
            insights.append(f"可先看油品贡献：{top_resource.get('name') or top_resource.get('productName') or '-'}。")
    perm = permission_result(user_context, plan) if user_context is not None else None
    if perm and not perm.get("allowed"):
        warnings.append("当前用户无权查看该业务模块。")
    if not warnings:
        insights.append("回答结构满足当前只读业务问答要求。")
    return {
        "status": "warn" if warnings else "ok",
        "warnings": warnings,
        "insights": insights,
        "nextChecks": next_checks,
    }


def build_data_freshness(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    period = plan.get("period") if isinstance(plan.get("period"), dict) else {}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    sources: list[str] = []
    for key in ("source", "sourceFile", "month", "generatedAt", "updatedAt"):
        value = data.get(key)
        if value:
            sources.append(f"{key}:{value}")
    end_exclusive = str(payload.get("queryEndExclusive") or period.get("endExclusive") or "")
    status = "unknown"
    warnings: list[str] = []
    if end_exclusive:
        try:
            end_day = date.fromisoformat(end_exclusive)
            status = "complete" if end_day <= date.today() else "partial"
            if status == "partial":
                warnings.append("查询区间包含今天或未来日期，当前快照可能只覆盖已完成业务日。")
        except ValueError:
            status = "unknown"
    if not sources and not data:
        warnings.append("未返回可识别的数据来源元信息。")
    return {
        "status": status,
        "periodLabel": (period or {}).get("label") or payload.get("periodLabel"),
        "queryStart": payload.get("queryStart") or period.get("start"),
        "queryEndExclusive": end_exclusive or None,
        "sources": sources[:8],
        "warnings": warnings,
    }


def build_conversation_memory(payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    entities = plan.get("entities") if isinstance(plan.get("entities"), dict) else {}
    return {
        "domain": plan.get("domain"),
        "route": plan.get("route"),
        "intent": plan.get("intent"),
        "metric": plan.get("metric"),
        "dimensions": plan.get("dimensions") if isinstance(plan.get("dimensions"), list) else [],
        "period": plan.get("period") if isinstance(plan.get("period"), dict) else {},
        "entities": {
            key: value for key, value in entities.items()
            if key in {"station", "resource", "customer", "supplier"}
        },
        "contextUsed": plan.get("contextUsed") if isinstance(plan.get("contextUsed"), list) else [],
    }


def build_report_guidance(plan: dict[str, Any] | None) -> dict[str, Any] | None:
    route = str((plan or {}).get("route") or "")
    guidance = REPORT_GUIDANCE.get(route)
    return dict(guidance) if guidance else None


def evaluate_response_quality(payload: dict[str, Any], user_context: dict[str, Any] | None = None) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(code: str, status: str, detail: str = "") -> None:
        item = {"code": code, "status": status}
        if detail:
            item["detail"] = detail
        checks.append(item)

    plan = payload.get("assistantPlan") if isinstance(payload.get("assistantPlan"), dict) else {}
    route = str(plan.get("route") or "")
    agent = payload.get("agent") if isinstance(payload.get("agent"), dict) else {}
    if agent.get("status") == "blocked_action_request":
        add("readonly_refusal", "pass", "action request blocked")
    elif agent.get("status") == "permission_denied":
        required = ",".join(required_permissions(plan))
        add("permission_guard", "pass", required or "permission denied")
        return {
            "status": "blocked",
            "score": 1.0,
            "checks": checks,
        }
    else:
        add("plan", "pass" if route else "fail", route or "missing assistantPlan.route")
        tool = plan.get("tool") if isinstance(plan.get("tool"), dict) else {}
        add("readonly_tool", "pass" if tool.get("readOnly") is True else "fail", str(tool.get("name") or route))
        add("answer", "pass" if str(payload.get("answer") or "").strip() else "fail", "non-empty answer required")
        if route in SUMMARY_ROUTES:
            add("tables", "pass" if payload.get("tables") else "warn", "summary route should return tables")
        visual = plan.get("visual") if isinstance(plan.get("visual"), dict) else {}
        if visual.get("requested"):
            add("charts", "pass" if payload.get("charts") else "warn", "chart requested")
        if user_context is not None:
            perm = permission_result(user_context, plan)
            add("permission", "pass" if perm.get("allowed") else "fail", ",".join(perm.get("required") or []))
        self_check = plan.get("selfCheck") if isinstance(plan.get("selfCheck"), dict) else {}
        if self_check:
            add("self_check", "fail" if self_check.get("status") == "fail" else "pass", str(self_check.get("status") or ""))
        if payload.get("knowledge"):
            add("knowledge_references", "pass" if payload.get("knowledgeReferences") else "warn", "knowledge snippets should be cited")
    failures = [item for item in checks if item["status"] == "fail"]
    warnings = [item for item in checks if item["status"] == "warn"]
    score = max(0.0, round(1 - len(failures) * 0.35 - len(warnings) * 0.12, 2))
    return {
        "status": "fail" if failures else "warn" if warnings else "pass",
        "score": score,
        "checks": checks,
    }


def enrich_assistant_payload(payload: dict[str, Any], user_context: dict[str, Any] | None = None) -> dict[str, Any]:
    result = dict(payload)
    plan = result.get("assistantPlan") if isinstance(result.get("assistantPlan"), dict) else {}
    charts = result.get("charts") if isinstance(result.get("charts"), list) else []
    if plan:
        result["querySpec"] = build_query_spec(plan, user_context)
        result["permission"] = permission_result(user_context, plan) if user_context is not None else None
        result["chartGuidance"] = recommended_chart(plan, charts)
        if any(word in str(result.get("question") or "") for word in ("这根柱", "这个点", "这个异常点", "异常点", "展开", "钻取", "明细")):
            result["chartGuidance"]["drilldown"] = {
                "requested": True,
                "hint": "请明确要展开的站点、油品、日期或图表标签；助手会复用上一轮时间和指标。",
            }
        result["conversationMemory"] = build_conversation_memory(result)
        report_guidance = build_report_guidance(plan)
        if report_guidance:
            result["reportGuidance"] = report_guidance
    if result.get("knowledge") and not result.get("knowledgeReferences"):
        result["knowledgeReferences"] = build_knowledge_references(result.get("knowledge"))
    result["diagnostics"] = build_business_diagnostics(result, user_context)
    result["freshness"] = build_data_freshness(result)
    question = str(result.get("question") or "")
    if (
        result["diagnostics"].get("nextChecks")
        and any(word in question for word in ("为什么", "原因", "异常", "诊断", "怎么回事", "下滑", "掉得厉害"))
        and "建议排查" not in str(result.get("answer") or "")
    ):
        checks = "；".join(str(item) for item in result["diagnostics"]["nextChecks"][:4])
        result["answer"] = f"{str(result.get('answer') or '').rstrip()}\n建议排查：{checks}。".strip()
    result["quality"] = evaluate_response_quality(result, user_context)
    return result
