from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from .models import (
    BudgetEntryType,
    CalendarSource,
    HabitFrequency,
    ItemStatus,
    TaskPriority,
)


class TaskCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    estimated_minutes: int = 30
    priority: TaskPriority = TaskPriority.medium
    category_id: Optional[int] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    due_date: Optional[datetime] = None
    estimated_minutes: Optional[int] = None
    priority: Optional[TaskPriority] = None
    completed: Optional[bool] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    category_id: Optional[int] = None


class TaskCategoryCreate(BaseModel):
    name: str
    color: str = "#6c8dfa"


class EventCreate(BaseModel):
    title: str
    start: datetime
    end: datetime
    all_day: bool = False
    location: Optional[str] = None
    notes: Optional[str] = None


class HabitCreate(BaseModel):
    name: str
    icon: Optional[str] = None
    frequency: HabitFrequency = HabitFrequency.daily
    custom_days: str = ""
    points_per_completion: int = 10


class RewardCreate(BaseModel):
    name: str
    point_cost: int


class BudgetCategoryCreate(BaseModel):
    name: str
    monthly_limit_cents: int = 0


class BudgetEntryCreate(BaseModel):
    category_id: int
    amount_cents: int
    type: BudgetEntryType
    date: datetime
    note: Optional[str] = None


class AcceptRequest(BaseModel):
    """Body for POST /api/pending/{kind}/{id}/accept. `push_to_calendar`
    and `calendar_provider` only apply to kind="event", and only have an
    effect if that provider is connected — otherwise the event is simply
    kept local."""

    push_to_calendar: bool = False
    calendar_provider: Optional[str] = None  # "google" | "outlook"


class IcsImportRequest(BaseModel):
    ics_text: str


class OAuthClientIdRequest(BaseModel):
    client_id: str


class OllamaSettingsUpdate(BaseModel):
    host: Optional[str] = None
    model: Optional[str] = None
