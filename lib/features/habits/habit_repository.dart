import '../../data/app_database.dart';
import '../../models/habit.dart';

class HabitRepository {
  HabitRepository(this._db);
  final AppDatabase _db;

  Future<List<Habit>> activeHabits() async {
    final rows = await _db.db.query('habits', where: 'archived = 0', orderBy: 'name ASC');
    return rows.map(Habit.fromMap).toList();
  }

  Future<Habit> create(Habit habit) async {
    final id = await _db.db.insert('habits', habit.toMap()..remove('id'));
    return habit.copyWith();
  }

  Future<void> update(Habit habit) async {
    await _db.db.update('habits', habit.toMap(), where: 'id = ?', whereArgs: [habit.id]);
  }

  Future<bool> completedOn(int habitId, DateTime day) async {
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    final rows = await _db.db.query(
      'habit_logs',
      where: 'habit_id = ? AND completed_on >= ? AND completed_on < ?',
      whereArgs: [habitId, start.toIso8601String(), end.toIso8601String()],
    );
    return rows.isNotEmpty;
  }

  Future<List<HabitLog>> logsFor(int habitId, {int lastNDays = 60}) async {
    final since = DateTime.now().subtract(Duration(days: lastNDays));
    final rows = await _db.db.query(
      'habit_logs',
      where: 'habit_id = ? AND completed_on >= ?',
      whereArgs: [habitId, since.toIso8601String()],
      orderBy: 'completed_on ASC',
    );
    return rows.map(HabitLog.fromMap).toList();
  }

  /// Logs today's completion and returns the habit's updated streak/points
  /// state (the caller persists it via [update]).
  Future<void> logCompletion(Habit habit, DateTime day) async {
    await _db.db.insert('habit_logs', HabitLog(habitId: habit.id!, completedOn: day).toMap()..remove('id'));
  }

  Future<List<Reward>> rewards() async {
    final rows = await _db.db.query('rewards', orderBy: 'point_cost ASC');
    return rows.map(Reward.fromMap).toList();
  }

  Future<Reward> createReward(Reward reward) async {
    final id = await _db.db.insert('rewards', reward.toMap()..remove('id'));
    return reward.copyWith();
  }

  Future<void> redeemReward(int id) async {
    await _db.db.update('rewards', {'redeemed': 1}, where: 'id = ?', whereArgs: [id]);
  }

  /// Total points available to spend: sum of all completions' point value
  /// minus points already spent on redeemed rewards.
  Future<int> availablePoints() async {
    final earnedRows = await _db.db.rawQuery('''
      SELECT COALESCE(SUM(h.points_per_completion), 0) AS total
      FROM habit_logs l JOIN habits h ON h.id = l.habit_id
    ''');
    final spentRows = await _db.db.rawQuery('''
      SELECT COALESCE(SUM(point_cost), 0) AS total FROM rewards WHERE redeemed = 1
    ''');
    final earned = earnedRows.first['total'] as int;
    final spent = spentRows.first['total'] as int;
    return earned - spent;
  }
}
