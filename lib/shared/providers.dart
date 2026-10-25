import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/app_database.dart';
import '../features/ai/ollama_client.dart';
import '../features/ai/suggestion_engine.dart';
import '../features/ai/suggestion_repository.dart';
import '../features/budget/budget_repository.dart';
import '../features/calendar/calendar_repository.dart';
import '../features/habits/habit_repository.dart';
import '../features/schedule/schedule_repository.dart';
import '../features/schedule/scheduler_engine.dart';

/// Resolved once at app start (see `main.dart`) and overridden here so every
/// repository provider below can depend on the open [AppDatabase] without
/// each screen needing to know how it was constructed.
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  throw UnimplementedError('appDatabaseProvider must be overridden in main()');
});

final calendarRepositoryProvider = Provider((ref) => CalendarRepository(ref.watch(appDatabaseProvider)));
final scheduleRepositoryProvider = Provider((ref) => ScheduleRepository(ref.watch(appDatabaseProvider)));
final habitRepositoryProvider = Provider((ref) => HabitRepository(ref.watch(appDatabaseProvider)));
final budgetRepositoryProvider = Provider((ref) => BudgetRepository(ref.watch(appDatabaseProvider)));
final suggestionRepositoryProvider =
    Provider((ref) => SuggestionRepository(ref.watch(appDatabaseProvider)));

final schedulerEngineProvider = Provider((ref) => const SchedulerEngine());

/// Ollama host/model are user-configurable (see Settings); default assumes
/// `ollama serve` running locally with `llama3.2` pulled.
final ollamaClientProvider = Provider((ref) => OllamaClient());

final suggestionEngineProvider = Provider((ref) => SuggestionEngine(
      ollama: ref.watch(ollamaClientProvider),
      suggestions: ref.watch(suggestionRepositoryProvider),
    ));
