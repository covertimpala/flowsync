/// What kind of change the suggestion wants to make, so the UI knows which
/// repository method to call if the user accepts it.
enum SuggestionKind {
  rescheduleTask,
  addTask,
  habitNudge,
  budgetWarning,
  freeTimeIdea,
}

enum SuggestionStatus { pending, accepted, denied }

class AiSuggestion {
  final int? id;
  final SuggestionKind kind;
  final String summary;

  /// Free-form JSON-encoded payload specific to [kind] (e.g. task id + new
  /// start time for a reschedule). Parsed by the handler that applies it.
  final String payloadJson;
  final SuggestionStatus status;
  final DateTime createdAt;

  const AiSuggestion({
    this.id,
    required this.kind,
    required this.summary,
    required this.payloadJson,
    this.status = SuggestionStatus.pending,
    required this.createdAt,
  });

  AiSuggestion copyWith({SuggestionStatus? status}) => AiSuggestion(
        id: id,
        kind: kind,
        summary: summary,
        payloadJson: payloadJson,
        status: status ?? this.status,
        createdAt: createdAt,
      );

  Map<String, Object?> toMap() => {
        'id': id,
        'kind': kind.name,
        'summary': summary,
        'payload_json': payloadJson,
        'status': status.name,
        'created_at': createdAt.toIso8601String(),
      };

  factory AiSuggestion.fromMap(Map<String, Object?> map) => AiSuggestion(
        id: map['id'] as int?,
        kind: SuggestionKind.values.byName(map['kind'] as String),
        summary: map['summary'] as String,
        payloadJson: map['payload_json'] as String,
        status: SuggestionStatus.values.byName(map['status'] as String),
        createdAt: DateTime.parse(map['created_at'] as String),
      );
}
