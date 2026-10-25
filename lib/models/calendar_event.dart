/// Which source a calendar event came from. `local` events are created
/// inside FlowSync itself; the others are imported/synced from elsewhere.
enum CalendarSource { local, google, outlook, ics }

class CalendarEvent {
  final int? id;
  final String title;
  final DateTime start;
  final DateTime end;
  final bool allDay;
  final String? location;
  final String? notes;
  final CalendarSource source;

  /// Opaque id from the remote provider, used to de-duplicate on re-sync.
  final String? externalId;

  const CalendarEvent({
    this.id,
    required this.title,
    required this.start,
    required this.end,
    this.allDay = false,
    this.location,
    this.notes,
    this.source = CalendarSource.local,
    this.externalId,
  });

  Duration get duration => end.difference(start);

  CalendarEvent copyWith({
    int? id,
    String? title,
    DateTime? start,
    DateTime? end,
    bool? allDay,
    String? location,
    String? notes,
  }) {
    return CalendarEvent(
      id: id ?? this.id,
      title: title ?? this.title,
      start: start ?? this.start,
      end: end ?? this.end,
      allDay: allDay ?? this.allDay,
      location: location ?? this.location,
      notes: notes ?? this.notes,
      source: source,
      externalId: externalId,
    );
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'title': title,
        'start': start.toIso8601String(),
        'end': end.toIso8601String(),
        'all_day': allDay ? 1 : 0,
        'location': location,
        'notes': notes,
        'source': source.name,
        'external_id': externalId,
      };

  factory CalendarEvent.fromMap(Map<String, Object?> map) => CalendarEvent(
        id: map['id'] as int?,
        title: map['title'] as String,
        start: DateTime.parse(map['start'] as String),
        end: DateTime.parse(map['end'] as String),
        allDay: (map['all_day'] as int) == 1,
        location: map['location'] as String?,
        notes: map['notes'] as String?,
        source: CalendarSource.values.byName(map['source'] as String),
        externalId: map['external_id'] as String?,
      );
}
