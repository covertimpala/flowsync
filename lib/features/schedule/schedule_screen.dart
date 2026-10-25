import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/ai_suggestion.dart';
import '../../models/budget.dart';
import '../../models/calendar_event.dart';
import '../../models/habit.dart';
import '../../models/task_item.dart';
import '../ai/widgets/suggestion_card.dart';
import '../../shared/providers.dart';
import 'scheduler_engine.dart';

/// "Today" screen: the merged calendar-events + scheduled-tasks timeline,
/// an inbox of unscheduled tasks, and any pending AI suggestions.
class ScheduleScreen extends ConsumerStatefulWidget {
  const ScheduleScreen({super.key});
  @override
  ConsumerState<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends ConsumerState<ScheduleScreen> {
  DateTime _day = DateTime.now();
  List<CalendarEvent> _events = [];
  List<TaskItem> _unscheduled = [];
  Map<TaskItem, TimeSlot> _plan = {};
  List<AiSuggestion> _suggestions = [];
  bool _loading = true;
  bool _askingAi = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final dayStart = DateTime(_day.year, _day.month, _day.day);
    final dayEnd = dayStart.add(const Duration(days: 1));

    final events = await ref.read(calendarRepositoryProvider).eventsBetween(dayStart, dayEnd);
    final tasks = await ref.read(scheduleRepositoryProvider).incompleteTasks();
    final suggestions = await ref.read(suggestionRepositoryProvider).pending();
    final plan = ref.read(schedulerEngineProvider).plan(_day, tasks, events);

    setState(() {
      _events = events;
      _unscheduled = tasks.where((t) => !plan.containsKey(t)).toList();
      _plan = plan;
      _suggestions = suggestions;
      _loading = false;
    });
  }

  Future<void> _askAiForSuggestions() async {
    setState(() => _askingAi = true);
    try {
      final engine = ref.read(suggestionEngineProvider);
      final habits = await ref.read(habitRepositoryProvider).activeHabits();
      final budget = await ref.read(budgetRepositoryProvider).spendByCategoryForMonth(DateTime.now());

      final available = await ref.read(ollamaClientProvider).isAvailable();
      if (!available) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text("Can't reach Ollama at localhost:11434 — is `ollama serve` running?"),
          ));
        }
        return;
      }

      await engine.generateSuggestions(
        unscheduledOrOverdueTasks: _unscheduled,
        todaysEvents: _events,
        habits: habits,
        budgetStatus: budget,
      );
      await _load();
    } finally {
      if (mounted) setState(() => _askingAi = false);
    }
  }

  Future<void> _accept(AiSuggestion s) async {
    // Applying the change is kind-specific; for now we support the two
    // kinds that only need data already in this screen. Other kinds are
    // informational (habit nudges, budget warnings) and simply get
    // acknowledged.
    if (s.kind == SuggestionKind.addTask) {
      final payload = s.payloadJson;
      final title = RegExp('"title"\\s*:\\s*"([^"]+)"').firstMatch(payload)?.group(1) ?? s.summary;
      await ref.read(scheduleRepositoryProvider).create(TaskItem(title: title));
    }
    await ref.read(suggestionRepositoryProvider).setStatus(s.id!, SuggestionStatus.accepted);
    await _load();
  }

  Future<void> _deny(AiSuggestion s) async {
    await ref.read(suggestionRepositoryProvider).setStatus(s.id!, SuggestionStatus.denied);
    await _load();
  }

  Future<void> _addTask() async {
    final controller = TextEditingController();
    final title = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New task'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'Task title')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Add')),
        ],
      ),
    );
    if (title == null || title.trim().isEmpty) return;
    await ref.read(scheduleRepositoryProvider).create(TaskItem(title: title.trim()));
    await _load();
  }

  Future<void> _toggleDone(TaskItem task) async {
    await ref.read(scheduleRepositoryProvider).setCompleted(task.id!, !task.completed);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    final timeFmt = DateFormat.Hm();

    return Scaffold(
      floatingActionButton: FloatingActionButton(onPressed: _addTask, child: const Icon(Icons.add)),
      body: RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 80),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(DateFormat.yMMMEd().format(_day), style: Theme.of(context).textTheme.titleLarge),
                ),
                OutlinedButton.icon(
                  onPressed: _askingAi ? null : _askAiForSuggestions,
                  icon: _askingAi
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.auto_awesome, size: 18),
                  label: const Text('Ask AI'),
                ),
              ],
            ),
          ),
          if (_suggestions.isNotEmpty) ...[
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text('Suggestions', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            for (final s in _suggestions)
              SuggestionCard(suggestion: s, onAccept: () => _accept(s), onDeny: () => _deny(s)),
          ],
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text('Timeline', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
          for (final e in _events)
            ListTile(
              leading: const Icon(Icons.event),
              title: Text(e.title),
              subtitle: Text('${timeFmt.format(e.start)} – ${timeFmt.format(e.end)}'),
            ),
          for (final entry in _plan.entries)
            ListTile(
              leading: Checkbox(value: entry.key.completed, onChanged: (_) => _toggleDone(entry.key)),
              title: Text(entry.key.title),
              subtitle: Text('${timeFmt.format(entry.value.start)} – ${timeFmt.format(entry.value.end)} (planned)'),
            ),
          if (_unscheduled.isNotEmpty) ...[
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text("Couldn't fit today", style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            for (final t in _unscheduled)
              ListTile(
                leading: Checkbox(value: t.completed, onChanged: (_) => _toggleDone(t)),
                title: Text(t.title),
                subtitle: Text('${t.estimatedMinutes}min · ${t.priority.name} priority'),
              ),
          ],
        ],
      ),
      ),
    );
  }
}
