from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import BudgetCategory, BudgetEntry, BudgetEntryType, CalendarEvent, Habit, ItemStatus, Task
from ..schemas import OllamaSettingsUpdate
from ..security import require_api_key
from ..services import settings_store
from ..services.ollama_client import OllamaClient, OllamaException
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
