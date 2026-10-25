from dataclasses import dataclass
from datetime import datetime, timedelta

from ..models import CalendarEvent, Task


@dataclass
class TimeSlot:
    start: datetime
    end: datetime

    @property
    def duration(self) -> timedelta:
        return self.end - self.start


class SchedulerEngine:
    """Builds the day's schedule by fitting unscheduled tasks into the gaps
    left by calendar events, inside a configurable working window.

    Greedy and priority-first rather than a full constraint solver — it
    produces one reasonable plan instantly, which the AI suggestion engine
    can then propose tweaks to."""

    def __init__(self, day_start_hour: int = 8, day_end_hour: int = 20, buffer_minutes: int = 10):
        self.day_start_hour = day_start_hour
        self.day_end_hour = day_end_hour
        self.buffer_minutes = buffer_minutes

    def free_slots_for(self, day: datetime, busy_events: list[CalendarEvent]) -> list[TimeSlot]:
        window_start = day.replace(hour=self.day_start_hour, minute=0, second=0, microsecond=0)
        window_end = day.replace(hour=self.day_end_hour, minute=0, second=0, microsecond=0)

        busy = sorted(
            (
                TimeSlot(
                    max(e.start, window_start),
                    min(e.end, window_end),
                )
                for e in busy_events
                if e.start < window_end and e.end > window_start
            ),
            key=lambda s: s.start,
        )

        free: list[TimeSlot] = []
        cursor = window_start
        for slot in busy:
            if slot.start > cursor:
                free.append(TimeSlot(cursor, slot.start))
            if slot.end > cursor:
                cursor = slot.end
        if cursor < window_end:
            free.append(TimeSlot(cursor, window_end))
        return free

    def plan(
        self, day: datetime, tasks: list[Task], busy_events: list[CalendarEvent]
    ) -> dict[int, TimeSlot]:
        """Greedily assigns `tasks` (expected pre-sorted by priority/due
        date) into free slots for `day`. Returns {task.id: TimeSlot} for
        tasks that fit; tasks that don't fit anywhere today are omitted so
        the caller can carry them over."""
        slots = self.free_slots_for(day, busy_events)
        result: dict[int, TimeSlot] = {}

        for task in tasks:
            needed = timedelta(minutes=task.estimated_minutes)
            for i, slot in enumerate(slots):
                if slot.duration < needed:
                    continue

                task_start = slot.start
                task_end = task_start + needed
                result[task.id] = TimeSlot(task_start, task_end)

                remainder_start = task_end + timedelta(minutes=self.buffer_minutes)
                slots[i] = (
                    TimeSlot(remainder_start, slot.end)
                    if remainder_start < slot.end
                    else TimeSlot(slot.end, slot.end)
                )
                break
        return result
