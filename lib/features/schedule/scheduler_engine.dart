import '../../models/calendar_event.dart';
import '../../models/task_item.dart';

class TimeSlot {
  final DateTime start;
  final DateTime end;
  const TimeSlot(this.start, this.end);
  Duration get duration => end.difference(start);
}

/// Builds the day's schedule by fitting unscheduled tasks into the gaps left
/// by calendar events, inside a configurable working window.
///
/// This is intentionally simple (greedy, priority-first) rather than a full
/// constraint solver — it's meant to produce one reasonable plan instantly,
/// which the AI suggestion engine can then propose tweaks to.
class SchedulerEngine {
  const SchedulerEngine({
    this.dayStartHour = 8,
    this.dayEndHour = 20,
    this.bufferMinutes = 10,
  });

  final int dayStartHour;
  final int dayEndHour;

  /// Minutes of breathing room left free after each placed task.
  final int bufferMinutes;

  /// Returns the free [TimeSlot]s on [day], after subtracting [busyEvents].
  List<TimeSlot> freeSlotsFor(DateTime day, List<CalendarEvent> busyEvents) {
    final windowStart = DateTime(day.year, day.month, day.day, dayStartHour);
    final windowEnd = DateTime(day.year, day.month, day.day, dayEndHour);

    final busy = busyEvents
        .where((e) => e.start.isBefore(windowEnd) && e.end.isAfter(windowStart))
        .map((e) => TimeSlot(
              e.start.isBefore(windowStart) ? windowStart : e.start,
              e.end.isAfter(windowEnd) ? windowEnd : e.end,
            ))
        .toList()
      ..sort((a, b) => a.start.compareTo(b.start));

    final free = <TimeSlot>[];
    var cursor = windowStart;
    for (final slot in busy) {
      if (slot.start.isAfter(cursor)) {
        free.add(TimeSlot(cursor, slot.start));
      }
      if (slot.end.isAfter(cursor)) cursor = slot.end;
    }
    if (cursor.isBefore(windowEnd)) {
      free.add(TimeSlot(cursor, windowEnd));
    }
    return free;
  }

  /// Greedily assigns [tasks] (highest priority / earliest due date first,
  /// as returned by `ScheduleRepository.incompleteTasks`) into the free
  /// slots for [day]. Returns a map of task -> assigned slot for tasks that
  /// fit; tasks that don't fit anywhere today are omitted so the caller can
  /// carry them over to the next day.
  Map<TaskItem, TimeSlot> plan(
    DateTime day,
    List<TaskItem> tasks,
    List<CalendarEvent> busyEvents,
  ) {
    final slots = freeSlotsFor(day, busyEvents)
        .map((s) => TimeSlot(s.start, s.end))
        .toList();
    final result = <TaskItem, TimeSlot>{};

    for (final task in tasks) {
      final needed = Duration(minutes: task.estimatedMinutes);
      for (var i = 0; i < slots.length; i++) {
        final slot = slots[i];
        if (slot.duration < needed) continue;

        final taskStart = slot.start;
        final taskEnd = taskStart.add(needed);
        result[task] = TimeSlot(taskStart, taskEnd);

        final remainderStart = taskEnd.add(Duration(minutes: bufferMinutes));
        slots[i] = remainderStart.isBefore(slot.end)
            ? TimeSlot(remainderStart, slot.end)
            : TimeSlot(slot.end, slot.end);
        break;
      }
    }
    return result;
  }
}
