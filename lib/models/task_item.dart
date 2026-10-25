enum TaskPriority { low, medium, high }

class TaskItem {
  final int? id;
  final String title;
  final String? notes;
  final DateTime? dueDate;

  /// Estimated minutes needed — the scheduler uses this to find a free slot.
  final int estimatedMinutes;
  final TaskPriority priority;
  final bool completed;

  /// When the scheduler has placed this task into a specific slot.
  final DateTime? scheduledStart;
  final DateTime? scheduledEnd;

  const TaskItem({
    this.id,
    required this.title,
    this.notes,
    this.dueDate,
    this.estimatedMinutes = 30,
    this.priority = TaskPriority.medium,
    this.completed = false,
    this.scheduledStart,
    this.scheduledEnd,
  });

  TaskItem copyWith({
    String? title,
    String? notes,
    DateTime? dueDate,
    int? estimatedMinutes,
    TaskPriority? priority,
    bool? completed,
    DateTime? scheduledStart,
    DateTime? scheduledEnd,
  }) {
    return TaskItem(
      id: id,
      title: title ?? this.title,
      notes: notes ?? this.notes,
      dueDate: dueDate ?? this.dueDate,
      estimatedMinutes: estimatedMinutes ?? this.estimatedMinutes,
      priority: priority ?? this.priority,
      completed: completed ?? this.completed,
      scheduledStart: scheduledStart ?? this.scheduledStart,
      scheduledEnd: scheduledEnd ?? this.scheduledEnd,
    );
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'title': title,
        'notes': notes,
        'due_date': dueDate?.toIso8601String(),
        'estimated_minutes': estimatedMinutes,
        'priority': priority.name,
        'completed': completed ? 1 : 0,
        'scheduled_start': scheduledStart?.toIso8601String(),
        'scheduled_end': scheduledEnd?.toIso8601String(),
      };

  factory TaskItem.fromMap(Map<String, Object?> map) => TaskItem(
        id: map['id'] as int?,
        title: map['title'] as String,
        notes: map['notes'] as String?,
        dueDate: map['due_date'] == null
            ? null
            : DateTime.parse(map['due_date'] as String),
        estimatedMinutes: map['estimated_minutes'] as int,
        priority: TaskPriority.values.byName(map['priority'] as String),
        completed: (map['completed'] as int) == 1,
        scheduledStart: map['scheduled_start'] == null
            ? null
            : DateTime.parse(map['scheduled_start'] as String),
        scheduledEnd: map['scheduled_end'] == null
            ? null
            : DateTime.parse(map['scheduled_end'] as String),
      );
}
