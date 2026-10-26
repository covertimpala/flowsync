from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, Habit, ItemStatus, PendingAction, RescheduleSuggestion, Task
from ..schemas import AcceptRequest
from ..security import require_api_key
from ..services import google_calendar, outlook_calendar, settings_store
from ..services.oauth_device_flow import OAuthException

router = APIRouter(prefix="/api/pending", tags=["pending"], dependencies=[Depends(require_api_key)])

_MODEL_BY_KIND = {"task": Task, "event": CalendarEvent, "habit": Habit}


@router.get("")
def list_pending(session: Session = Depends(get_session)) -> dict:
    """Everything created by the AI suggestion engine or an external
    application, still awaiting a person's accept/deny. This is the single
    inbox the frontend's "Pending" panel renders."""
    reschedules = session.exec(
        select(RescheduleSuggestion)
        .where(RescheduleSuggestion.status == ItemStatus.pending)
        .order_by(RescheduleSuggestion.id)
    ).all()

    # Self-healing de-dupe: two near-simultaneous /ai/check-overdue calls
    # (e.g. React StrictMode double-invoking an effect in dev) can each
    # pass the "does one already exist" check before either commits,
    # producing two suggestions for the same task. Keep only the latest.
    latest_by_task: dict[int, RescheduleSuggestion] = {}
    for r in reschedules:
        stale = latest_by_task.get(r.task_id)
        if stale is not None:
            session.delete(stale)
        latest_by_task[r.task_id] = r
    if len(latest_by_task) != len(reschedules):
        session.commit()
    reschedules = list(latest_by_task.values())

    reschedule_payload = []
    for r in reschedules:
        task = session.get(Task, r.task_id)
        if task is None:  # task was deleted after the suggestion was made
            session.delete(r)
            session.commit()
            continue
        reschedule_payload.append({
            "id": r.id,
            "task_id": r.task_id,
            "task_title": task.title,
            "suggested_start": r.suggested_start,
            "suggested_end": r.suggested_end,
            "reason": r.reason,
        })

    # Edits/deletes an external application made to something that already
    # exists — staged by services/api_guard.py instead of applied directly.
    # Distinguished from an AI Assistant chat plan (also a PendingAction,
    # reviewed on the Assistant page instead) by having a created_by.
    staged_actions = session.exec(
        select(PendingAction)
        .where(PendingAction.status == ItemStatus.pending, PendingAction.created_by != None)  # noqa: E711
        .order_by(PendingAction.id)
    ).all()

    return {
        "tasks": session.exec(select(Task).where(Task.status == ItemStatus.pending)).all(),
        "events": session.exec(select(CalendarEvent).where(CalendarEvent.status == ItemStatus.pending)).all(),
        "habits": session.exec(select(Habit).where(Habit.status == ItemStatus.pending)).all(),
        "reschedules": reschedule_payload,
        "actions": staged_actions,
    }


@router.post("/reschedule/{suggestion_id}/accept")
def accept_reschedule(suggestion_id: int, session: Session = Depends(get_session)) -> dict:
    suggestion = session.get(RescheduleSuggestion, suggestion_id)
    if not suggestion or suggestion.status != ItemStatus.pending:
        raise HTTPException(404, "Pending reschedule not found")
    task = session.get(Task, suggestion.task_id)
    if not task:
        raise HTTPException(404, "The task this reschedule was for no longer exists")

    task.scheduled_start = suggestion.suggested_start
    task.scheduled_end = suggestion.suggested_end
    task.was_rescheduled = True
    session.add(task)
    session.delete(suggestion)
    session.commit()
    session.refresh(task)
    return {"task": task}


@router.post("/reschedule/{suggestion_id}/deny")
def deny_reschedule(suggestion_id: int, session: Session = Depends(get_session)) -> dict:
    suggestion = session.get(RescheduleSuggestion, suggestion_id)
    if not suggestion or suggestion.status != ItemStatus.pending:
        raise HTTPException(404, "Pending reschedule not found")
    session.delete(suggestion)
    session.commit()
    return {"ok": True}


@router.post("/{kind}/{item_id}/accept")
async def accept_pending(kind: str, item_id: int, body: AcceptRequest, session: Session = Depends(get_session)):
    model = _MODEL_BY_KIND.get(kind)
    if model is None:
        raise HTTPException(400, "kind must be one of: task, event, habit")

    item = session.get(model, item_id)
    if not item or item.status != ItemStatus.pending:
        raise HTTPException(404, "Pending item not found")

    item.status = ItemStatus.confirmed
    session.add(item)
    session.commit()
    session.refresh(item)

    pushed_to = None
    if kind == "event" and body.push_to_calendar and body.calendar_provider:
        try:
            if body.calendar_provider == "google":
                client_id = settings_store.get_setting(session, "google_client_id")
                if client_id:
                    flow = google_calendar.make_google_flow(client_id)
                    external_id = await google_calendar.push_event(flow, session, item)
                    if external_id:
                        item.external_id = external_id
                        session.add(item)
                        session.commit()
                        pushed_to = "google"
            elif body.calendar_provider == "outlook":
                client_id = settings_store.get_setting(session, "outlook_client_id")
                if client_id:
                    flow = outlook_calendar.make_outlook_flow(client_id)
                    external_id = await outlook_calendar.push_event(flow, session, item)
                    if external_id:
                        item.external_id = external_id
                        session.add(item)
                        session.commit()
                        pushed_to = "outlook"
        except OAuthException as e:
            raise HTTPException(502, str(e))

    session.refresh(item)
    return {"item": item, "pushed_to_calendar": pushed_to}


@router.post("/{kind}/{item_id}/deny")
def deny_pending(kind: str, item_id: int, session: Session = Depends(get_session)):
    model = _MODEL_BY_KIND.get(kind)
    if model is None:
        raise HTTPException(400, "kind must be one of: task, event, habit")

    item = session.get(model, item_id)
    if not item or item.status != ItemStatus.pending:
        raise HTTPException(404, "Pending item not found")

    session.delete(item)
    session.commit()
    return {"ok": True}
