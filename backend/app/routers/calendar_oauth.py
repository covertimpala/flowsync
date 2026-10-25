from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..db import get_session
from ..models import CalendarEvent, CalendarSource
from ..schemas import OAuthClientIdRequest
from ..security import require_api_key
from ..services import google_calendar, outlook_calendar, settings_store
from ..services.oauth_device_flow import DeviceCodeInfo, OAuthException

router = APIRouter(prefix="/api/calendar", tags=["calendar-oauth"], dependencies=[Depends(require_api_key)])

_PROVIDERS = {
    "google": (google_calendar.make_google_flow, google_calendar.fetch_events, "google_client_id"),
    "outlook": (outlook_calendar.make_outlook_flow, outlook_calendar.fetch_events, "outlook_client_id"),
}


def _flow_for(provider: str, session: Session):
    if provider not in _PROVIDERS:
        raise HTTPException(400, "provider must be 'google' or 'outlook'")
    make_flow, fetch_events, setting_key = _PROVIDERS[provider]
    client_id = settings_store.get_setting(session, setting_key)
    if not client_id:
        raise HTTPException(400, f"Set a client id for {provider} first (PUT /api/calendar/{provider}/client-id)")
    return make_flow(client_id), fetch_events


@router.put("/{provider}/client-id")
def set_client_id(provider: str, body: OAuthClientIdRequest, session: Session = Depends(get_session)):
    if provider not in _PROVIDERS:
        raise HTTPException(400, "provider must be 'google' or 'outlook'")
    settings_store.set_setting(session, _PROVIDERS[provider][2], body.client_id)
    return {"ok": True}


@router.get("/{provider}/status")
def connection_status(provider: str, session: Session = Depends(get_session)) -> dict:
    if provider not in _PROVIDERS:
        raise HTTPException(400, "provider must be 'google' or 'outlook'")
    client_id = settings_store.get_setting(session, _PROVIDERS[provider][2])
    if not client_id:
        return {"has_client_id": False, "connected": False}
    make_flow, _, _ = _PROVIDERS[provider]
    flow = make_flow(client_id)
    return {"has_client_id": True, "connected": flow.is_connected(session)}


@router.post("/{provider}/connect/start", response_model=DeviceCodeInfo)
async def connect_start(provider: str, session: Session = Depends(get_session)):
    flow, _ = _flow_for(provider, session)
    try:
        return await flow.request_code()
    except OAuthException as e:
        raise HTTPException(502, str(e))


@router.post("/{provider}/connect/finish")
async def connect_finish(provider: str, code: DeviceCodeInfo, session: Session = Depends(get_session)):
    flow, _ = _flow_for(provider, session)
    try:
        await flow.poll_for_tokens(session, code)
    except OAuthException as e:
        raise HTTPException(502, str(e))
    return {"ok": True}


@router.post("/{provider}/disconnect")
def disconnect(provider: str, session: Session = Depends(get_session)):
    flow, _ = _flow_for(provider, session)
    flow.disconnect(session)
    return {"ok": True}


@router.post("/sync")
async def sync_all(session: Session = Depends(get_session)) -> dict:
    """Pulls fresh events from every connected provider and upserts them
    (matched on source + external_id) into the local database."""
    results: dict[str, int] = {}

    for provider, (make_flow, fetch_events, setting_key) in _PROVIDERS.items():
        client_id = settings_store.get_setting(session, setting_key)
        if not client_id:
            continue
        flow = make_flow(client_id)
        if not flow.is_connected(session):
            continue

        try:
            events = await fetch_events(flow, session)
        except OAuthException as e:
            raise HTTPException(502, f"{provider}: {e}")

        for event in events:
            existing = session.exec(
                select(CalendarEvent).where(
                    CalendarEvent.external_id == event.external_id,
                    CalendarEvent.source == event.source,
                )
            ).first() if event.external_id else None

            if existing:
                existing.title, existing.start, existing.end = event.title, event.start, event.end
                existing.location, existing.notes, existing.all_day = event.location, event.notes, event.all_day
                session.add(existing)
            else:
                session.add(event)
        session.commit()
        results[provider] = len(events)

    return {"synced": results}
