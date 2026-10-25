"""Turns a free-text instruction ("move my dentist task to Friday and add
a $40 groceries expense") into a reviewable plan: a list of concrete
FlowSync actions, each shown to the user before anything actually
happens. See action_executor.py for what accepting one actually does.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlmodel import Session, select

from ..models import BudgetCategory, CalendarEvent, Habit, ItemStatus, PendingAction, Task
from .ollama_client import OllamaClient

ACTION_TYPES = {
    "create_task",
    "complete_task",
    "update_task",
    "delete_task",
    "create_event",
    "delete_event",
    "create_habit",
    "complete_habit",
    "create_budget_entry",
    "create_budget_category",
}

SYSTEM_PROMPT = """
You are the AI Assistant embedded in a personal productivity app called
FlowSync. The user will type a free-text instruction. Work out what
concrete actions FlowSync should take to fulfill it, using ONLY the
action types below. You are given the user's current tasks, events,
habits, and budget categories with their ids — reference an existing
item by its id exactly as given; never invent an id. The current date
and time is provided — resolve relative dates ("tomorrow", "Friday")
against it.

Action types and their payload shape:
- create_task: {"title": str, "due_date": "YYYY-MM-DDTHH:MM:SS" or null,
  "priority": "low"|"medium"|"high", "category_name": str or null,
  "recurrence": "none"|"daily"|"weekly"|"monthly"|"yearly"}
- complete_task: {"task_id": int}
- update_task: {"task_id": int, "title": str (optional),
  "due_date": "YYYY-MM-DDTHH:MM:SS" (optional),
  "priority": str (optional), "category_name": str (optional)}
- delete_task: {"task_id": int}
- create_event: {"title": str, "start": "YYYY-MM-DDTHH:MM:SS",
  "end": "YYYY-MM-DDTHH:MM:SS", "location": str or null}
- delete_event: {"event_id": int}
- create_habit: {"name": str, "frequency": "daily"|"weekly"}
- complete_habit: {"habit_id": int}
- create_budget_entry: {"category_name": str, "amount_cents": int,
  "type": "expense"|"income", "note": str or null}
- create_budget_category: {"name": str, "monthly_limit_cents": int or 0}

Respond with ONLY a JSON array, no prose, no markdown fences:
[{"action_type": "...", "description": "one short sentence shown to the
user describing exactly what this will do", "payload": {...}}]

If the instruction is unclear, impossible with these actions, or needs no
action, respond with [].
"""


@dataclass
class ProposedAction:
    action_type: str
    description: str
    payload: dict


def _build_context(session: Session) -> str:
    now = datetime.now()
    tasks = session.exec(
        select(Task).where(Task.status == ItemStatus.confirmed, Task.completed == False)  # noqa: E712
    ).all()
    events = session.exec(
        select(CalendarEvent).where(CalendarEvent.status == ItemStatus.confirmed)
    ).all()
    habits = session.exec(select(Habit).where(Habit.archived == False)).all()  # noqa: E712
    categories = session.exec(select(BudgetCategory)).all()

    lines = [f"Current date/time: {now.isoformat()}", ""]

    lines.append("TASKS (id: title, due):")
    lines += [f"- {t.id}: \"{t.title}\" due={t.due_date}" for t in tasks] or ["- none"]

    lines.append("\nEVENTS (id: title, start):")
    lines += [f"- {e.id}: \"{e.title}\" start={e.start}" for e in events[:50]] or ["- none"]

    lines.append("\nHABITS (id: name):")
    lines += [f"- {h.id}: \"{h.name}\"" for h in habits] or ["- none"]

    lines.append("\nBUDGET CATEGORIES (id: name):")
    lines += [f"- {c.id}: \"{c.name}\"" for c in categories] or ["- none"]

    return "\n".join(lines)


def _extract_json_array(raw: str) -> str | None:
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end < start:
        return None
    return raw[start : end + 1]


class CommandError(Exception):
    pass


async def build_plan(session: Session, ollama: OllamaClient, instruction: str) -> list[PendingAction]:
    context = _build_context(session)
    prompt = f"{context}\n\nINSTRUCTION: {instruction}"
    raw = await ollama.generate(prompt, system=SYSTEM_PROMPT)

    json_text = _extract_json_array(raw)
    if not json_text:
        raise CommandError("The model didn't return a usable plan — try rephrasing the instruction.")

    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError:
        raise CommandError("The model's response wasn't valid JSON — try rephrasing the instruction.")

    plan_id = str(uuid.uuid4())
    now = datetime.now()
    created: list[PendingAction] = []
    for item in parsed:
        action_type = item.get("action_type")
        if action_type not in ACTION_TYPES:
            continue
        action = PendingAction(
            plan_id=plan_id,
            action_type=action_type,
            description=item.get("description", action_type),
            payload_json=json.dumps(item.get("payload", {})),
            status=ItemStatus.pending,
            created_at=now,
        )
        session.add(action)
        created.append(action)
    session.commit()
    for action in created:
        session.refresh(action)
    return created
