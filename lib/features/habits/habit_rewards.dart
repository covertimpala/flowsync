import '../../models/habit.dart';

/// Pure streak/points math, kept separate from [HabitRepository] so it's
/// trivial to unit test without a database.
class HabitRewards {
  const HabitRewards._();

  /// Whether [habit] is "due" on [day] given its frequency.
  static bool isDue(Habit habit, DateTime day) {
    switch (habit.frequency) {
      case HabitFrequency.daily:
        return true;
      case HabitFrequency.weekly:
        return day.weekday == DateTime.monday;
      case HabitFrequency.custom:
        return habit.customDays.contains(day.weekday);
    }
  }

  /// Returns the habit's state after marking it complete on [day], given it
  /// was last completed on [previousCompletionDay] (null if never).
  static Habit markCompleted(Habit habit, DateTime day, DateTime? previousCompletionDay) {
    final consecutive = previousCompletionDay != null &&
        day.difference(dateOnly(previousCompletionDay)).inDays <= _streakGraceDays(habit);

    final newStreak = consecutive ? habit.currentStreak + 1 : 1;
    return habit.copyWith(
      currentStreak: newStreak,
      bestStreak: newStreak > habit.bestStreak ? newStreak : habit.bestStreak,
    );
  }

  /// How many days may pass between completions before a streak resets.
  /// Daily habits allow 1 day (today vs. yesterday); weekly habits allow a
  /// full week.
  static int _streakGraceDays(Habit habit) {
    switch (habit.frequency) {
      case HabitFrequency.daily:
        return 1;
      case HabitFrequency.weekly:
        return 7;
      case HabitFrequency.custom:
        return 7;
    }
  }
}

DateTime dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);
