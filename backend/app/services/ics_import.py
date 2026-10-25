from datetime import datetime, time

from icalendar import Calendar

from ..models import CalendarEvent, CalendarSource


def parse_ics(raw_text: str) -> list[CalendarEvent]:
    cal = Calendar.from_ical(raw_text)
    events = []

    for component in cal.walk("VEVENT"):
        dtstart = component.get("dtstart")
        dtend = component.get("dtend")
        if dtstart is None:
            continue

        start = dtstart.dt
        all_day = not isinstance(start, datetime)
        if all_day:
            start = datetime.combine(start, time.min)

        if dtend is not None:
            end = dtend.dt
            if not isinstance(end, datetime):
                end = datetime.combine(end, time.min)
        else:
            end = start

        events.append(
            CalendarEvent(
                title=str(component.get("summary", "Untitled event")),
                start=start,
                end=end,
                all_day=all_day,
                location=str(component.get("location")) if component.get("location") else None,
                notes=str(component.get("description")) if component.get("description") else None,
                source=CalendarSource.ics,
                external_id=str(component.get("uid")) if component.get("uid") else None,
            )
        )
    return events
