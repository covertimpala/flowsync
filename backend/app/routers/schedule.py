from datetime import date as date_cls
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, ItemStatus, Task
from ..security import require_api_key
from ..services.scheduler import SchedulerEngine

router = APIRouter(prefix="/api/schedule", tags=["schedule"], dependencies=[Depends(require_api_key)])


@router.get("")
def get_schedule(for_date: date_cls | None = None, session: Session = Depends(get_session)) -> dict:
    day = datetime.combine(for_date or date_cls.today(), datetime.min.time())
    day_start, day_end = day, day + timedelta(days=1)

    events = session.exec(
        select(CalendarEvent).where(
            CalendarEvent.status == ItemStatus.confirmed,
            CalendarEvent.start < day_end,
            CalendarEvent.end > day_start,
        )
    ).all()
    tasks = session.exec(
        select(Task).where(Task.status == ItemStatus.confirmed, Task.completed == False)  # noqa: E712
    ).all()
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    tasks = sorted(tasks, key=lambda t: (priority_rank[t.priority], t.due_date or datetime.max))

    plan = SchedulerEngine().plan(day, tasks, events)
    scheduled_ids = set(plan.keys())

    return {
        "events": events,
        "planned": [
            {"task": task, "start": plan[task.id].start, "end": plan[task.id].end}
            for task in tasks
            if task.id in scheduled_ids
        ],
        "unscheduled": [task for task in tasks if task.id not in scheduled_ids],
    }
