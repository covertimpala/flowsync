from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import NaiveDatetime
from sqlmodel import Field, SQLModel

# FlowSync stores every timestamp as naive local time (no timezone) — there's
# a single user on a single machine, so there's never a cross-timezone
# comparison to get wrong. Newer SQLModel/pydantic requires opting into that
# explicitly via NaiveDatetime instead of the bare `datetime` type.


class ItemStatus(str, Enum):
    """`confirmed` items are real and show up everywhere; `pending` items
    were created by the AI suggestion engine or by an external application
    calling the API, and sit in the Pending inbox until a person accepts or
    denies them. Anything created directly in the web UI is `confirmed`
    immediately."""

    confirmed = "confirmed"
    pending = "pending"


class TaskOrigin(str, Enum):
    local = "local"
    ai = "ai"
    api = "api"


class CalendarSource(str, Enum):
    local = "local"
    ai = "ai"
    api = "api"
    google = "google"
    outlook = "outlook"
    ics = "ics"


class TaskPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


class CalendarEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    start: NaiveDatetime
    end: NaiveDatetime
    all_day: bool = False
    location: Optional[str] = None
    notes: Optional[str] = None
    source: CalendarSource = CalendarSource.local
    external_id: Optional[str] = Field(default=None, index=True)

    status: ItemStatus = ItemStatus.confirmed
    # If true, accepting a pending event also creates it on the connected
    # Google/Outlook calendar (set at accept time, not creation time) —
    # see routers/pending.py.
    push_to_calendar_on_accept: bool = False
    created_by: Optional[str] = None  # free-text: "ollama", or the caller's API client name


# ---------------------------------------------------------------------------
# Schedule / todos
# ---------------------------------------------------------------------------


class TaskCategory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    # Hex color for the category's badge/chip in the UI, e.g. "#6c8dfa".
    color: str = "#6c8dfa"


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    notes: Optional[str] = None
    due_date: Optional[NaiveDatetime] = None
    estimated_minutes: int = 30
    priority: TaskPriority = TaskPriority.medium
    completed: bool = False
    completed_at: Optional[NaiveDatetime] = None
    scheduled_start: Optional[NaiveDatetime] = None
    scheduled_end: Optional[NaiveDatetime] = None
    category_id: Optional[int] = Field(default=None, foreign_key="taskcategory.id")

    origin: TaskOrigin = TaskOrigin.local
    status: ItemStatus = ItemStatus.confirmed
    created_by: Optional[str] = None


# ---------------------------------------------------------------------------
# AI-proposed reschedules for overdue tasks
# ---------------------------------------------------------------------------


class RescheduleSuggestion(SQLModel, table=True):
    """A proposal to move `task_id` into a free slot on `suggested_start`–
    `suggested_end`, generated when the task is found overdue (see
    services/reschedule_engine.py). Lives in the Pending inbox like
    AI-created tasks/events/habits, but accepting it updates the existing
    task instead of creating a new row."""

    id: Optional[int] = Field(default=None, primary_key=True)
    task_id: int = Field(foreign_key="task.id")
    suggested_start: NaiveDatetime
    suggested_end: NaiveDatetime
    reason: str
    status: ItemStatus = ItemStatus.pending
    created_at: NaiveDatetime


# ---------------------------------------------------------------------------
# Habits & rewards
# ---------------------------------------------------------------------------


class HabitFrequency(str, Enum):
    daily = "daily"
    weekly = "weekly"
    custom = "custom"


class Habit(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    icon: Optional[str] = None
    frequency: HabitFrequency = HabitFrequency.daily
    custom_days: str = ""  # comma-separated ISO weekdays, e.g. "1,3,5"
    points_per_completion: int = 10
    current_streak: int = 0
    best_streak: int = 0
    archived: bool = False

    origin: TaskOrigin = TaskOrigin.local
    status: ItemStatus = ItemStatus.confirmed
    created_by: Optional[str] = None


class HabitLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    habit_id: int = Field(foreign_key="habit.id")
    completed_on: NaiveDatetime


class Reward(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    point_cost: int
    redeemed: bool = False


# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


class BudgetCategory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    monthly_limit_cents: int = 0


class BudgetEntryType(str, Enum):
    expense = "expense"
    income = "income"


class BudgetEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    category_id: int = Field(foreign_key="budgetcategory.id")
    amount_cents: int
    type: BudgetEntryType
    date: NaiveDatetime
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# OAuth tokens (Google / Outlook) — one row per provider
# ---------------------------------------------------------------------------


class OAuthAccount(SQLModel, table=True):
    provider: str = Field(primary_key=True)  # "google" | "outlook"
    client_id: str
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: NaiveDatetime


class Setting(SQLModel, table=True):
    """Generic key-value store for small config values that aren't worth
    their own table: Ollama host/model, Google/Outlook OAuth client ids."""

    key: str = Field(primary_key=True)
    value: str
