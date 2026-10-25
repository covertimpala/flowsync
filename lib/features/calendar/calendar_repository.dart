import '../../data/app_database.dart';
import '../../models/calendar_event.dart';

class CalendarRepository {
  CalendarRepository(this._db);
  final AppDatabase _db;

  Future<List<CalendarEvent>> eventsBetween(DateTime start, DateTime end) async {
    final rows = await _db.db.query(
      'events',
      where: 'start < ? AND end > ?',
      whereArgs: [end.toIso8601String(), start.toIso8601String()],
      orderBy: 'start ASC',
    );
    return rows.map(CalendarEvent.fromMap).toList();
  }

  Future<CalendarEvent> create(CalendarEvent event) async {
    final id = await _db.db.insert('events', event.toMap()..remove('id'));
    return event.copyWith(id: id);
  }

  Future<void> update(CalendarEvent event) async {
    await _db.db.update('events', event.toMap(), where: 'id = ?', whereArgs: [event.id]);
  }

  Future<void> delete(int id) async {
    await _db.db.delete('events', where: 'id = ?', whereArgs: [id]);
  }

  /// Upserts events coming from an import/sync (ICS, Google, Outlook),
  /// matched on `external_id` so re-running a sync doesn't duplicate rows.
  Future<void> upsertExternal(List<CalendarEvent> events) async {
    final batch = _db.db.batch();
    for (final e in events) {
      if (e.externalId == null) continue;
      final existing = await _db.db.query(
        'events',
        where: 'external_id = ? AND source = ?',
        whereArgs: [e.externalId, e.source.name],
        limit: 1,
      );
      if (existing.isEmpty) {
        batch.insert('events', e.toMap()..remove('id'));
      } else {
        batch.update(
          'events',
          e.toMap()..remove('id'),
          where: 'id = ?',
          whereArgs: [existing.first['id']],
        );
      }
    }
    await batch.commit(noResult: true);
  }
}
