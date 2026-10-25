import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:table_calendar/table_calendar.dart';

import '../../models/calendar_event.dart';
import '../../shared/providers.dart';
import 'calendar_provider.dart';

/// Month view across every synced calendar source. Events created here are
/// `local`; events brought in via "Import .ics" are tagged with their
/// source so the UI can show where each one came from.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});
  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  DateTime _focusedMonth = DateTime.now();
  DateTime _selectedDay = DateTime.now();
  List<CalendarEvent> _monthEvents = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final start = DateTime(_focusedMonth.year, _focusedMonth.month - 1, 1);
    final end = DateTime(_focusedMonth.year, _focusedMonth.month + 2, 1);
    final events = await ref.read(calendarRepositoryProvider).eventsBetween(start, end);
    setState(() {
      _monthEvents = events;
      _loading = false;
    });
  }

  List<CalendarEvent> _eventsOn(DateTime day) {
    return _monthEvents.where((e) => isSameDay(e.start, day)).toList();
  }

  Future<void> _importIcs() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import calendar (.ics)'),
        content: SizedBox(
          width: 480,
          child: TextField(
            controller: controller,
            maxLines: 10,
            decoration: const InputDecoration(
              hintText: 'Paste the contents of a .ics export/subscription '
                  'from Google Calendar, Outlook, or Apple Calendar here.',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Import')),
        ],
      ),
    );
    if (text == null || text.trim().isEmpty) return;

    final provider = IcsFileProvider(text);
    final events = await provider.fetchEvents();
    await ref.read(calendarRepositoryProvider).upsertExternal(events);
    await _load();
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Imported ${events.length} events')));
    }
  }

  Future<void> _addEvent(DateTime day) async {
    final titleController = TextEditingController();
    TimeOfDay start = const TimeOfDay(hour: 9, minute: 0);
    TimeOfDay end = const TimeOfDay(hour: 10, minute: 0);

    final result = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('New event'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: titleController, autofocus: true, decoration: const InputDecoration(hintText: 'Title')),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: ListTile(
                      title: Text('Start ${start.format(context)}'),
                      onTap: () async {
                        final picked = await showTimePicker(context: context, initialTime: start);
                        if (picked != null) setDialogState(() => start = picked);
                      },
                    ),
                  ),
                  Expanded(
                    child: ListTile(
                      title: Text('End ${end.format(context)}'),
                      onTap: () async {
                        final picked = await showTimePicker(context: context, initialTime: end);
                        if (picked != null) setDialogState(() => end = picked);
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Add')),
          ],
        ),
      ),
    );

    if (result != true || titleController.text.trim().isEmpty) return;

    await ref.read(calendarRepositoryProvider).create(CalendarEvent(
          title: titleController.text.trim(),
          start: DateTime(day.year, day.month, day.day, start.hour, start.minute),
          end: DateTime(day.year, day.month, day.day, end.hour, end.minute),
        ));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final dayEvents = _eventsOn(_selectedDay);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendar'),
        actions: [
          IconButton(onPressed: _importIcs, icon: const Icon(Icons.file_download), tooltip: 'Import .ics'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _addEvent(_selectedDay),
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                TableCalendar(
                  firstDay: DateTime(2020),
                  lastDay: DateTime(2035),
                  focusedDay: _focusedMonth,
                  selectedDayPredicate: (d) => isSameDay(d, _selectedDay),
                  eventLoader: _eventsOn,
                  onDaySelected: (selected, focused) {
                    setState(() {
                      _selectedDay = selected;
                      _focusedMonth = focused;
                    });
                  },
                  onPageChanged: (focused) {
                    _focusedMonth = focused;
                    _load();
                  },
                ),
                const Divider(),
                Expanded(
                  child: dayEvents.isEmpty
                      ? const Center(child: Text('No events'))
                      : ListView(
                          children: [
                            for (final e in dayEvents)
                              ListTile(
                                leading: Icon(_sourceIcon(e.source)),
                                title: Text(e.title),
                                subtitle: Text(
                                  '${DateFormat.Hm().format(e.start)} – ${DateFormat.Hm().format(e.end)}'
                                  '${e.location != null ? ' · ${e.location}' : ''}',
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
    );
  }

  IconData _sourceIcon(CalendarSource source) {
    switch (source) {
      case CalendarSource.local:
        return Icons.edit_calendar;
      case CalendarSource.google:
        return Icons.calendar_month;
      case CalendarSource.outlook:
        return Icons.mail_outline;
      case CalendarSource.ics:
        return Icons.cloud_download;
    }
  }
}
