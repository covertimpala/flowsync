from datetime import datetime

from ..models import Habit, HabitFrequency


def is_due(habit: Habit, day: datetime) -> bool:
    if habit.frequency == HabitFrequency.daily:
        return True
    if habit.frequency == HabitFrequency.weekly:
        return day.isoweekday() == 1  # Monday
    # custom: comma-separated ISO weekdays (1=Mon..7=Sun)
    days = {int(d) for d in habit.custom_days.split(",") if d}
    return day.isoweekday() in days


def _streak_grace_days(habit: Habit) -> int:
    return 1 if habit.frequency == HabitFrequency.daily else 7


def mark_completed(habit: Habit, day: datetime, previous_completion_day: datetime | None) -> None:
    """Mutates `habit.current_streak` / `best_streak` in place after a
    completion on `day`, given the habit was last completed on
    `previous_completion_day` (None if never)."""
    consecutive = previous_completion_day is not None and (
        day.date() - previous_completion_day.date()
    ).days <= _streak_grace_days(habit)

    new_streak = habit.current_streak + 1 if consecutive else 1
    habit.current_streak = new_streak
    habit.best_streak = max(new_streak, habit.best_streak)
