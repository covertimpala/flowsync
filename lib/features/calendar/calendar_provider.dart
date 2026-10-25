import 'package:icalendar_parser/icalendar_parser.dart';

import '../../models/calendar_event.dart';

/// A source FlowSync can pull events from. Implement this for each calendar
/// backend; the rest of the app only ever talks to this interface, so adding
/// a new provider never touches the UI or scheduler.
///
/// Shipped today: [IcsFileProvider], which needs no API keys or OAuth and
/// covers Google Calendar, Outlook, and Apple Calendar via their "export/
/// subscribe" .ics links or files. A live `GoogleCalendarProvider` /
/// `OutlookCalendarProvider` can implement the same interface once this app
/// is registered for OAuth credentials with each provider.
abstract class CalendarProvider {
  CalendarSource get source;
  Future<List<CalendarEvent>> fetchEvents();
}

/// Parses a raw .ics feed (a pasted subscription URL's contents, or a file
/// the user picked) into [CalendarEvent]s. Works offline, no account linking
/// required — the most dependency-light way to get a user's existing
/// calendar into FlowSync on day one.
class IcsFileProvider implements CalendarProvider {
  IcsFileProvider(this.icsContents);
  final String icsContents;

  @override
  CalendarSource get source => CalendarSource.ics;

  @override
  Future<List<CalendarEvent>> fetchEvents() async {
    final cal = ICalendar.fromString(icsContents);
    final events = <CalendarEvent>[];

    for (final item in cal.data) {
      if (item['type'] != 'VEVENT') continue;

      final summary = (item['summary'] ?? 'Untitled event').toString();
      final dtStart = _asDateTime(item['dtstart']);
      final dtEnd = _asDateTime(item['dtend']) ?? dtStart?.add(const Duration(hours: 1));
      if (dtStart == null || dtEnd == null) continue;

      events.add(CalendarEvent(
        title: summary,
        start: dtStart,
        end: dtEnd,
        location: item['location']?.toString(),
        notes: item['description']?.toString(),
        source: source,
        externalId: item['uid']?.toString(),
      ));
    }
    return events;
  }

  DateTime? _asDateTime(Object? value) {
    if (value == null) return null;
    if (value is IcsDateTime) return value.toDateTime();
    return DateTime.tryParse(value.toString());
  }
}
