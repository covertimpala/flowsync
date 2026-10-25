from datetime import datetime, timedelta

from ..models import RecurrenceRule

_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _add_months(d: datetime, months: int) -> datetime:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    max_day = 29 if month == 2 and _is_leap(year) else _DAYS_IN_MONTH[month - 1]
    return d.replace(year=year, month=month, day=min(d.day, max_day))


def next_occurrence(base: datetime, rule: RecurrenceRule) -> datetime | None:
    """The next due date for a recurring task, counted from `base` (its
    current due date, or the moment it was completed if it never had
    one). None for a one-off (non-recurring) task."""
    if rule == RecurrenceRule.daily:
        return base + timedelta(days=1)
    if rule == RecurrenceRule.weekly:
        return base + timedelta(days=7)
    if rule == RecurrenceRule.monthly:
        return _add_months(base, 1)
    if rule == RecurrenceRule.yearly:
        return _add_months(base, 12)
    return None
