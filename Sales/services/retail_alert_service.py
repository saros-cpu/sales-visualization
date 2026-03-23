from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from assistant_agent import enhance_assistant_response
from db import get_connection
from shared_utils import OILSTATION_ROOT


def ensure_retail_alert_schema(cur) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS retail_alert_insights (
            id BIGINT PRIMARY KEY AUTO_INCREMENT,
            insight_date DATE NOT NULL,
            period_key VARCHAR(16) NOT NULL,
            language VARCHAR(8) NOT NULL DEFAULT 'zh',
            trend_anomalies MEDIUMTEXT NULL,
            suggestions MEDIUMTEXT NULL,
            source_summary MEDIUMTEXT NULL,
            ai_status VARCHAR(64) NULL,
            generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_retail_alert_insight (insight_date, period_key, language),
            KEY idx_generated_at (generated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    cur.execute("SHOW COLUMNS FROM retail_alert_insights LIKE 'language'")
    if not cur.fetchone():
        cur.execute("ALTER TABLE retail_alert_insights ADD COLUMN language VARCHAR(8) NOT NULL DEFAULT 'zh' AFTER period_key")
    cur.execute("""
        SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'retail_alert_insights'
          AND INDEX_NAME = 'uq_retail_alert_insight'
    """)
    row = cur.fetchone()
    columns = row[0] if row else ""
    if columns and columns != "insight_date,period_key,language":
        cur.execute("ALTER TABLE retail_alert_insights DROP INDEX uq_retail_alert_insight")
    if columns != "insight_date,period_key,language":
        cur.execute("ALTER TABLE retail_alert_insights ADD UNIQUE KEY uq_retail_alert_insight (insight_date, period_key, language)")


def _active_month() -> str:
    completed_day = date.today() - timedelta(days=1)
    return f"{completed_day.year}-{completed_day.month:02d}"


def _monthly_snapshot_path(ym: str) -> Path:
    year, month = ym.split("-")
    return OILSTATION_ROOT / "cache_snapshots" / "monthly" / year / f"monthly_{int(month):02d}.json"


def _self_use_snapshot_path(ym: str) -> Path:
    return OILSTATION_ROOT / "cache_snapshots" / "monthly" / f"self_use_{ym}.json"


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _trend_anomalies(monthly: dict[str, Any]) -> list[dict[str, Any]]:
    daily = [item for item in (monthly.get("daily") or []) if _num(item.get("volume")) > 0]
    result: list[dict[str, Any]] = []
    for index, item in enumerate(daily):
        if index < 3:
            continue
        prev_items = daily[max(0, index - 7):index]
        avg_volume = sum(_num(row.get("volume")) for row in prev_items) / len(prev_items) if prev_items else 0
        curr = _num(item.get("volume"))
        if avg_volume > 0 and abs(curr - avg_volume) / avg_volume >= 0.3:
            direction = "up" if curr > avg_volume else "down"
            result.append({
                "type": "daily_volume",
                "date": item.get("date"),
                "direction": direction,
                "currentVolume": round(curr, 2),
                "baselineVolume": round(avg_volume, 2),
                "changePct": round((curr - avg_volume) / avg_volume * 100, 1),
            })
    return result[:30]


def _language(value: str | None) -> str:
    return "ru" if str(value or "").lower().startswith("ru") else "zh"


def _rule_suggestions(monthly: dict[str, Any], self_use: dict[str, Any] | None, anomalies: list[dict[str, Any]], language: str) -> list[str]:
    summary = monthly.get("summary") or {}
    is_ru = _language(language) == "ru"
    suggestions: list[str] = []
    if anomalies:
        suggestions.append(
            "Есть аномалии тренда. Рекомендуется проверить статус АЗС, остатки и изменения цен за соответствующие даты."
            if is_ru else
            "今日存在趋势异常，建议优先核查异常日期对应站点的营业状态、库存和价格调整记录。"
        )
    card_sales = _num(summary.get("cardSales"))
    total_sales = _num(summary.get("totalSales"))
    if total_sales > 0 and card_sales / total_sales < 0.25:
        suggestions.append(
            "Доля оплат картой низкая. Проверьте продвижение безналичной оплаты и доступность терминалов на ключевых АЗС."
            if is_ru else
            "刷卡销售占比较低，可检查重点站点非现金支付推广和设备可用性。"
        )
    resources = sorted((monthly.get("byResource") or []), key=lambda item: _num(item.get("volume")), reverse=True)
    if resources:
        top = resources[0]
        total_volume = sum(_num(item.get("volume")) for item in resources)
        if total_volume > 0 and _num(top.get("volume")) / total_volume > 0.6:
            suggestions.append(
                f"{top.get('name')} занимает высокую долю продаж. Следует контролировать зависимость от одного продукта и график пополнения."
                if is_ru else
                f"{top.get('name')} 销量占比较高，建议关注单一油品依赖和库存补给节奏。"
            )
    if self_use:
        self_summary = self_use.get("summary") or {}
        if _num(self_summary.get("totalVolume")) > 0:
            suggestions.append(
                "В текущем месяце есть собственное использование топлива. При проверке розничных колебаний исключите его влияние."
                if is_ru else
                "自用油已有当月记录，可在核查零售波动时同步排除自用油影响。"
            )
    if not suggestions:
        suggestions.append(
            "Розничный тренд в целом стабилен. Продолжайте отслеживать дневной объем, статус АЗС и структуру продуктов."
            if is_ru else
            "当前零售趋势整体平稳，建议继续关注日销量、站点营业状态和油品结构变化。"
        )
    return suggestions


def _source_summary(monthly: dict[str, Any], self_use: dict[str, Any] | None) -> dict[str, Any]:
    summary = monthly.get("summary") or {}
    self_summary = (self_use or {}).get("summary") or {}
    return {
        "month": monthly.get("month"),
        "totalLiters": summary.get("totalLiters"),
        "totalSales": summary.get("totalSales"),
        "activeShops": summary.get("activeShops"),
        "dailyCount": len(monthly.get("daily") or []),
        "stationCount": len(monthly.get("stations") or []),
        "selfUseVolume": self_summary.get("totalVolume"),
        "selfUseRecords": self_summary.get("totalRecords"),
    }


def generate_retail_alert_insights(ym: str | None = None, *, use_ai: bool = True, language: str = "zh") -> dict[str, Any]:
    period = ym or _active_month()
    lang = _language(language)
    monthly = _read_json(_monthly_snapshot_path(period)) or {}
    self_use = _read_json(_self_use_snapshot_path(period))
    anomalies = _trend_anomalies(monthly) if monthly else []
    suggestions = _rule_suggestions(monthly, self_use, anomalies, lang)
    summary = _source_summary(monthly, self_use)
    ai_status = "not_used"

    if use_ai and monthly:
        question = (
            f"На основе аномалий розничного тренда за {period} сформируй операционные рекомендации."
            if lang == "ru" else
            f"根据 {period} 零售趋势异常，生成运营建议。"
        )
        payload = {
            "ok": True,
            "question": question,
            "periodLabel": period,
            "answer": "\n".join(suggestions),
            "tables": [],
            "data": {"trendAnomalies": anomalies, "summary": summary},
        }
        enhanced = enhance_assistant_response(payload, question=question, language=lang, use_llm=True)
        ai_status = (enhanced.get("agent") or {}).get("status") or "unknown"
        if enhanced.get("agent", {}).get("llmUsed") and enhanced.get("answer"):
            suggestions = [line.strip(" -") for line in str(enhanced["answer"]).splitlines() if line.strip()]

    insight_date = date.today()
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            ensure_retail_alert_schema(cur)
            cur.execute("""
                INSERT INTO retail_alert_insights
                    (insight_date, period_key, language, trend_anomalies, suggestions, source_summary, ai_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    trend_anomalies = VALUES(trend_anomalies),
                    suggestions = VALUES(suggestions),
                    source_summary = VALUES(source_summary),
                    ai_status = VALUES(ai_status),
                    generated_at = CURRENT_TIMESTAMP
            """, (
                insight_date,
                period,
                lang,
                json.dumps(anomalies, ensure_ascii=False),
                json.dumps(suggestions, ensure_ascii=False),
                json.dumps(summary, ensure_ascii=False),
                ai_status,
            ))
            conn.commit()
    finally:
        conn.close()

    return {
        "insightDate": insight_date.isoformat(),
        "periodKey": period,
        "language": lang,
        "trendAnomalies": anomalies,
        "suggestions": suggestions,
        "sourceSummary": summary,
        "aiStatus": ai_status,
        "generatedAt": datetime.now().isoformat(sep=" "),
    }


def latest_retail_alert_insights(ym: str | None = None, language: str = "zh") -> dict[str, Any]:
    period = ym or _active_month()
    lang = _language(language)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            ensure_retail_alert_schema(cur)
            cur.execute("""
                SELECT insight_date, period_key, language, trend_anomalies, suggestions, source_summary, ai_status, generated_at
                FROM retail_alert_insights
                WHERE period_key = %s AND language = %s
                ORDER BY generated_at DESC
                LIMIT 1
            """, (period, lang))
            row = cur.fetchone()
            if not row:
                conn.commit()
                return generate_retail_alert_insights(period, use_ai=False, language=lang)
            return {
                "insightDate": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
                "periodKey": row[1],
                "language": row[2],
                "trendAnomalies": json.loads(row[3] or "[]"),
                "suggestions": json.loads(row[4] or "[]"),
                "sourceSummary": json.loads(row[5] or "{}"),
                "aiStatus": row[6],
                "generatedAt": row[7].isoformat(sep=" ") if hasattr(row[7], "isoformat") else str(row[7]),
            }
    finally:
        conn.close()
