from datetime import date as date_cls
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, ItemStatus, Task
from ..security import require_api_key
from ..services.scheduler import Busy, SchedulerEngine

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(require_api_key)])

_PRIORITY_RANK = {"high": 0, "medium": 1, "low": 2}


def _day_schedule(session: Session, day: datetime) -> dict:
    """Core single-day schedule computation — shared by the single-day and
    date-range endpoints so there's exactly one place that knows how
    events, anchored tasks, the auto-planner, and completed-today tasks
    fit together."""
    day_start, day_end = day, day + timedelta(days=1)

    events = session.exec(
        select(CalendarEvent).where(
            CalendarEvent.status == ItemStatus.confirmed,
            CalendarEvent.start < day_end,
            CalendarEvent.end > day_start,
        )
    ).all()
    incomplete = session.exec(
        select(Task).where(Task.status == ItemStatus.confirmed, Task.completed == False)  # noqa: E712
    ).all()

    # A task with an explicit scheduled_start (set by accepting an AI
    # reschedule suggestion, or by the auto-planner on an earlier visit —
    # see below) is anchored to that specific day. It's shown at that exact
    # time on that day and left out of every other day's view entirely,
    # rather than being silently re-packed into whatever day happens to be
    # requested. Only truly unscheduled tasks go through the auto-planner.
    real_today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    viewing_real_today = day_start == real_today_start

    anchored_today = [
        t for t in incomplete if t.scheduled_start and day_start <= t.scheduled_start < day_end
    ]
    never_scheduled = [t for t in incomplete if not t.scheduled_start]
    # A task anchored to a day that's already passed, still not done, only
    # resurfaces when looking at the *actual* current day (it's a "catch
    # up" concern, not something to inject into whatever day someone
    # happens to be browsing) — and even then it's left untouched here
    # rather than silently moved; /api/ai/check-overdue is what proposes
    # an actual new slot for it, based on due_date.
    stale = (
        [t for t in incomplete if t.scheduled_start and t.scheduled_start < real_today_start]
        if viewing_real_today
        else []
    )

    unscheduled_input = never_scheduled
    unscheduled_input.sort(key=lambda t: (_PRIORITY_RANK[t.priority], t.due_date or datetime.max))

    # Anchored tasks already occupy real time today — the auto-planner has
    # to see them as busy too, or it'll happily hand a brand-new task the
    # exact same slot an already-scheduled one is sitting in.
    busy_for_planning = list(events) + [Busy(t.scheduled_start, t.scheduled_end) for t in anchored_today]
    plan = SchedulerEngine().plan(day, unscheduled_input, busy_for_planning)
    scheduled_ids = set(plan.keys())

    planned = [{"task": t, "start": t.scheduled_start, "end": t.scheduled_end} for t in anchored_today]
    planned += [
        {"task": task, "start": plan[task.id].start, "end": plan[task.id].end}
        for task in unscheduled_input
        if task.id in scheduled_ids
    ]
    # The auto-planner's placement is a live suggestion, not committed —
    # persist it so this task stays anchored to today (not re-rolled into
    # a different slot, or a different day entirely, next time it's seen).
    for task in unscheduled_input:
        if task.id in scheduled_ids:
            task.scheduled_start = plan[task.id].start
            task.scheduled_end = plan[task.id].end
            session.add(task)
    if scheduled_ids:
        session.commit()

    unscheduled = [task for task in unscheduled_input if task.id not in scheduled_ids] + stale

    # Tasks completed today stay visible (struck through) instead of
    # vanishing the instant they're checked off — otherwise the completion
    # animation has nothing left on screen to celebrate.
    completed_today = session.exec(
        select(Task).where(
            Task.status == ItemStatus.confirmed,
            Task.completed == True,  # noqa: E712
            Task.completed_at >= day_start,
            Task.completed_at < day_end,
        )
    ).all()
    for task in completed_today:
        if task.scheduled_start and task.scheduled_end:
            planned.append({"task": task, "start": task.scheduled_start, "end": task.scheduled_end})
        else:
            unscheduled.append(task)

    planned.sort(key=lambda p: p["start"])
    return {"events": events, "planned": planned, "unscheduled": unscheduled}


@router.get("")
def get_schedule(for_date: date_cls | None = None, session: Session = Depends(get_session)) -> dict:
    day = datetime.combine(for_date or date_cls.today(), datetime.min.time())
    return _day_schedule(session, day)


@router.get("/range")
def get_schedule_range(start: date_cls, end: date_cls, session: Session = Depends(get_session)) -> dict:
    """The same per-day breakdown as GET /api/schedule, for every day from
    `start` to `end` inclusive — what the Schedule page renders as a
    multi-day agenda instead of fetching one day at a time."""
    if end < start:
        raise HTTPException(400, "end must not be before start")
    if (end - start).days > 60:
        raise HTTPException(400, "range too large — ask for 60 days or fewer at a time")

    days = []
    cursor = start
    while cursor <= end:
        day_dt = datetime.combine(cursor, datetime.min.time())
        days.append({"date": cursor.isoformat(), **_day_schedule(session, day_dt)})
        cursor += timedelta(days=1)
    return {"days": days}
