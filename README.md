# FlowSync

One calendar, one schedule, one todo list. FlowSync pulls your calendars
together, builds your day around them, tracks habits and rewards you for
keeping them, and tracks your budget — with a local Ollama model offering
suggestions you can accept or deny, never acting on its own.

Runs on **Windows** (desktop) and **Android**. Everything is stored locally
in a single SQLite file; no account or cloud backend is required to use the
app, and no data leaves the device for the AI suggestions (they're generated
by a model you run yourself via [Ollama](https://ollama.com)).

## Why Flutter

A single Dart codebase covers both target platforms (Windows desktop +
Android) without a second native project to maintain, and `sqflite` +
`sqflite_common_ffi` give the same local-database API on both.

## Features

| Area | What's implemented now | Planned |
|---|---|---|
| **Calendar** | Local events, month view, `.ics` import (covers Google/Outlook/Apple "export" or "subscribe" links with zero API setup) | Live two-way sync via Google Calendar / Microsoft Graph OAuth |
| **Schedule & todos** | Task list with priority/duration/due date; a scheduler that fits tasks into the gaps between calendar events | Drag-to-reschedule, recurring tasks |
| **Habits & rewards** | Daily/weekly/custom-day habits, streaks, points per completion, a redeemable rewards list | Habit insights, best-time-of-day suggestions |
| **Budget** | Categories with optional monthly limits, income/expense entries, progress bars, monthly net | Recurring bills, multi-month trends/charts |
| **AI suggestions** | Local Ollama model reviews today's tasks/events/habits/budget and proposes up to 3 changes as accept/deny cards; nothing is applied until accepted | Streaming responses, per-category suggestion opt-out |

## Architecture

```
lib/
  core/            theme, app-wide config
  data/            AppDatabase — single sqflite/ffi connection + schema
  models/          plain data classes (no persistence logic)
  features/
    calendar/      CalendarProvider interface, .ics import, repository, UI
    schedule/      task repository, SchedulerEngine (free-slot packing), UI
    habits/        habit repository, streak/points math, UI
    budget/        category + entry repository, UI
    ai/            OllamaClient, SuggestionEngine (prompt building +
                    response parsing), SuggestionCard widget
  shared/          Riverpod provider wiring, HomeShell navigation
```

Each feature owns its own repository talking directly to `AppDatabase`;
nothing reaches into another feature's tables. The AI suggestion engine only
*reads* from other repositories to build its prompt — applying an accepted
suggestion is handled by the screen that owns the relevant data, keyed off
`AiSuggestion.kind`.

Calendar sync is behind the `CalendarProvider` interface so a real Google/
Outlook OAuth integration can be dropped in later without touching the
scheduler, habits, or budget code.

## Setup

1. Install the [Flutter SDK](https://docs.flutter.dev/get-started/install) (stable channel) and enable the platforms you need:
   ```bash
   flutter config --enable-windows-desktop
   # Android support is enabled by default once the Android SDK is installed
   ```
2. Generate the platform runner folders (not checked into git — see `.gitignore`):
   ```bash
   flutter create . --platforms=windows,android
   ```
3. Fetch packages:
   ```bash
   flutter pub get
   ```
4. [Install Ollama](https://ollama.com/download) and pull a model (suggestions work with any instruction-following model; `llama3.2` is the default in `lib/features/ai/ollama_client.dart`):
   ```bash
   ollama pull llama3.2
   ollama serve
   ```
5. Run it:
   ```bash
   flutter run -d windows
   flutter run -d android   # with a device/emulator connected
   ```

If `ollama serve` isn't running, every other feature works normally — the
"Ask AI" button just reports that it can't reach Ollama instead of silently
failing.

## Notes on the Android build

Calendar import, habit tracking, and budget tracking work the same on
Android as on Windows. Two things are inherently desktop-first:

- **Ollama** runs as a local server process; on Android it must be reachable
  over the network (e.g. pointed at a desktop machine's IP in Settings)
  rather than running on-device. `OllamaClient(host: ...)` takes any
  reachable host for this reason.
- **Multi-window / wide layouts** — `HomeShell` switches between a
  `NavigationRail` (desktop-width) and a bottom `NavigationBar` (phone-width)
  automatically.

## License

Not yet chosen — add one before accepting external contributions.
