import 'dart:io' show Platform;

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Opens and migrates the single on-device SQLite database that backs every
/// FlowSync feature (calendar, schedule, habits, budget, AI suggestions).
///
/// Everything lives in one file so a user's whole FlowSync state is a single
/// file to back up. sqflite talks to it natively on Android/iOS; on desktop
/// (Windows/Linux/macOS) we swap in `sqflite_common_ffi`'s database factory,
/// which wraps the same sqlite3 C library — the rest of the app never knows
/// the difference.
class AppDatabase {
  AppDatabase._(this.db);

  final Database db;

  static AppDatabase? _instance;

  static Future<AppDatabase> open() async {
    if (_instance != null) return _instance!;

    if (!Platform.isAndroid && !Platform.isIOS) {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    }

    final dir = await getApplicationSupportDirectory();
    final path = p.join(dir.path, 'flowsync.db');

    final db = await databaseFactory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              start TEXT NOT NULL,
              end TEXT NOT NULL,
              all_day INTEGER NOT NULL DEFAULT 0,
              location TEXT,
              notes TEXT,
              source TEXT NOT NULL DEFAULT 'local',
              external_id TEXT
            )
          ''');

          await db.execute('''
            CREATE TABLE tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              notes TEXT,
              due_date TEXT,
              estimated_minutes INTEGER NOT NULL DEFAULT 30,
              priority TEXT NOT NULL DEFAULT 'medium',
              completed INTEGER NOT NULL DEFAULT 0,
              scheduled_start TEXT,
              scheduled_end TEXT
            )
          ''');

          await db.execute('''
            CREATE TABLE habits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              icon TEXT,
              frequency TEXT NOT NULL DEFAULT 'daily',
              custom_days TEXT NOT NULL DEFAULT '',
              points_per_completion INTEGER NOT NULL DEFAULT 10,
              current_streak INTEGER NOT NULL DEFAULT 0,
              best_streak INTEGER NOT NULL DEFAULT 0,
              archived INTEGER NOT NULL DEFAULT 0
            )
          ''');

          await db.execute('''
            CREATE TABLE habit_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
              completed_on TEXT NOT NULL
            )
          ''');

          await db.execute('''
            CREATE TABLE rewards (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              point_cost INTEGER NOT NULL,
              redeemed INTEGER NOT NULL DEFAULT 0
            )
          ''');

          await db.execute('''
            CREATE TABLE budget_categories (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              monthly_limit_cents INTEGER NOT NULL DEFAULT 0
            )
          ''');

          await db.execute('''
            CREATE TABLE budget_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              category_id INTEGER NOT NULL REFERENCES budget_categories(id),
              amount_cents INTEGER NOT NULL,
              type TEXT NOT NULL,
              date TEXT NOT NULL,
              note TEXT
            )
          ''');

          await db.execute('''
            CREATE TABLE ai_suggestions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              kind TEXT NOT NULL,
              summary TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              created_at TEXT NOT NULL
            )
          ''');
        },
      ),
    );

    _instance = AppDatabase._(db);
    return _instance!;
  }
}
