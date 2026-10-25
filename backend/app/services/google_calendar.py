from datetime import datetime, timedelta

import httpx
from sqlmodel import Session

from ..models import CalendarEvent, CalendarSource
from .oauth_device_flow import DeviceFlowConfig, OAuthDeviceFlow, OAuthException

GOOGLE_PROVIDER = "google"


def make_google_flow(client_id: str) -> OAuthDeviceFlow:
    return OAuthDeviceFlow(
        DeviceFlowConfig(
            device_code_url="https://oauth2.googleapis.com/device/code",
            token_url="https://oauth2.googleapis.com/token",
            client_id=client_id,
            scope="https://www.googleapis.com/auth/calendar",
        ),
        provider=GOOGLE_PROVIDER,
    )


async def fetch_events(flow: OAuthDeviceFlow, session: Session) -> list[CalendarEvent]:
    token = await flow.valid_access_token(session)
    if token is None:
        return []

    now = datetime.now()
    params = {
        "timeMin": (now - timedelta(days=7)).isoformat() + "Z",
        "timeMax": (now + timedelta(days=60)).isoformat() + "Z",
        "singleEvents": "true",
        "maxResults": "250",
    }
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
    if res.status_code != 200:
        raise OAuthException(f"Google Calendar fetch failed: {res.text}")

    events = []
    for item in res.json().get("items", []):
        start_raw = item["start"]
        end_raw = item["end"]
        all_day = "date" in start_raw
        events.append(
            CalendarEvent(
                title=item.get("summary", "Untitled event"),
                start=datetime.fromisoformat(start_raw.get("dateTime", start_raw.get("date"))),
                end=datetime.fromisoformat(end_raw.get("dateTime", end_raw.get("date"))),
                all_day=all_day,
                location=item.get("location"),
                notes=item.get("description"),
                source=CalendarSource.google,
                external_id=item.get("id"),
            )
        )
    return events


async def push_event(flow: OAuthDeviceFlow, session: Session, event: CalendarEvent) -> str | None:
    """Creates `event` on the user's real Google Calendar. Returns the
    created event's Google id (stored as `external_id`), or None if not
    connected."""
    token = await flow.valid_access_token(session)
    if token is None:
        return None

    body = {
        "summary": event.title,
        "start": {"dateTime": event.start.isoformat()},
        "end": {"dateTime": event.end.isoformat()},
    }
    if event.location:
        body["location"] = event.location
    if event.notes:
        body["description"] = event.notes

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
    if res.status_code not in (200, 201):
        raise OAuthException(f"Failed to push event to Google Calendar: {res.text}")
    return res.json().get("id")
