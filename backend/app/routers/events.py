from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, CalendarSource, ItemStatus
from ..schemas import EventCreate, IcsImportRequest
from ..security import require_api_key
from ..services.ics_import import parse_ics

router = APIRouter(prefix="/api/events", tags=["events"], dependencies=[Depends(require_api_key)])


@router.get("", response_model=list[CalendarEvent])
def list_events(
    start: datetime,
    end: datetime,
    include_pending: bool = False,
    session: Session = Depends(get_session),
):
    query = select(CalendarEvent).where(CalendarEvent.start < end, CalendarEvent.end > start)
    if not include_pending:
        query = query.where(CalendarEvent.status == ItemStatus.confirmed)
    return session.exec(query.order_by(CalendarEvent.start)).all()


@router.get("/bounds")
def bounds(session: Session = Depends(get_session)) -> dict:
    """The earliest and latest confirmed event start times, so the
    frontend can offer an accurate "All time" range."""
    rows = session.exec(
        select(CalendarEvent.start).where(CalendarEvent.status == ItemStatus.confirmed)
    ).all()
    if not rows:
        return {"earliest": None, "latest": None}
    return {"earliest": min(rows).isoformat(), "latest": max(rows).isoformat()}


@router.post("", response_model=CalendarEvent)
def create_event(
    body: EventCreate,
    x_client_name: Optional[str] = Header(default=None),
    session: Session = Depends(get_session),
):
    is_external = x_client_name is not None
    event = CalendarEvent(
        **body.model_dump(),
        source=CalendarSource.api if is_external else CalendarSource.local,
        status=ItemStatus.pending if is_external else ItemStatus.confirmed,
        created_by=x_client_name,
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


@router.delete("/{event_id}")
def delete_event(event_id: int, session: Session = Depends(get_session)):
    event = session.get(CalendarEvent, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    session.delete(event)
    session.commit()
    return {"ok": True}


@router.post("/import-ics", response_model=list[CalendarEvent])
def import_ics(body: IcsImportRequest, session: Session = Depends(get_session)):
    """One-off import — no account/OAuth needed. Upserts on (source,
    external_id) so re-importing the same feed doesn't duplicate events."""
    parsed = parse_ics(body.ics_text)
    saved = []
    for event in parsed:
        existing = None
        if event.external_id:
            existing = session.exec(
                select(CalendarEvent).where(
                    CalendarEvent.external_id == event.external_id,
                    CalendarEvent.source == CalendarSource.ics,
                )
            ).first()
        if existing:
            existing.title, existing.start, existing.end = event.title, event.start, event.end
            existing.location, existing.notes = event.location, event.notes
            session.add(existing)
            saved.append(existing)
        else:
            session.add(event)
            saved.append(event)
    session.commit()
    for row in saved:
        session.refresh(row)
    return saved
