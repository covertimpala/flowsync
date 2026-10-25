from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlmodel import Session, select

from ..models import CalendarEvent, ItemStatus, Task
from .scheduler import Busy, SchedulerEngine, TimeSlot


@dataclass
class Opening:
    day: datetime
    slot: TimeSlot
    workload_ratio: float  # 0 = day is empty, 1 = day is fully booked


def find_opening(
    session: Session,
    task: Task,
    *,
    days_ahead: int = 14,
    scheduler: SchedulerEngine | None = None,
) -> Opening | None:
    """Looks at the next `days_ahead` days and finds where `task` best
    fits: among every day with a free slot long enough for it, picks the
    day with the lightest *predicted workload* — the smallest fraction of
    the working window already taken by calendar events and other
    scheduled tasks — rather than just the very next opening. Ties go to
    the earlier day.
    """
    scheduler = scheduler or SchedulerEngine()
    needed = timedelta(minutes=task.estimated_minutes)
    window_minutes = (scheduler.day_end_hour - scheduler.day_start_hour) * 60
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    best: Opening | None = None

    for offset in range(1, days_ahead + 1):
        day = today + timedelta(days=offset)
        day_end = day + timedelta(days=1)

        events = session.exec(
            select(CalendarEvent).where(
                CalendarEvent.status == ItemStatus.confirmed,
                CalendarEvent.start < day_end,
                CalendarEvent.end > day,
            )
        ).all()
        other_tasks = session.exec(
            select(Task).where(
                Task.id != task.id,
                Task.status == ItemStatus.confirmed,
                Task.completed == False,  # noqa: E712
                Task.scheduled_start != None,  # noqa: E711
                Task.scheduled_start < day_end,
                Task.scheduled_end > day,
            )
        ).all()

        busy = list(events) + [Busy(t.scheduled_start, t.scheduled_end) for t in other_tasks]
        free_slots = scheduler.free_slots_for(day, busy)
        free_minutes = sum(s.duration.total_seconds() / 60 for s in free_slots)
        workload_ratio = 1 - (free_minutes / window_minutes if window_minutes else 0)

        fitting = next((s for s in free_slots if s.duration >= needed), None)
        if fitting is None:
            continue

        candidate = Opening(day=day, slot=TimeSlot(fitting.start, fitting.start + needed), workload_ratio=workload_ratio)
        if best is None or candidate.workload_ratio < best.workload_ratio:
            best = candidate

    return best


def describe_opening(task: Task, opening: Opening) -> str:
    day_label = opening.day.strftime("%A, %b %d")
    # %-I (no leading zero) is a glibc extension, not portable to Windows —
    # format normally and strip a leading zero by hand instead.
    time_label = opening.slot.start.strftime("%I:%M %p").lstrip("0")
    load_label = (
        "a wide open day" if opening.workload_ratio < 0.15
        else "a fairly light day" if opening.workload_ratio < 0.4
        else "the best opening found"
    )
    return f'"{task.title}" is overdue — {day_label} at {time_label} looks like {load_label} in the next two weeks.'
