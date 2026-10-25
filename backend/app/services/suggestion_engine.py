import json
from datetime import datetime, timedelta

from sqlmodel import Session

from ..models import (
    CalendarEvent,
    CalendarSource,
    Habit,
    HabitFrequency,
    ItemStatus,
    Task,
    TaskOrigin,
    TaskPriority,
)
from .ollama_client import OllamaClient

SYSTEM_PROMPT = """
You are a planning assistant embedded in a personal productivity app called
FlowSync. You will be given the user's tasks, calendar events, habits, and
budget status. Suggest at most 3 concrete, specific additions that would
help them — a task to add, a calendar event to add, or a new habit to
start. Do not suggest editing or deleting anything that already exists.

Respond with ONLY a JSON array, no prose, matching this shape:
[
  {"kind": "task", "summary": "one sentence shown to the user",
   "title": "...", "notes": "...", "estimated_minutes": 30,
   "priority": "low|medium|high"},
  {"kind": "event", "summary": "...", "title": "...",
   "start": "2025-01-01T09:00:00", "end": "2025-01-01T10:00:00"},
  {"kind": "habit", "summary": "...", "name": "...",
   "frequency": "daily|weekly"}
]
If you have no useful suggestion, respond with [].
"""


def _build_prompt(tasks: list[Task], events: list[CalendarEvent], habits: list[Habit], budget_lines: list[str]) -> str:
    lines = ["TASKS (unscheduled or overdue):"]
    lines += [f'- "{t.title}" ({t.estimated_minutes}min, priority={t.priority}, due={t.due_date})' for t in tasks] or ["- none"]

    lines.append("\nUPCOMING CALENDAR EVENTS:")
    lines += [f'- "{e.title}" {e.start}–{e.end}' for e in events] or ["- none"]

    lines.append("\nHABITS:")
    lines += [f'- "{h.name}" streak={h.current_streak} best={h.best_streak}' for h in habits] or ["- none"]

    lines.append("\nBUDGET THIS MONTH:")
    lines += budget_lines or ["- none tracked"]

    return "\n".join(lines)


def _extract_json_array(raw: str) -> str | None:
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end < start:
        return None
    return raw[start : end + 1]


class SuggestionEngine:
    def __init__(self, ollama: OllamaClient):
        self.ollama = ollama

    async def generate(
        self,
        session: Session,
        tasks: list[Task],
        events: list[CalendarEvent],
        habits: list[Habit],
        budget_lines: list[str],
    ) -> list[dict]:
        """Calls Ollama, parses its suggestions, and persists each as a
        pending Task/CalendarEvent/Habit (origin=ai). Returns a list of
        {"kind": ..., "summary": ..., "item": <created row dict>} for the
        caller to hand straight to the frontend's Pending inbox."""
        prompt = _build_prompt(tasks, events, habits, budget_lines)
        raw = await self.ollama.generate(prompt, system=SYSTEM_PROMPT)
        json_text = _extract_json_array(raw)
        if not json_text:
            return []

        try:
            parsed = json.loads(json_text)
        except json.JSONDecodeError:
            return []

        created = []
        for item in parsed:
            kind = item.get("kind")
            summary = item.get("summary", "")
            created_by = f"ollama:{self.ollama.model}"

            if kind == "task":
                row = Task(
                    title=item.get("title", summary),
                    notes=item.get("notes"),
                    estimated_minutes=item.get("estimated_minutes", 30),
                    priority=TaskPriority(item.get("priority", "medium")),
                    origin=TaskOrigin.ai,
                    status=ItemStatus.pending,
                    created_by=created_by,
                )
            elif kind == "event":
                try:
                    start = datetime.fromisoformat(item["start"])
                    end = datetime.fromisoformat(item.get("end", (start + timedelta(hours=1)).isoformat()))
                except (KeyError, ValueError):
                    continue
                row = CalendarEvent(
                    title=item.get("title", summary),
                    start=start,
                    end=end,
                    source=CalendarSource.ai,
                    status=ItemStatus.pending,
                    created_by=created_by,
                )
            elif kind == "habit":
                row = Habit(
                    name=item.get("name", summary),
                    frequency=HabitFrequency(item.get("frequency", "daily")),
                    origin=TaskOrigin.ai,
                    status=ItemStatus.pending,
                    created_by=created_by,
                )
            else:
                continue

            session.add(row)
            session.commit()
            session.refresh(row)
            created.append({"kind": kind, "summary": summary, "item": row.model_dump(mode="json")})

        return created
