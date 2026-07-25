from __future__ import annotations

from datetime import date, timedelta


WHOLESALE_SOURCE_CUTOFF = date(2026, 6, 1)
WHOLESALE_WEIGHING_END_DATE = WHOLESALE_SOURCE_CUTOFF - timedelta(days=1)


def detail_source_policy_clause(alias: str = "d") -> str:
    """Business source split: weighing-generated rows before cutoff, uploaded/manual rows from cutoff."""
    return (
        f"(({alias}.business_date < %s AND {alias}.batch_id IS NULL) "
        f"OR ({alias}.business_date >= %s AND {alias}.batch_id IS NOT NULL))"
    )


def detail_source_policy_params() -> tuple[date, date]:
    return (WHOLESALE_SOURCE_CUTOFF, WHOLESALE_SOURCE_CUTOFF)


def clamp_weighing_detail_range(start: date, end: date) -> tuple[date, date] | None:
    """Limit weighing-generated business details to dates before the upload cutoff."""
    effective_end = min(end, WHOLESALE_WEIGHING_END_DATE)
    if start > effective_end:
        return None
    return start, effective_end
