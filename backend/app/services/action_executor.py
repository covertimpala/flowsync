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
    RecurrenceRule,
    Reward,
    Task,
    TaskCategory,
    TaskPriority,
)
from .habit_rewards import available_points
from .recurrence import next_occurrence


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


# ---------------------------------------------------------------------------
# Staged edits/deletes of EXISTING items — api_guard.stage_or_run routes an
# external application's PATCH/DELETE here instead of applying it directly.
# Distinct "api_*" payload shapes (an arbitrary `updates` dict matching the
# router's own Update schema) from the AI-chat handlers above, which take
# specific named fields the model reasons about directly.
# ---------------------------------------------------------------------------

_TASK_DATE_FIELDS = {"due_date", "scheduled_start", "scheduled_end", "completed_at"}


def _api_update_task(session: Session, p: dict) -> dict:
    task = session.get(Task, p["task_id"])
    if not task:
        raise ActionError(f"Task {p['task_id']} no longer exists")
    updates = dict(p["updates"])
    for key in _TASK_DATE_FIELDS:
        if key in updates and updates[key] is not None:
            updates[key] = _parse_dt(updates[key])
    if updates.get("priority"):
        updates["priority"] = TaskPriority(updates["priority"])
    if updates.get("recurrence"):
        updates["recurrence"] = RecurrenceRule(updates["recurrence"])
    just_completed = updates.get("completed") is True and not task.completed
    if "completed" in updates:
        updates["completed_at"] = datetime.now() if updates["completed"] else None
    for key, value in updates.items():
        setattr(task, key, value)
    session.add(task)
    if just_completed and task.recurrence != RecurrenceRule.none:
        next_due = next_occurrence(task.due_date or datetime.now(), task.recurrence)
        session.add(Task(
            title=task.title,
            notes=task.notes,
            due_date=next_due,
            estimated_minutes=task.estimated_minutes,
            priority=task.priority,
            category_id=task.category_id,
            recurrence=task.recurrence,
            origin=task.origin,
        ))
    session.commit()
    return {"task_id": task.id}


def _api_redeem_reward(session: Session, p: dict) -> dict:
    reward = session.get(Reward, p["reward_id"])
    if not reward:
        raise ActionError(f"Reward {p['reward_id']} no longer exists")
    if reward.redeemed:
        raise ActionError("That reward was already redeemed")
    points = available_points(session)
    if points < reward.point_cost:
        raise ActionError(f"Need {reward.point_cost - points} more points to redeem this")
    reward.redeemed = True
    session.add(reward)
    session.commit()
    return {"reward_id": reward.id}


def _api_update_budget_entry(session: Session, p: dict) -> dict:
    entry = session.get(BudgetEntry, p["entry_id"])
    if not entry:
        raise ActionError(f"Budget entry {p['entry_id']} no longer exists")
    updates = dict(p["updates"])
    if updates.get("date"):
        updates["date"] = _parse_dt(updates["date"])
    if updates.get("type"):
        updates["type"] = BudgetEntryType(updates["type"])
    for key, value in updates.items():
        setattr(entry, key, value)
    session.add(entry)
    session.commit()
    return {"entry_id": entry.id}


def _api_delete_budget_entry(session: Session, p: dict) -> dict:
    entry = session.get(BudgetEntry, p["entry_id"])
    if entry:
        session.delete(entry)
        session.commit()
    return {"entry_id": p["entry_id"]}


def _api_update_budget_category(session: Session, p: dict) -> dict:
    category = session.get(BudgetCategory, p["category_id"])
    if not category:
        raise ActionError(f"Budget category {p['category_id']} no longer exists")
    for key, value in p["updates"].items():
        setattr(category, key, value)
    session.add(category)
    session.commit()
    return {"category_id": category.id}


def _api_delete_budget_category(session: Session, p: dict) -> dict:
    category = session.get(BudgetCategory, p["category_id"])
    if not category:
        return {"category_id": p["category_id"]}
    in_use = session.exec(select(BudgetEntry).where(BudgetEntry.category_id == category.id).limit(1)).first()
    if in_use:
        raise ActionError(
            "This category still has entries filed under it — hide it instead, "
            "or delete those entries first."
        )
    session.delete(category)
    session.commit()
    return {"category_id": category.id}


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
    "api_update_task": _api_update_task,
    "api_redeem_reward": _api_redeem_reward,
    "api_update_budget_entry": _api_update_budget_entry,
    "api_delete_budget_entry": _api_delete_budget_entry,
    "api_update_budget_category": _api_update_budget_category,
    "api_delete_budget_category": _api_delete_budget_category,
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
