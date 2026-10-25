"""Executes one AI Assistant action once a person has accepted it. Each
action_type here matches exactly one entry in ai_command.ACTION_SCHEMA —
keep the two in sync if you add a new one.

Every handler takes (session, payload) and returns a small JSON-safe dict
describing what happened, for the Assistant page's result feed.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Callable

from sqlmodel import Session, select

from ..models import (
    BudgetCategory,
    BudgetEntry,
    BudgetEntryType,
    CalendarEvent,
    Habit,
    HabitLog,
    ItemStatus,
    PendingAction,
    Task,
    TaskCategory,
    TaskPriority,
)


class ActionError(Exception):
    pass


def _get_or_create_task_category(session: Session, name: str | None) -> int | None:
    if not name:
        return None
    existing = session.exec(select(TaskCategory).where(TaskCategory.name == name)).first()
    if existing:
        return existing.id
    category = TaskCategory(name=name)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category.id


def _get_or_create_budget_category(session: Session, name: str) -> int:
    existing = session.exec(select(BudgetCategory).where(BudgetCategory.name == name)).first()
    if existing:
        return existing.id
    category = BudgetCategory(name=name)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category.id


def _parse_dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _create_task(session: Session, p: dict) -> dict:
    task = Task(
        title=p["title"],
        due_date=_parse_dt(p.get("due_date")),
        priority=TaskPriority(p.get("priority", "medium")),
        category_id=_get_or_create_task_category(session, p.get("category_name")),
        recurrence=p.get("recurrence", "none"),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    return {"task_id": task.id}


def _complete_task(session: Session, p: dict) -> dict:
    task = session.get(Task, p["task_id"])
    if not task:
        raise ActionError(f"Task {p['task_id']} no longer exists")
    task.completed = True
    task.completed_at = datetime.now()
    session.add(task)
    session.commit()
    return {"task_id": task.id}


def _update_task(session: Session, p: dict) -> dict:
    task = session.get(Task, p["task_id"])
    if not task:
        raise ActionError(f"Task {p['task_id']} no longer exists")
    if "title" in p and p["title"]:
        task.title = p["title"]
    if "due_date" in p:
        task.due_date = _parse_dt(p["due_date"])
    if "priority" in p and p["priority"]:
        task.priority = TaskPriority(p["priority"])
    if "category_name" in p and p["category_name"]:
        task.category_id = _get_or_create_task_category(session, p["category_name"])
    session.add(task)
    session.commit()
    return {"task_id": task.id}


def _delete_task(session: Session, p: dict) -> dict:
    task = session.get(Task, p["task_id"])
    if task:
        session.delete(task)
        session.commit()
    return {"task_id": p["task_id"]}


def _create_event(session: Session, p: dict) -> dict:
    event = CalendarEvent(
        title=p["title"],
        start=_parse_dt(p["start"]),
        end=_parse_dt(p["end"]),
        location=p.get("location"),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return {"event_id": event.id}


def _delete_event(session: Session, p: dict) -> dict:
    event = session.get(CalendarEvent, p["event_id"])
    if event:
        session.delete(event)
        session.commit()
    return {"event_id": p["event_id"]}


def _create_habit(session: Session, p: dict) -> dict:
    habit = Habit(name=p["name"], frequency=p.get("frequency", "daily"))
    session.add(habit)
    session.commit()
    session.refresh(habit)
    return {"habit_id": habit.id}


def _complete_habit(session: Session, p: dict) -> dict:
    habit = session.get(Habit, p["habit_id"])
    if not habit:
        raise ActionError(f"Habit {p['habit_id']} no longer exists")
    from .habit_rewards import mark_completed  # local import avoids a cycle at module load

    now = datetime.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    already_today = session.exec(
        select(HabitLog).where(HabitLog.habit_id == habit.id, HabitLog.completed_on >= today_start)
    ).first()
    if already_today:
        return {"habit_id": habit.id, "already_done_today": True}

    last_log = session.exec(
        select(HabitLog).where(HabitLog.habit_id == habit.id).order_by(HabitLog.completed_on.desc())
    ).first()
    session.add(HabitLog(habit_id=habit.id, completed_on=now))
    mark_completed(habit, now, last_log.completed_on if last_log else None)
    session.add(habit)
    session.commit()
    return {"habit_id": habit.id}


def _create_budget_entry(session: Session, p: dict) -> dict:
    category_id = p.get("category_id") or _get_or_create_budget_category(session, p["category_name"])
    entry = BudgetEntry(
        category_id=category_id,
        amount_cents=int(p["amount_cents"]),
        type=BudgetEntryType(p.get("type", "expense")),
        date=_parse_dt(p.get("date")) or datetime.now(),
        note=p.get("note"),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {"entry_id": entry.id}


def _create_budget_category(session: Session, p: dict) -> dict:
    category_id = _get_or_create_budget_category(session, p["name"])
    category = session.get(BudgetCategory, category_id)
    if p.get("monthly_limit_cents"):
        category.monthly_limit_cents = int(p["monthly_limit_cents"])
        session.add(category)
        session.commit()
    return {"category_id": category_id}


_HANDLERS: dict[str, Callable[[Session, dict], dict]] = {
    "create_task": _create_task,
    "complete_task": _complete_task,
    "update_task": _update_task,
    "delete_task": _delete_task,
    "create_event": _create_event,
    "delete_event": _delete_event,
    "create_habit": _create_habit,
    "complete_habit": _complete_habit,
    "create_budget_entry": _create_budget_entry,
    "create_budget_category": _create_budget_category,
}


def execute(session: Session, action: PendingAction) -> dict:
    handler = _HANDLERS.get(action.action_type)
    if handler is None:
        raise ActionError(f"Unknown action type: {action.action_type}")
    payload = json.loads(action.payload_json)
    result = handler(session, payload)
    action.status = ItemStatus.confirmed
    session.add(action)
    session.commit()
    return result
