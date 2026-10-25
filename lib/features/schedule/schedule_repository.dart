import '../../data/app_database.dart';
import '../../models/task_item.dart';

class ScheduleRepository {
  ScheduleRepository(this._db);
  final AppDatabase _db;

  Future<List<TaskItem>> incompleteTasks() async {
    final rows = await _db.db.query(
      'tasks',
      where: 'completed = 0',
      orderBy: "priority = 'high' DESC, due_date ASC",
    );
    return rows.map(TaskItem.fromMap).toList();
  }

  Future<List<TaskItem>> tasksScheduledOn(DateTime day) async {
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    final rows = await _db.db.query(
      'tasks',
      where: 'scheduled_start >= ? AND scheduled_start < ?',
      whereArgs: [start.toIso8601String(), end.toIso8601String()],
      orderBy: 'scheduled_start ASC',
    );
    return rows.map(TaskItem.fromMap).toList();
  }

  Future<TaskItem> create(TaskItem task) async {
    final id = await _db.db.insert('tasks', task.toMap()..remove('id'));
    return task.copyWith();
  }

  Future<void> update(TaskItem task) async {
    await _db.db.update('tasks', task.toMap(), where: 'id = ?', whereArgs: [task.id]);
  }

  Future<void> setCompleted(int id, bool completed) async {
    await _db.db.update(
      'tasks',
      {'completed': completed ? 1 : 0},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> schedule(int id, DateTime start, DateTime end) async {
    await _db.db.update(
      'tasks',
      {'scheduled_start': start.toIso8601String(), 'scheduled_end': end.toIso8601String()},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> delete(int id) async {
    await _db.db.delete('tasks', where: 'id = ?', whereArgs: [id]);
  }
}
