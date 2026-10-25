from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, Habit, ItemStatus, Task
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
    return {
        "tasks": session.exec(select(Task).where(Task.status == ItemStatus.pending)).all(),
        "events": session.exec(select(CalendarEvent).where(CalendarEvent.status == ItemStatus.pending)).all(),
        "habits": session.exec(select(Habit).where(Habit.status == ItemStatus.pending)).all(),
    }


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
