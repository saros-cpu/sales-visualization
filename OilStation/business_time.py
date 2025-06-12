def shift_join(selling_alias="s", shift_alias="sh"):
    return (
        f"JOIN shift {shift_alias} "
        f"ON {shift_alias}.ShopKey = {selling_alias}.ShopKey "
        f"AND {shift_alias}.ShiftKey = {selling_alias}.ShiftKey "
        f"AND {shift_alias}.DatetimeShiftBegin IS NOT NULL "
        f"AND {shift_alias}.DatetimeShiftEnd IS NOT NULL "
        f"AND {shift_alias}.DatetimeShiftEnd > {shift_alias}.DatetimeShiftBegin"
    )


def business_date_expr(selling_alias="s", shift_alias="sh"):
    """Return the business date expression based on shift boundaries.

    Normal shifts belong to their begin date. If a shift starts late at night
    and ends on the next calendar day, it belongs to the end date. This handles
    operational days opened a few minutes before midnight for the next day.
    """
    return (
        "CASE "
        f"WHEN {shift_alias}.DatetimeShiftBegin IS NOT NULL "
        f"AND {shift_alias}.DatetimeShiftEnd IS NOT NULL "
        f"AND DATE({shift_alias}.DatetimeShiftBegin) <> DATE({shift_alias}.DatetimeShiftEnd) "
        f"AND TIME({shift_alias}.DatetimeShiftBegin) >= '18:00:00' "
        f"THEN DATE({shift_alias}.DatetimeShiftEnd) "
        f"WHEN {shift_alias}.DatetimeShiftBegin IS NOT NULL "
        f"THEN DATE({shift_alias}.DatetimeShiftBegin) "
        f"ELSE DATE({selling_alias}.TransactionDatetime) "
        "END"
    )


def shift_business_date_expr(shift_alias="s"):
    """Return the business date expression for shift-owned tables."""
    return (
        "CASE "
        f"WHEN {shift_alias}.DatetimeShiftBegin IS NOT NULL "
        f"AND {shift_alias}.DatetimeShiftEnd IS NOT NULL "
        f"AND DATE({shift_alias}.DatetimeShiftBegin) <> DATE({shift_alias}.DatetimeShiftEnd) "
        f"AND TIME({shift_alias}.DatetimeShiftBegin) >= '18:00:00' "
        f"THEN DATE({shift_alias}.DatetimeShiftEnd) "
        f"ELSE DATE({shift_alias}.DatetimeShiftBegin) "
        "END"
    )


def business_period_condition(selling_alias="s", shift_alias="sh"):
    expr = business_date_expr(selling_alias, shift_alias)
    return f"{expr} >= %s AND {expr} < %s"


def business_period_condition_with_pruning(selling_alias="s", shift_alias="sh"):
    expr = business_date_expr(selling_alias, shift_alias)
    return (
        f"{selling_alias}.TransactionDatetime >= DATE_SUB(%s, INTERVAL 1 DAY) "
        f"AND {selling_alias}.TransactionDatetime < DATE_ADD(%s, INTERVAL 1 DAY) "
        f"AND {expr} >= %s AND {expr} < %s "
        f"AND {shift_alias}.DatetimeShiftEnd < DATE_ADD(%s, INTERVAL 1 DAY)"
    )


def business_period_params(start, end):
    return (start, end, start, end, end)


def selling_business_day_subquery(alias="selling", start=None, end=None, shop_keys=None):
    expr = business_date_expr("s", "sh")
    pruning = ""
    if start and end:
        pruning = (
            f" WHERE s.TransactionDatetime >= DATE_SUB('{start}', INTERVAL 1 DAY)"
            f" AND s.TransactionDatetime < DATE_ADD('{end}', INTERVAL 1 DAY)"
        )
        if shop_keys:
            keys = ",".join(str(int(key)) for key in shop_keys)
            pruning += f" AND s.ShopKey IN ({keys})"
    return (
        f"(SELECT s.*, {expr} AS business_day "
        f"FROM selling s {shift_join('s', 'sh')}{pruning}) {alias}"
    )
