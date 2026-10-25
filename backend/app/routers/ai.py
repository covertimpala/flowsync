from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import (
    BudgetCategory,
    BudgetEntry,
    BudgetEntryType,
    CalendarEvent,
    Habit,
    ItemStatus,
    PendingAction,
    RescheduleSuggestion,
    Task,
)
from ..schemas import OllamaSettingsUpdate
from ..security import require_api_key
from ..services import ai_command, settings_store
from ..services.action_executor import ActionError, execute as execute_action
from ..services.ollama_client import OllamaClient, OllamaException
from ..services.reschedule_engine import describe_opening, find_opening
from ..services.suggestion_engine import SuggestionEngine

router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(require_api_key)])


def _ollama_client(session: Session) -> OllamaClient:
    host = settings_store.get_setting(session, "ollama_host", "http://localhost:11434")
    model = settings_store.get_setting(session, "ollama_model", "qwen3.5:4b")
    return OllamaClient(host=host, model=model)


@router.get("/status")
async def status(session: Session = Depends(get_session)) -> dict:
    client = _ollama_client(session)
    return {"available": await client.is_available(), "host": client.host, "model": client.model}


@router.put("/settings")
def update_settings(body: OllamaSettingsUpdate, session: Session = Depends(get_session)):
    if body.host:
        settings_store.set_setting(session, "ollama_host", body.host)
    if body.model:
        settings_store.set_setting(session, "ollama_model", body.model)
    return {"ok": True}


@router.post("/suggest")
async def suggest(session: Session = Depends(get_session)) -> dict:
    client = _ollama_client(session)
    if not await client.is_available():
        raise HTTPException(503, f"Can't reach Ollama at {client.host} — is `ollama serve` running?")

    now = datetime.now()
    tasks = session.exec(
        select(Task).where(Task.status == ItemStatus.confirmed, Task.completed == False)  # noqa: E712
    ).all()
    events = session.exec(
        select(CalendarEvent).where(
            CalendarEvent.status == ItemStatus.confirmed,
            CalendarEvent.start < now + timedelta(days=7),
            CalendarEvent.end > now,
        )
    ).all()
    habits = session.exec(select(Habit).where(Habit.status == ItemStatus.confirmed, Habit.archived == False)).all()  # noqa: E712

    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    categories = session.exec(select(BudgetCategory)).all()
    entries = session.exec(select(BudgetEntry).where(BudgetEntry.date >= month_start)).all()
    budget_lines = []
    for cat in categories:
        spent = sum(e.amount_cents for e in entries if e.category_id == cat.id and e.type == BudgetEntryType.expense)
        limit_note = f"of limit {cat.monthly_limit_cents / 100}" if cat.monthly_limit_cents else "(no limit set)"
        budget_lines.append(f'- "{cat.name}": spent {spent / 100} {limit_note}')

    engine = SuggestionEngine(client)
    try:
        created = await engine.generate(session, tasks, events, habits, budget_lines)
    except OllamaException as e:
        raise HTTPException(502, str(e))
    return {"suggestions": created}


@router.post("/check-overdue")
def check_overdue(session: Session = Depends(get_session)) -> dict:
    """Pure scheduling heuristic, no Ollama needed — runs automatically
    whenever the Today page loads. For every overdue, not-yet-flagged task,
    finds the least-busy upcoming opening it would fit in and files a
    RescheduleSuggestion for the Pending inbox."""
    now = datetime.now()
    overdue = session.exec(
        select(Task).where(
            Task.status == ItemStatus.confirmed,
            Task.completed == False,  # noqa: E712
            Task.due_date != None,  # noqa: E711
            Task.due_date < now,
        )
    ).all()

    created = []
    for task in overdue:
        # Already has a plan for a time that hasn't happened yet — being
        # overdue by due_date doesn't mean it needs another suggestion if
        # accepting the last one already gave it a future slot.
        if task.scheduled_start and task.scheduled_start >= now:
            continue

        already_flagged = session.exec(
            select(RescheduleSuggestion).where(
                RescheduleSuggestion.task_id == task.id,
                RescheduleSuggestion.status == ItemStatus.pending,
            )
        ).first()
        if already_flagged:
            continue

        opening = find_opening(session, task)
        if opening is None:
            continue

        suggestion = RescheduleSuggestion(
            task_id=task.id,
            suggested_start=opening.slot.start,
            suggested_end=opening.slot.end,
            reason=describe_opening(task, opening),
            created_at=now,
        )
        session.add(suggestion)
        session.commit()
        session.refresh(suggestion)
        created.append(suggestion)

    return {"created": len(created)}


class CommandRequest(BaseModel):
    text: str


@router.post("/command")
async def submit_command(body: CommandRequest, session: Session = Depends(get_session)) -> dict:
    """The AI Assistant: turns a free-text instruction into a reviewable
    plan of actions (PendingAction rows). Nothing executes yet — see
    POST .../command/{plan_id}/accept."""
    client = _ollama_client(session)
    if not await client.is_available():
        raise HTTPException(503, f"Can't reach Ollama at {client.host} — is `ollama serve` running?")

    try:
        actions = await ai_command.build_plan(session, client, body.text)
    except ai_command.CommandError as e:
        raise HTTPException(422, str(e))

    plan_id = actions[0].plan_id if actions else None
    return {"plan_id": plan_id, "actions": actions}


@router.get("/command/{plan_id}")
def get_plan(plan_id: str, session: Session = Depends(get_session)) -> dict:
    actions = session.exec(select(PendingAction).where(PendingAction.plan_id == plan_id)).all()
    return {"plan_id": plan_id, "actions": actions}


@router.delete("/command/action/{action_id}")
def remove_action(action_id: int, session: Session = Depends(get_session)) -> dict:
    """Drops one action from a plan before it's accepted — lets the user
    trim a plan down instead of accepting or denying it all-or-nothing."""
    action = session.get(PendingAction, action_id)
    if action and action.status == ItemStatus.pending:
        session.delete(action)
        session.commit()
    return {"ok": True}


@router.post("/command/{plan_id}/accept")
def accept_plan(plan_id: str, session: Session = Depends(get_session)) -> dict:
    actions = session.exec(
        select(PendingAction).where(PendingAction.plan_id == plan_id, PendingAction.status == ItemStatus.pending)
    ).all()
    if not actions:
        raise HTTPException(404, "Plan not found or already resolved")

    results = []
    for action in actions:
        try:
            result = execute_action(session, action)
            results.append({"action_id": action.id, "ok": True, "result": result})
        except ActionError as e:
            results.append({"action_id": action.id, "ok": False, "error": str(e)})
    return {"results": results}


@router.post("/command/{plan_id}/deny")
def deny_plan(plan_id: str, session: Session = Depends(get_session)) -> dict:
    actions = session.exec(
        select(PendingAction).where(PendingAction.plan_id == plan_id, PendingAction.status == ItemStatus.pending)
    ).all()
    for action in actions:
        session.delete(action)
    session.commit()
    return {"ok": True}
