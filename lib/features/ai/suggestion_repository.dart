import '../../data/app_database.dart';
import '../../models/ai_suggestion.dart';

class SuggestionRepository {
  SuggestionRepository(this._db);
  final AppDatabase _db;

  Future<List<AiSuggestion>> pending() async {
    final rows = await _db.db.query(
      'ai_suggestions',
      where: 'status = ?',
      whereArgs: [SuggestionStatus.pending.name],
      orderBy: 'created_at DESC',
    );
    return rows.map(AiSuggestion.fromMap).toList();
  }

  Future<AiSuggestion> create(AiSuggestion suggestion) async {
    final id = await _db.db.insert('ai_suggestions', suggestion.toMap()..remove('id'));
    return suggestion.copyWith();
  }

  Future<void> setStatus(int id, SuggestionStatus status) async {
    await _db.db.update(
      'ai_suggestions',
      {'status': status.name},
      where: 'id = ?',
      whereArgs: [id],
    );
  }
}
