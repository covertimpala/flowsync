import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../models/ai_suggestion.dart';

/// Displays one pending [AiSuggestion] with Accept/Deny actions.
///
/// This widget never decides what "accepting" does — it just reports the
/// decision upward via [onAccept]/[onDeny]. The actual effect (creating a
/// task, moving a task's scheduled time, etc.) is applied by the screen
/// that owns the relevant repository, based on [AiSuggestion.kind] and the
/// decoded [AiSuggestion.payloadJson].
class SuggestionCard extends StatelessWidget {
  const SuggestionCard({
    super.key,
    required this.suggestion,
    required this.onAccept,
    required this.onDeny,
  });

  final AiSuggestion suggestion;
  final VoidCallback onAccept;
  final VoidCallback onDeny;

  @override
  Widget build(BuildContext context) {
    final payload = jsonDecode(suggestion.payloadJson) as Map<String, Object?>;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(_iconFor(suggestion.kind), size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _labelFor(suggestion.kind),
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(suggestion.summary, style: Theme.of(context).textTheme.bodyMedium),
            if (payload.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                payload.entries.map((e) => '${e.key}: ${e.value}').join('  ·  '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(onPressed: onDeny, child: const Text('Deny')),
                const SizedBox(width: 8),
                FilledButton(onPressed: onAccept, child: const Text('Accept')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconFor(SuggestionKind kind) {
    switch (kind) {
      case SuggestionKind.rescheduleTask:
        return Icons.schedule;
      case SuggestionKind.addTask:
        return Icons.add_task;
      case SuggestionKind.habitNudge:
        return Icons.local_fire_department;
      case SuggestionKind.budgetWarning:
        return Icons.account_balance_wallet;
      case SuggestionKind.freeTimeIdea:
        return Icons.lightbulb;
    }
  }

  String _labelFor(SuggestionKind kind) {
    switch (kind) {
      case SuggestionKind.rescheduleTask:
        return 'Reschedule suggestion';
      case SuggestionKind.addTask:
        return 'New task suggestion';
      case SuggestionKind.habitNudge:
        return 'Habit nudge';
      case SuggestionKind.budgetWarning:
        return 'Budget warning';
      case SuggestionKind.freeTimeIdea:
        return 'Free time idea';
    }
  }
}
