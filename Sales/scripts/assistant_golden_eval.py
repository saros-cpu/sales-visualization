from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from flask_jwt_extended import create_access_token

from api import app


FIXTURE = ROOT / "tests" / "fixtures" / "assistant_golden_eval.json"


def main() -> int:
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))
    with app.app_context():
        token = create_access_token(identity="1")
    client = app.test_client()
    failures: list[dict] = []
    results: list[dict] = []
    for case in cases:
        resp = client.post(
            "/api/v2/assistant/query",
            json={"question": case["question"], "useLlm": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        outer = resp.get_json(silent=True) or {}
        data = outer.get("data") if isinstance(outer.get("data"), dict) else {}
        plan = data.get("assistantPlan") if isinstance(data.get("assistantPlan"), dict) else {}
        agent = data.get("agent") if isinstance(data.get("agent"), dict) else {}
        answer = str(data.get("answer") or "")
        result = {
            "id": case["id"],
            "status": resp.status_code,
            "route": plan.get("route"),
            "agentStatus": agent.get("status"),
            "tables": len(data.get("tables") or []),
            "charts": len(data.get("charts") or []),
            "quality": (data.get("quality") or {}).get("status"),
        }
        results.append(result)
        if resp.status_code != 200:
            failures.append({**result, "reason": "http_status"})
        if case.get("expectedRoute") and plan.get("route") != case["expectedRoute"]:
            failures.append({**result, "reason": "route"})
        if case.get("expectedAgentStatus") and agent.get("status") != case["expectedAgentStatus"]:
            failures.append({**result, "reason": "agent_status"})
        if len(data.get("tables") or []) < int(case.get("minTables") or 0):
            failures.append({**result, "reason": "tables"})
        if len(data.get("charts") or []) < int(case.get("minCharts") or 0):
            failures.append({**result, "reason": "charts"})
        for text in case.get("answerContains") or []:
            if str(text) not in answer:
                failures.append({**result, "reason": f"answer_missing:{text}"})
    legacy_resp = client.post(
        "/api/data-assistant/query",
        json={"question": "今年零售数据", "useLlm": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    if legacy_resp.headers.get("Deprecation") != "true":
        failures.append({"id": "legacy_deprecation_header", "status": legacy_resp.status_code, "reason": "missing_deprecation_header"})
    stream_resp = client.post(
        "/api/v2/assistant/query/stream",
        json={"question": "今年自用油数据"},
        headers={"Authorization": f"Bearer {token}"},
    )
    stream_text = stream_resp.get_data(as_text=True)
    if stream_resp.status_code != 200 or "event: final" not in stream_text:
        failures.append({"id": "assistant_stream_final_event", "status": stream_resp.status_code, "reason": "missing_final_event"})
    print(json.dumps({"ok": not failures, "results": results, "failures": failures}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
