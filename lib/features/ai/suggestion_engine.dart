import 'dart:convert';

import '../../models/ai_suggestion.dart';
import '../../models/budget.dart';
import '../../models/calendar_event.dart';
import '../../models/habit.dart';
import '../../models/task_item.dart';
import '../budget/budget_repository.dart';
import 'ollama_client.dart';
import 'suggestion_repository.dart';

/// Turns today's on-device state (tasks, habits, budget) into a prompt for
/// the local Ollama model, and turns its reply back into [AiSuggestion]
/// rows the UI can show as accept/deny cards.
///
/// Every suggestion is inert until the user accepts it — this engine never
/// writes to tasks/habits/budget tables directly. See
/// `features/ai/widgets/suggestion_card.dart` for the handlers that apply an
/// accepted suggestion.
class SuggestionEngine {
  SuggestionEngine({
    required this.ollama,
    required this.suggestions,
  });

  final OllamaClient ollama;
  final SuggestionRepository suggestions;

  static const _systemPrompt = '''
You are a planning assistant embedded in a personal productivity app called
FlowSync. You will be given the user's tasks, calendar events, habits, and
budget status for today. Suggest at most 3 concrete, specific improvements.

Respond with ONLY a JSON array, no prose, matching this shape:
[
  {"kind": "rescheduleTask|addTask|habitNudge|budgetWarning|freeTimeIdea",
   "summary": "one sentence, shown directly to the user",
   "payload": { ...kind-specific fields... }}
]
If you have no useful suggestion, respond with [].
''';

  Future<List<AiSuggestion>> generateSuggestions({
    required List<TaskItem> unscheduledOrOverdueTasks,
    required List<CalendarEvent> todaysEvents,
    required List<Habit> habits,
    required List<CategorySpend> budgetStatus,
  }) async {
    final prompt = _buildPrompt(
      unscheduledOrOverdueTasks,
      todaysEvents,
      habits,
      budgetStatus,
    );

    final raw = await ollama.generate(prompt, system: _systemPrompt);
    final parsed = _parseSuggestions(raw);

    final created = <AiSuggestion>[];
    for (final s in parsed) {
      created.add(await suggestions.create(s));
    }
    return created;
  }

  String _buildPrompt(
    List<TaskItem> tasks,
    List<CalendarEvent> events,
    List<Habit> habits,
    List<CategorySpend> budgetStatus,
  ) {
    final buffer = StringBuffer();

    buffer.writeln('TASKS (unscheduled or overdue):');
    if (tasks.isEmpty) buffer.writeln('- none');
    for (final t in tasks) {
      buffer.writeln('- "${t.title}" (${t.estimatedMinutes}min, '
          'priority=${t.priority.name}, due=${t.dueDate ?? 'none'})');
    }

    buffer.writeln('\nTODAY\'S CALENDAR EVENTS:');
    if (events.isEmpty) buffer.writeln('- none');
    for (final e in events) {
      buffer.writeln('- "${e.title}" ${e.start}–${e.end}');
    }

    buffer.writeln('\nHABITS:');
    if (habits.isEmpty) buffer.writeln('- none');
    for (final h in habits) {
      buffer.writeln('- "${h.name}" streak=${h.currentStreak} best=${h.bestStreak}');
    }

    buffer.writeln('\nBUDGET THIS MONTH:');
    if (budgetStatus.isEmpty) buffer.writeln('- none tracked');
    for (final c in budgetStatus) {
      final limit = c.category.monthlyLimitCents;
      buffer.writeln('- "${c.category.name}": spent ${c.spentCents / 100} '
          '${limit > 0 ? 'of limit ${limit / 100}' : '(no limit set)'}');
    }

    return buffer.toString();
  }

  List<AiSuggestion> _parseSuggestions(String raw) {
    final jsonText = _extractJsonArray(raw);
    if (jsonText == null) return [];

    try {
      final list = jsonDecode(jsonText) as List<Object?>;
      final now = DateTime.now();
      return list.map((item) {
        final map = item as Map<String, Object?>;
        return AiSuggestion(
          kind: SuggestionKind.values.byName(map['kind'] as String),
          summary: map['summary'] as String,
          payloadJson: jsonEncode(map['payload'] ?? {}),
          createdAt: now,
        );
      }).toList();
    } catch (_) {
      // Model didn't return valid JSON this time — surface nothing rather
      // than a garbled suggestion card.
      return [];
    }
  }

  /// Ollama models sometimes wrap JSON in prose or code fences despite the
  /// instruction not to; this pulls out the first top-level `[...]` block.
  String? _extractJsonArray(String raw) {
    final start = raw.indexOf('[');
    final end = raw.lastIndexOf(']');
    if (start == -1 || end == -1 || end < start) return null;
    return raw.substring(start, end + 1);
  }
}
