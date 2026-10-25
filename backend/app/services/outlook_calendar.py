from datetime import datetime, timedelta

import httpx
from sqlmodel import Session

from ..models import CalendarEvent, CalendarSource
from .oauth_device_flow import DeviceFlowConfig, OAuthDeviceFlow, OAuthException

OUTLOOK_PROVIDER = "outlook"


def make_outlook_flow(client_id: str) -> OAuthDeviceFlow:
    return OAuthDeviceFlow(
        DeviceFlowConfig(
            device_code_url="https://login.microsoftonline.com/common/oauth2/v2.0/devicecode",
            token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
            client_id=client_id,
            scope="offline_access Calendars.ReadWrite",
        ),
        provider=OUTLOOK_PROVIDER,
    )


async def fetch_events(flow: OAuthDeviceFlow, session: Session) -> list[CalendarEvent]:
    token = await flow.valid_access_token(session)
    if token is None:
        return []

    now = datetime.now()
    params = {
        "startDateTime": (now - timedelta(days=7)).isoformat(),
        "endDateTime": (now + timedelta(days=60)).isoformat(),
        "$top": "250",
    }
    async with httpx.AsyncClient() as client:
        res = await client.get(
            "https://graph.microsoft.com/v1.0/me/calendarview",
            params=params,
            headers={"Authorization": f"Bearer {token}", "Prefer": 'outlook.timezone="UTC"'},
        )
    if res.status_code != 200:
        raise OAuthException(f"Outlook Calendar fetch failed: {res.text}")

    events = []
    for item in res.json().get("value", []):
        location = item.get("location") or {}
        events.append(
            CalendarEvent(
                title=item.get("subject", "Untitled event"),
                start=datetime.fromisoformat(item["start"]["dateTime"]),
                end=datetime.fromisoformat(item["end"]["dateTime"]),
                all_day=item.get("isAllDay", False),
                location=location.get("displayName"),
                notes=item.get("bodyPreview"),
                source=CalendarSource.outlook,
                external_id=item.get("id"),
            )
        )
    return events


async def push_event(flow: OAuthDeviceFlow, session: Session, event: CalendarEvent) -> str | None:
    token = await flow.valid_access_token(session)
    if token is None:
        return None

    body = {
        "subject": event.title,
        "start": {"dateTime": event.start.isoformat(), "timeZone": "UTC"},
        "end": {"dateTime": event.end.isoformat(), "timeZone": "UTC"},
    }
    if event.location:
        body["location"] = {"displayName": event.location}
    if event.notes:
        body["body"] = {"contentType": "text", "content": event.notes}

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://graph.microsoft.com/v1.0/me/events",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
        )
    if res.status_code not in (200, 201):
        raise OAuthException(f"Failed to push event to Outlook: {res.text}")
    return res.json().get("id")
